package handlers

import (
	"context"
	"encoding/json"
	"math/big"
	"net/http"
	"os"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/redis/go-redis/v9"
)

type FactoryHandler struct {
	RDB     *redis.Client
	Client  *ethclient.Client
	ChainID *big.Int
}

// PrecheckCode 预检查激活码
func (h *FactoryHandler) PrecheckCode(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		h.sendJSON(w, 400, map[string]interface{}{"ok": false, "error": "缺少激活码"})
		return
	}

	codeKey := "vault:codes:" + code
	exists, _ := h.RDB.Exists(context.Background(), codeKey).Result()
	if exists == 0 {
		h.sendJSON(w, 404, map[string]interface{}{"ok": false, "valid": false})
		return
	}

	codeData, _ := h.RDB.HGetAll(context.Background(), codeKey).Result()
	h.sendJSON(w, 200, map[string]interface{}{
		"ok":    true,
		"valid": true,
		"used":  codeData["used"] == "true",
		"role":  codeData["role"],
	})
}

// VerifyPublisher 验证出版社身份
func (h *FactoryHandler) VerifyPublisher(w http.ResponseWriter, r *http.Request) {
	codeHash := r.URL.Query().Get("codeHash")
	if codeHash == "" {
		h.sendJSON(w, 400, map[string]interface{}{"ok": false, "error": "缺少 codeHash"})
		return
	}

	data, err := h.RDB.HGetAll(context.Background(), "vault:bind:"+codeHash).Result()
	if err != nil || len(data) == 0 {
		h.sendJSON(w, 404, map[string]interface{}{"ok": false, "error": "未找到出版社信息"})
		return
	}

	if data["role"] != "publisher" {
		h.sendJSON(w, 403, map[string]interface{}{"ok": false, "error": "非出版社角色"})
		return
	}

	h.sendJSON(w, 200, map[string]interface{}{
		"ok":      true,
		"address": data["address"],
	})
}

// CreateBook 创建书籍 (旧接口兼容)
func (h *FactoryHandler) CreateBook(w http.ResponseWriter, r *http.Request) {
	h.DeployBook(w, r)
}

// GetPublisherBalance 查询出版社余额
func (h *FactoryHandler) GetPublisherBalance(w http.ResponseWriter, r *http.Request) {
	codeHash := r.URL.Query().Get("codeHash")
	if codeHash == "" {
		h.sendJSON(w, 400, map[string]interface{}{"ok": false, "error": "缺少 codeHash"})
		return
	}

	data, err := h.RDB.HGetAll(context.Background(), "vault:bind:"+codeHash).Result()
	if err != nil || len(data) == 0 {
		h.sendJSON(w, 404, map[string]interface{}{"ok": false, "error": "未找到出版社信息"})
		return
	}

	address := data["address"]
	balance, err := h.Client.BalanceAt(context.Background(), common.HexToAddress(address), nil)
	if err != nil {
		h.sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "查询余额失败"})
		return
	}

	// 转换为 CFX (18位小数)
	balanceCFX := new(big.Float).Quo(new(big.Float).SetInt(balance), big.NewFloat(1e18))
	h.sendJSON(w, 200, map[string]interface{}{
		"ok":      true,
		"address": address,
		"balance": balanceCFX.Text('f', 4),
	})
}

// DeployBook 处理前端 /api/v1/factory/deploy-book 的请求
func (h *FactoryHandler) DeployBook(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CodeHash   string `json:"codeHash"`
		BookName   string `json:"bookName"`
		AuthorName string `json:"authorName"`
		Symbol     string `json:"symbol"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendJSON(w, 400, map[string]interface{}{"ok": false, "error": "无效的参数格式"})
		return
	}

	// 1. 从 Redis 获取出版社私钥
	pubData, err := h.RDB.HGetAll(context.Background(), "vault:bind:"+req.CodeHash).Result()
	if err != nil || len(pubData) == 0 {
		h.sendJSON(w, 403, map[string]interface{}{"ok": false, "error": "鉴权失败：找不到该出版社的密钥信息"})
		return
	}

	privateKeyHex := pubData["private_key"]
	publisherAddress := pubData["address"]
	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil {
		h.sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "出版社私钥格式错误"})
		return
	}

	// 2. 检查余额 (至少需要 2 CFX)
	pubAddr := common.HexToAddress(publisherAddress)
	balance, _ := h.Client.BalanceAt(context.Background(), pubAddr, nil)
	minReq := new(big.Int).Mul(big.NewInt(2), big.NewInt(1e18))
	if balance.Cmp(minReq) < 0 {
		h.sendJSON(w, 400, map[string]interface{}{"ok": false, "error": "余额不足，部署需约 2 CFX"})
		return
	}

	// 3. 构造 ABI 编码
	factoryAddr := os.Getenv("FACTORY_ADDR")
	if factoryAddr == "" {
		factoryAddr = "0xe0c25B2D0C0bB524d0561496eb72816368986Ca7"
	}

	callData := encodeDeployBookData(req.BookName, req.Symbol, req.AuthorName, "https://arweave.net/metadata", common.Address{})

	// 4. 发送交易
	nonce, _ := h.Client.PendingNonceAt(context.Background(), pubAddr)
	gasPrice, _ := h.Client.SuggestGasPrice(context.Background())
	deployFee := new(big.Int).Mul(big.NewInt(1), big.NewInt(1e18))

	tx := types.NewTransaction(
		nonce,
		common.HexToAddress(factoryAddr),
		deployFee,
		uint64(6000000),
		gasPrice,
		callData,
	)

	signedTx, _ := types.SignTx(tx, types.NewEIP155Signer(h.ChainID), privateKey)

	err = h.Client.SendTransaction(context.Background(), signedTx)
	if err != nil {
		h.sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "上链失败: " + err.Error()})
		return
	}

	h.sendJSON(w, 200, map[string]interface{}{
		"ok":      true,
		"txHash":  signedTx.Hash().Hex(),
		"message": "书籍部署交易已发出",
	})
}

// 辅助函数：手动构造 ABI Data
func encodeDeployBookData(name, symbol, author, uri string, relayer common.Address) []byte {
	methodID := common.FromHex("7d9f6db5")

	encStr := func(s string) []byte {
		b := []byte(s)
		l := make([]byte, 32)
		big.NewInt(int64(len(b))).FillBytes(l)
		p := ((len(b) + 31) / 32) * 32
		data := make([]byte, p)
		copy(data, b)
		return append(l, data...)
	}

	d1, d2, d3, d4 := encStr(name), encStr(symbol), encStr(author), encStr(uri)
	hSize := 5 * 32
	o1 := hSize
	o2 := o1 + len(d1)
	o3 := o2 + len(d2)
	o4 := o3 + len(d3)

	res := append([]byte{}, methodID...)
	put := func(n int) {
		b := make([]byte, 32)
		big.NewInt(int64(n)).FillBytes(b)
		res = append(res, b...)
	}
	put(o1)
	put(o2)
	put(o3)
	put(o4)

	addrP := make([]byte, 32)
	copy(addrP[12:], relayer.Bytes())
	res = append(res, addrP...)
	res = append(res, d1...)
	res = append(res, d2...)
	res = append(res, d3...)
	res = append(res, d4...)

	return res
}

func (h *FactoryHandler) sendJSON(w http.ResponseWriter, code int, p interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(p)
}
