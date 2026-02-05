package handlers

import (
	"context"
	"crypto/ecdsa"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	gethcrypto "github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/redis/go-redis/v9"
)

type FactoryHandler struct {
	RDB     *redis.Client
	Client  *ethclient.Client
	ChainID *big.Int
}

func (h *FactoryHandler) sendJSON(w http.ResponseWriter, code int, p interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(p)
}

// -----------------------------
// 请求体：匹配你前端 / curl 的 JSON
// -----------------------------
type DeployBookReq struct {
	Name      string `json:"name"`
	Symbol    string `json:"symbol"`
	Author    string `json:"author"`
	Serial    string `json:"serial"`
	Publisher string `json:"publisher"`

	// 可选：如果你前端未来愿意传 codeHash，就不需要扫描 Redis
	CodeHash string `json:"codeHash,omitempty"`
}

func (h *FactoryHandler) DeployBook(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 75*time.Second)
	defer cancel()

	var req DeployBookReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendJSON(w, 400, map[string]interface{}{"ok": false, "error": "无效的参数格式: " + err.Error()})
		return
	}

	req.Publisher = strings.ToLower(strings.TrimSpace(req.Publisher))
	if !common.IsHexAddress(req.Publisher) {
		h.sendJSON(w, 400, map[string]interface{}{"ok": false, "error": "publisher 地址格式不正确"})
		return
	}
	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.Symbol) == "" || strings.TrimSpace(req.Author) == "" || strings.TrimSpace(req.Serial) == "" {
		h.sendJSON(w, 400, map[string]interface{}{"ok": false, "error": "name/symbol/author/serial 不能为空"})
		return
	}

	// -----------------------------
	// 0) 从 Redis 找到 publisher 的 bind（拿私钥）
	// -----------------------------
	bindKey, pubData, err := h.getPublisherBind(ctx, req.CodeHash, req.Publisher)
	if err != nil {
		h.sendJSON(w, 403, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}
	if strings.ToLower(pubData["role"]) != "publisher" {
		h.sendJSON(w, 403, map[string]interface{}{"ok": false, "error": "非出版社角色", "bindKey": bindKey})
		return
	}

	privateKeyHex := strings.TrimSpace(pubData["private_key"])
	privateKeyHex = strings.TrimPrefix(privateKeyHex, "0x")
	if privateKeyHex == "" {
		h.sendJSON(w, 403, map[string]interface{}{"ok": false, "error": "绑定数据缺少 private_key", "bindKey": bindKey})
		return
	}

	pubPriv, err := gethcrypto.HexToECDSA(privateKeyHex)
	if err != nil {
		h.sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "出版社私钥格式错误: " + err.Error()})
		return
	}

	// 可选：强校验 Redis 里 address 必须等于 req.Publisher，防止伪造 publisher 参数
	if addr := strings.ToLower(strings.TrimSpace(pubData["address"])); common.IsHexAddress(addr) {
		if strings.ToLower(addr) != strings.ToLower(req.Publisher) {
			h.sendJSON(w, 403, map[string]interface{}{"ok": false, "error": "publisher 与绑定地址不一致"})
			return
		}
	}

	// -----------------------------
	// 1) 用 publisher 私钥转 USDT 到 TREASURY_ADDRESS（成功后再部署）
	// -----------------------------
	usdtAddr := strings.TrimSpace(os.Getenv("USDT_CONTRACT"))
	if usdtAddr == "" {
		usdtAddr = strings.TrimSpace(os.Getenv("USDT_ADDRESS")) // 兼容旧变量名
	}
	if !common.IsHexAddress(usdtAddr) {
		h.sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "USDT_CONTRACT/USDT_ADDRESS 未设置或格式不正确"})
		return
	}

	treasury := strings.TrimSpace(os.Getenv("TREASURY_ADDRESS"))
	if !common.IsHexAddress(treasury) {
		h.sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "TREASURY_ADDRESS 未设置或格式不正确"})
		return
	}

	// 默认 10 USDT（按 6 decimals）
	amountUSDT := int64(10)
	if v := strings.TrimSpace(os.Getenv("DEPLOY_USDT_FEE")); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			amountUSDT = n
		}
	}
	amount := new(big.Int).Mul(big.NewInt(amountUSDT), big.NewInt(1_000_000)) // 10 * 1e6

	usdtTxHash, err := h.transferERC20(ctx, pubPriv, common.HexToAddress(usdtAddr), common.HexToAddress(treasury), amount)
	if err != nil {
		h.sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "USDT 转账失败: " + err.Error()})
		return
	}

	if err := h.waitTxSuccess(ctx, common.HexToHash(usdtTxHash), 45*time.Second); err != nil {
		h.sendJSON(w, 500, map[string]interface{}{
			"ok":         false,
			"error":      "USDT 转账未确认成功: " + err.Error(),
			"usdtTxHash": usdtTxHash,
		})
		return
	}

	// -----------------------------
	// 2) 用 BACKEND_PRIVATE_KEY 代付部署合约（调用工厂 createBook）
	// -----------------------------
	factoryAddrStr := strings.TrimSpace(os.Getenv("FACTORY_ADDR"))
	if !common.IsHexAddress(factoryAddrStr) {
		h.sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "FACTORY_ADDR 未设置或格式不正确"})
		return
	}
	factoryAddr := common.HexToAddress(factoryAddrStr)

	backendPrivHex := strings.TrimSpace(os.Getenv("BACKEND_PRIVATE_KEY"))
	backendPrivHex = strings.TrimPrefix(backendPrivHex, "0x")
	if backendPrivHex == "" {
		h.sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "BACKEND_PRIVATE_KEY 未设置"})
		return
	}
	backendPriv, err := gethcrypto.HexToECDSA(backendPrivHex)
	if err != nil {
		h.sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "BACKEND_PRIVATE_KEY 无效: " + err.Error()})
		return
	}

	txHash, err := h.deployByFactory(ctx, backendPriv, factoryAddr, req, common.HexToAddress(req.Publisher))
	if err != nil {
		h.sendJSON(w, 500, map[string]interface{}{
			"ok":         false,
			"error":      "部署失败: " + err.Error(),
			"usdtTxHash": usdtTxHash,
		})
		return
	}

	// -----------------------------
	// 3) 等部署 receipt，解析新合约地址 bookAddr（必须拿到真实地址才能落库）
	// -----------------------------
	receipt, err := h.waitReceipt(ctx, common.HexToHash(txHash), 60*time.Second)
	if err != nil {
		h.sendJSON(w, 500, map[string]interface{}{
			"ok":         false,
			"error":      "部署交易未确认: " + err.Error(),
			"txHash":     txHash,
			"usdtTxHash": usdtTxHash,
		})
		return
	}
	if receipt.Status != 1 {
		h.sendJSON(w, 500, map[string]interface{}{
			"ok":         false,
			"error":      fmt.Sprintf("部署交易失败 status=%d", receipt.Status),
			"txHash":     txHash,
			"usdtTxHash": usdtTxHash,
		})
		return
	}

	bookAddr, err := h.parseBookAddrFromReceipt(ctx, factoryAddr, receipt)
	if err != nil || (bookAddr == common.Address{}) {
		h.sendJSON(w, 500, map[string]interface{}{
			"ok":         false,
			"error":      "无法从 receipt 解析新书合约地址 bookAddr: " + err.Error(),
			"txHash":     txHash,
			"usdtTxHash": usdtTxHash,
		})
		return
	}

	// -----------------------------
	// 4) 写入 Redis：vault:book:meta:<bookAddr>（这会被 idx:books 自动索引）
	// -----------------------------
	if err := h.saveBookMeta(ctx, bookAddr, req); err != nil {
		h.sendJSON(w, 500, map[string]interface{}{
			"ok":         false,
			"error":      "写入 Redis 失败: " + err.Error(),
			"txHash":     txHash,
			"usdtTxHash": usdtTxHash,
			"bookAddr":   strings.ToLower(bookAddr.Hex()),
		})
		return
	}

	h.sendJSON(w, 200, map[string]interface{}{
		"ok":         true,
		"usdtTxHash": usdtTxHash,
		"txHash":     txHash,
		"bookAddr":   strings.ToLower(bookAddr.Hex()),
	})
}

// -----------------------------
// Redis：拿 publisher bind
// -----------------------------
func (h *FactoryHandler) getPublisherBind(ctx context.Context, codeHashRaw string, publisherLower string) (string, map[string]string, error) {
	// 1) 如果传了 codeHash：直接查
	ch := strings.ToLower(strings.TrimSpace(codeHashRaw))
	ch = strings.TrimPrefix(ch, "0x")
	if ch != "" {
		key := "vault:bind:" + ch
		data, err := h.RDB.HGetAll(ctx, key).Result()
		if err == nil && len(data) > 0 {
			return key, data, nil
		}
		return key, nil, errors.New("鉴权失败：找不到该出版社的密钥信息（按 codeHash）")
	}

	// 2) 没传 codeHash：按 publisher 地址扫描匹配
	target := strings.ToLower(strings.TrimSpace(publisherLower))
	iter := h.RDB.Scan(ctx, 0, "vault:bind:*", 200).Iterator()
	for iter.Next(ctx) {
		key := iter.Val()
		addr, _ := h.RDB.HGet(ctx, key, "address").Result()
		if strings.ToLower(strings.TrimSpace(addr)) == target {
			data, _ := h.RDB.HGetAll(ctx, key).Result()
			if len(data) > 0 {
				return key, data, nil
			}
		}
	}
	if err := iter.Err(); err != nil {
		return "", nil, fmt.Errorf("Redis 扫描失败: %v", err)
	}
	return "", nil, errors.New("鉴权失败：找不到该出版社的密钥信息（按 publisher 扫描）")
}

// -----------------------------
// ERC20 transfer (publisher 签名)
// -----------------------------
func (h *FactoryHandler) transferERC20(ctx context.Context, fromPriv *ecdsa.PrivateKey, token common.Address, to common.Address, amount *big.Int) (string, error) {
	erc20ABI, err := abi.JSON(strings.NewReader(`[{"inputs":[{"name":"to","type":"address"},{"name":"amount","type":"uint256"}],"name":"transfer","outputs":[{"name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"}]`))
	if err != nil {
		return "", err
	}

	data, err := erc20ABI.Pack("transfer", to, amount)
	if err != nil {
		return "", err
	}

	fromAddr := gethcrypto.PubkeyToAddress(fromPriv.PublicKey)

	nonce, err := h.Client.PendingNonceAt(ctx, fromAddr)
	if err != nil {
		return "", err
	}
	gasPrice, err := h.Client.SuggestGasPrice(ctx)
	if err != nil {
		return "", err
	}

	// 估算 gas
	msg := ethereum.CallMsg{From: fromAddr, To: &token, Data: data}
	gasLimit, err := h.Client.EstimateGas(ctx, msg)
	if err != nil || gasLimit < 60_000 {
		gasLimit = 120_000
	}

	chainID := h.ChainID
	if chainID == nil || chainID.Sign() <= 0 {
		chainID, _ = h.Client.ChainID(ctx)
	}

	tx := types.NewTx(&types.LegacyTx{
		Nonce:    nonce,
		To:       &token,
		Value:    big.NewInt(0),
		Gas:      gasLimit,
		GasPrice: gasPrice,
		Data:     data,
	})

	signed, err := types.SignTx(tx, types.NewEIP155Signer(chainID), fromPriv)
	if err != nil {
		return "", err
	}
	if err := h.Client.SendTransaction(ctx, signed); err != nil {
		return "", err
	}
	return signed.Hash().Hex(), nil
}

// -----------------------------
// 等交易 receipt 成功（仅判断 status）
// -----------------------------
func (h *FactoryHandler) waitTxSuccess(ctx context.Context, txHash common.Hash, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		receipt, err := h.Client.TransactionReceipt(ctx, txHash)
		if err == nil && receipt != nil {
			if receipt.Status == 1 {
				return nil
			}
			return fmt.Errorf("receipt status=%d", receipt.Status)
		}
		time.Sleep(1200 * time.Millisecond)
	}
	return errors.New("timeout waiting receipt")
}

// 等 receipt（返回 receipt）
func (h *FactoryHandler) waitReceipt(ctx context.Context, txHash common.Hash, timeout time.Duration) (*types.Receipt, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		receipt, err := h.Client.TransactionReceipt(ctx, txHash)
		if err == nil && receipt != nil {
			return receipt, nil
		}
		time.Sleep(1200 * time.Millisecond)
	}
	return nil, errors.New("timeout waiting receipt")
}

// -----------------------------
// 从 receipt 解析 bookAddr
//
// 说明：由于你当前 factory ABI 没有事件定义，这里采用“可配置 + 兜底启发式”的解析方式：
// - 推荐：在 .env 配置 BOOK_CREATED_EVENT_TOPIC0（0x...），与 factory 合约 emit 的事件 topic0 一致
// - 如果未配置：尝试从 logs 中找第一个 address==factory 的 log，取 Topics[1] 作为 bookAddr（需 indexed address）
// - 解析后会用 CodeAt 校验该地址确实是合约（code != 0x）
// -----------------------------
func (h *FactoryHandler) parseBookAddrFromReceipt(ctx context.Context, factory common.Address, receipt *types.Receipt) (common.Address, error) {
	// 1) 可选：按 topic0 精确匹配
	topic0Env := strings.TrimSpace(os.Getenv("BOOK_CREATED_EVENT_TOPIC0")) // 例如 0xabc...
	var wantTopic0 common.Hash
	hasTopic0 := false
	if topic0Env != "" {
		topic0Env = strings.TrimPrefix(strings.ToLower(topic0Env), "0x")
		if len(topic0Env) == 64 {
			b, err := hex.DecodeString(topic0Env)
			if err == nil && len(b) == 32 {
				copy(wantTopic0[:], b)
				hasTopic0 = true
			}
		}
	}

	// topic1 位置（默认 1，代表 Topics[1] 是 bookAddr）
	topicPos := 1
	if v := strings.TrimSpace(os.Getenv("BOOK_CREATED_BOOK_TOPIC_POS")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 1 && n <= 3 {
			topicPos = n
		}
	}

	// 2) 扫 logs 找候选地址
	var candidates []common.Address
	for _, lg := range receipt.Logs {
		if lg == nil {
			continue
		}
		if lg.Address != factory {
			continue
		}
		if len(lg.Topics) <= topicPos {
			continue
		}
		if hasTopic0 && lg.Topics[0] != wantTopic0 {
			continue
		}
		addr := common.BytesToAddress(lg.Topics[topicPos].Bytes())
		if addr == (common.Address{}) {
			continue
		}
		candidates = append(candidates, addr)
	}

	// 3) 兜底：如果没有任何候选且未配置 topic0，则尝试“第一个来自 factory 的 log”
	if len(candidates) == 0 && !hasTopic0 {
		for _, lg := range receipt.Logs {
			if lg == nil {
				continue
			}
			if lg.Address != factory {
				continue
			}
			if len(lg.Topics) >= 2 {
				addr := common.BytesToAddress(lg.Topics[1].Bytes())
				if addr != (common.Address{}) {
					candidates = append(candidates, addr)
					break
				}
			}
		}
	}

	if len(candidates) == 0 {
		return common.Address{}, errors.New("receipt logs 中未找到可解析的 bookAddr（建议在 factory 合约 emit BookCreated，并配置 BOOK_CREATED_EVENT_TOPIC0）")
	}

	// 4) 验证候选地址确实是合约（code != 0x）
	for _, c := range candidates {
		code, err := h.Client.CodeAt(ctx, c, nil)
		if err == nil && len(code) > 0 {
			return c, nil
		}
	}
	return common.Address{}, errors.New("找到了候选地址，但 CodeAt 校验都不是合约（code=0x）；请确认 factory 是否 emit 了包含 bookAddr 的事件并且 bookAddr 是 indexed")
}

// -----------------------------
// 写入 Redis：vault:book:meta:<bookAddr> 以及辅助索引（可选）
// -----------------------------
func (h *FactoryHandler) saveBookMeta(ctx context.Context, bookAddr common.Address, req DeployBookReq) error {
	bookKey := "vault:book:meta:" + strings.ToLower(bookAddr.Hex())
	now := time.Now().Unix()

	fields := map[string]interface{}{
		"publisher": strings.ToLower(strings.TrimSpace(req.Publisher)),
		"symbol":    strings.ToUpper(strings.TrimSpace(req.Symbol)),
		"serial":    strings.TrimSpace(req.Serial),
		"name":      strings.TrimSpace(req.Name),
		"author":    strings.TrimSpace(req.Author),
		"createdAt": now,
	}

	if err := h.RDB.HSet(ctx, bookKey, fields).Err(); err != nil {
		return err
	}

	// 可选：给 publisher 维护一个书列表，方便你后续排查/分页（不影响 idx:books）
	pub := strings.ToLower(strings.TrimSpace(req.Publisher))
	listKey := "vault:publisher:books:" + pub
	_ = h.RDB.ZAdd(ctx, listKey, redis.Z{Score: float64(now), Member: strings.ToLower(bookAddr.Hex())}).Err()

	// 可选：初始化 mint / sales 统计 key（后续你排查 mint nft 总数会用到）
	// 你可以在 mint handler 里 INCRBY 这些 key
	_ = h.RDB.SetNX(ctx, "vault:book:minted:"+strings.ToLower(bookAddr.Hex()), 0, 0).Err()
	_ = h.RDB.SetNX(ctx, "vault:book:sales:"+strings.ToLower(bookAddr.Hex()), 0, 0).Err()

	return nil
}

// -----------------------------
// Factory createBook 部署（backend 代付签名）
// -----------------------------
func (h *FactoryHandler) deployByFactory(ctx context.Context, backendPriv *ecdsa.PrivateKey, factory common.Address, req DeployBookReq, publisher common.Address) (string, error) {
	factoryABI, err := abi.JSON(strings.NewReader(`[
		{"inputs":[
			{"name":"name","type":"string"},
			{"name":"symbol","type":"string"},
			{"name":"author","type":"string"},
			{"name":"serial","type":"string"},
			{"name":"publisher","type":"address"}
		],"name":"createBook","outputs":[],"stateMutability":"payable","type":"function"}
	]`))
	if err != nil {
		return "", err
	}

	data, err := factoryABI.Pack("createBook",
		strings.TrimSpace(req.Name),
		strings.TrimSpace(req.Symbol),
		strings.TrimSpace(req.Author),
		strings.TrimSpace(req.Serial),
		publisher,
	)
	if err != nil {
		return "", err
	}

	fromAddr := gethcrypto.PubkeyToAddress(backendPriv.PublicKey)

	nonce, err := h.Client.PendingNonceAt(ctx, fromAddr)
	if err != nil {
		return "", err
	}
	gasPrice, err := h.Client.SuggestGasPrice(ctx)
	if err != nil {
		return "", err
	}

	// 可选：部署 fee（CFX），默认 0
	value := big.NewInt(0)
	if feeStr := strings.TrimSpace(os.Getenv("FACTORY_DEPLOY_FEE_CFX")); feeStr != "" {
		if f, err := strconv.ParseFloat(feeStr, 64); err == nil && f > 0 {
			// 简单处理：只支持整数 CFX
			value = new(big.Int).Mul(big.NewInt(int64(f)), big.NewInt(1e18))
		}
	}

	// 估算 gas
	msg := ethereum.CallMsg{From: fromAddr, To: &factory, Value: value, Data: data}
	gasLimit, err := h.Client.EstimateGas(ctx, msg)
	if err != nil || gasLimit < 500_000 {
		gasLimit = 5_000_000
	}

	chainID := h.ChainID
	if chainID == nil || chainID.Sign() <= 0 {
		chainID, _ = h.Client.ChainID(ctx)
	}

	tx := types.NewTx(&types.LegacyTx{
		Nonce:    nonce,
		To:       &factory,
		Value:    value,
		Gas:      gasLimit,
		GasPrice: gasPrice,
		Data:     data,
	})

	signed, err := types.SignTx(tx, types.NewEIP155Signer(chainID), backendPriv)
	if err != nil {
		return "", err
	}
	if err := h.Client.SendTransaction(ctx, signed); err != nil {
		return "", err
	}
	return signed.Hash().Hex(), nil
}

// PrecheckCode 预检查激活码（兼容旧逻辑）
func (h *FactoryHandler) PrecheckCode(w http.ResponseWriter, r *http.Request) {
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if code == "" {
		h.sendJSON(w, 400, map[string]interface{}{"ok": false, "error": "缺少激活码"})
		return
	}

	codeKey := "vault:codes:" + code
	exists, err := h.RDB.Exists(r.Context(), codeKey).Result()
	if err != nil {
		h.sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "Redis 错误: " + err.Error()})
		return
	}
	if exists == 0 {
		h.sendJSON(w, 404, map[string]interface{}{"ok": false, "valid": false})
		return
	}

	codeData, _ := h.RDB.HGetAll(r.Context(), codeKey).Result()
	h.sendJSON(w, 200, map[string]interface{}{
		"ok":    true,
		"valid": true,
		"used":  codeData["used"] == "true",
		"role":  codeData["role"],
	})
}

// VerifyPublisher 验证出版社身份：输入 codeHash，返回绑定地址
func (h *FactoryHandler) VerifyPublisher(w http.ResponseWriter, r *http.Request) {
	codeHash := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("codeHash")))
	codeHash = strings.TrimPrefix(codeHash, "0x")
	if codeHash == "" {
		h.sendJSON(w, 400, map[string]interface{}{"ok": false, "error": "缺少 codeHash"})
		return
	}

	data, err := h.RDB.HGetAll(r.Context(), "vault:bind:"+codeHash).Result()
	if err != nil || len(data) == 0 {
		h.sendJSON(w, 404, map[string]interface{}{"ok": false, "error": "未找到出版社信息"})
		return
	}

	if strings.ToLower(data["role"]) != "publisher" {
		h.sendJSON(w, 403, map[string]interface{}{"ok": false, "error": "非出版社角色"})
		return
	}

	h.sendJSON(w, 200, map[string]interface{}{
		"ok":      true,
		"address": data["address"],
	})
}

// GetPublisherBalance 查询出版社余额：输入 codeHash，返回绑定地址 CFX 余额
func (h *FactoryHandler) GetPublisherBalance(w http.ResponseWriter, r *http.Request) {
	codeHash := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("codeHash")))
	codeHash = strings.TrimPrefix(codeHash, "0x")
	if codeHash == "" {
		h.sendJSON(w, 400, map[string]interface{}{"ok": false, "error": "缺少 codeHash"})
		return
	}

	data, err := h.RDB.HGetAll(r.Context(), "vault:bind:"+codeHash).Result()
	if err != nil || len(data) == 0 {
		h.sendJSON(w, 404, map[string]interface{}{"ok": false, "error": "未找到出版社信息"})
		return
	}

	address := strings.TrimSpace(data["address"])
	if !common.IsHexAddress(address) {
		h.sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "绑定地址格式不正确"})
		return
	}

	balance, err := h.Client.BalanceAt(r.Context(), common.HexToAddress(address), nil)
	if err != nil {
		h.sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "查询余额失败: " + err.Error()})
		return
	}

	// 转换为 CFX (18位小数)
	balanceCFX := new(big.Float).Quo(new(big.Float).SetInt(balance), big.NewFloat(1e18))
	h.sendJSON(w, 200, map[string]interface{}{
		"ok":      true,
		"address": address,
		"balance": balanceCFX.Text('f', 6),
	})
}
