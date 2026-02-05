package handlers

import (
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/redis/go-redis/v9"
)

// ==============================
// Relayer 池（保持你原逻辑）
// ==============================

// Relayer 结构体表示一个代付钱包
type Relayer struct {
	PrivateKey string
	Address    string
	Nonce      uint64
	Mu         sync.Mutex
}

var (
	Relayers []*Relayer
	relayIdx int
	relayMu  sync.Mutex
)

// LoadRelayers 从环境变量加载Relayer钱包
func LoadRelayers(client *ethclient.Client, chainID *big.Int) {
	log.Println("⛽ 开始加载 Relayer 钱包池...")

	Relayers = []*Relayer{}

	for i := 0; i < 10; i++ {
		var privKey string

		if i == 0 {
			privKey = os.Getenv("PRIVATE_KEY_0")
			if privKey == "" {
				privKey = os.Getenv("PRIVATE_KEY") // 兼容旧变量
			}
		} else {
			privKey = os.Getenv(fmt.Sprintf("PRIVATE_KEY_%d", i))
		}

		if privKey == "" {
			if i == 0 {
				log.Println("⚠️  警告：未找到 PRIVATE_KEY_0 或 PRIVATE_KEY 环境变量")
			}
			break
		}

		privKey = strings.TrimSpace(privKey)
		privKey = strings.TrimPrefix(privKey, "0x")

		if len(privKey) != 64 || !isHexLowerOrUpper(privKey) {
			log.Printf("⚠️  私钥格式错误 (PRIVATE_KEY_%d): 应为64位hex，实际=%d", i, len(privKey))
			continue
		}

		privateKey, err := crypto.HexToECDSA(privKey)
		if err != nil {
			log.Printf("❌ 私钥解析失败 (PRIVATE_KEY_%d): %v", i, err)
			continue
		}

		publicKey := privateKey.Public()
		publicKeyECDSA, ok := publicKey.(*ecdsa.PublicKey)
		if !ok {
			log.Printf("❌ 无法获取公钥 (PRIVATE_KEY_%d)", i)
			continue
		}

		address := crypto.PubkeyToAddress(*publicKeyECDSA).Hex()

		var currentNonce uint64
		if client != nil {
			nonce, err := client.PendingNonceAt(context.Background(), common.HexToAddress(address))
			if err != nil {
				log.Printf("⚠️  无法获取 %s 的nonce: %v", address, err)
				currentNonce = 0
			} else {
				currentNonce = nonce
			}
		}

		relayer := &Relayer{
			PrivateKey: "0x" + privKey, // 注意：不要打印这个字段
			Address:    strings.ToLower(address),
			Nonce:      currentNonce,
		}
		Relayers = append(Relayers, relayer)
		log.Printf("✅ 已加载 Relayer #%d: %s (Nonce: %d)", i, address, currentNonce)

		if client != nil {
			balance, err := client.BalanceAt(context.Background(), common.HexToAddress(address), nil)
			if err == nil {
				balanceCFX := new(big.Float).Quo(new(big.Float).SetInt(balance), big.NewFloat(1e18))
				log.Printf("   💰 余额: %s CFX", balanceCFX.Text('f', 6))
				if balance.Cmp(big.NewInt(1e18)) < 0 {
					log.Printf("   ⚠️  警告：余额较低，可能无法支付多次Gas费用")
				}
			}
		}
	}

	if len(Relayers) == 0 {
		log.Fatal("❌ 未配置任何Relayer钱包，请设置 PRIVATE_KEY_0 或 PRIVATE_KEY")
	}

	log.Printf("✅ Relayer 钱包池初始化完成，共 %d 个钱包", len(Relayers))
	log.Printf("🔗 当前网络 ChainID: %s", chainID.String())
}

// GetNextRelayer 获取下一个可用的Relayer（轮询）
func GetNextRelayer() *Relayer {
	relayMu.Lock()
	defer relayMu.Unlock()

	if len(Relayers) == 0 {
		log.Println("❌ 错误：Relayer池为空")
		return nil
	}

	r := Relayers[relayIdx%len(Relayers)]
	relayIdx++
	return r
}

// GetRelayerByAddress 根据地址获取Relayer
func GetRelayerByAddress(address string) *Relayer {
	relayMu.Lock()
	defer relayMu.Unlock()

	searchAddr := strings.ToLower(strings.TrimSpace(address))
	for _, relayer := range Relayers {
		if strings.ToLower(relayer.Address) == searchAddr {
			return relayer
		}
	}
	return nil
}

// UpdateRelayerNonce 更新Relayer的Nonce
func UpdateRelayerNonce(address string, newNonce uint64) {
	relayMu.Lock()
	defer relayMu.Unlock()

	searchAddr := strings.ToLower(strings.TrimSpace(address))
	for _, relayer := range Relayers {
		if strings.ToLower(relayer.Address) == searchAddr {
			relayer.Nonce = newNonce
			log.Printf("📝 更新 Relayer %s 的 Nonce: %d", address, newNonce)
			return
		}
	}
}

// ==============================
// AuthHandler
// ==============================

type AuthHandler struct {
	RDB    *redis.Client
	Client *ethclient.Client
}

func NewAuthHandler(rdb *redis.Client, client *ethclient.Client) *AuthHandler {
	return &AuthHandler{RDB: rdb, Client: client}
}

// ==============================
// GET /secret/get-binding?codeHash=...
// 返回：address/privateKey/role/book_address
// ==============================
func (h *AuthHandler) GetBinding(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		h.sendJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	log.Printf("🔔 [REQ] %s %s | From: %s", r.Method, r.URL.Path, r.RemoteAddr)

	raw := strings.TrimSpace(r.URL.Query().Get("codeHash"))
	codeHash, err := normalizeCodeHash(raw)
	if err != nil {
		h.sendJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": err.Error(),
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	// ✅ 抗迁移：同时尝试多种key形态
	// - vault:bind:<64hex>
	// - vault:bind:0x<64hex> （有些脚本/旧逻辑会这么存）
	keysToTry := []string{
		"vault:bind:" + codeHash,
		"vault:bind:0x" + codeHash,
	}

	var (
		bindData map[string]string
		hitKey   string
	)

	for _, k := range keysToTry {
		data, e := h.RDB.HGetAll(ctx, k).Result()
		if e == nil && len(data) > 0 {
			bindData = data
			hitKey = k
			break
		}
	}

	if len(bindData) == 0 {
		// 给你可定位信息（不暴露敏感）
		log.Printf("❌ GetBinding: bind not found. codeHash=%s tried=%v", codeHash, keysToTry)
		h.sendJSON(w, http.StatusNotFound, map[string]any{
			"ok":    false,
			"error": "未找到绑定信息",
		})
		return
	}

	// ✅ 抗迁移：字段名兼容
	address := strings.TrimSpace(bindData["address"])
	if address == "" {
		address = strings.TrimSpace(bindData["addr"])
	}
	privateKey := strings.TrimSpace(bindData["privateKey"])
	if privateKey == "" {
		privateKey = strings.TrimSpace(bindData["private_key"])
	}
	// 如果 privateKey 为空，不影响“只读身份确认”，但前端如果依赖它就会显示 Unknown
	// 这里不直接报错，避免“部分数据无私钥”导致整个流程不可用

	// ✅ 抗迁移：used set 也可能存 0x 版本
	isUsed := h.isCodeUsed(ctx, codeHash)
	if isUsed {
		h.sendJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "激活码已核销",
		})
		return
	}

	role := h.determineRole(ctx, codeHash)

	// book address：兼容多个 env 名
	bookAddress := firstNonEmpty(
		strings.TrimSpace(os.Getenv("CONTRACT_ADDR")),
		strings.TrimSpace(os.Getenv("BOOK_CONTRACT")),
		strings.TrimSpace(os.Getenv("BOOK_ADDRESS")),
	)

	resp := map[string]any{
		"ok":           true,
		"role":         role,
		"book_address": bookAddress,
		"address":      address,
		"privateKey":   privateKey,
		// debug: 哪个 key 命中（方便你定位数据写入形态问题）
		"_hit": hitKey,
	}

	if role == "reader" {
		resp["status"] = "valid"
		resp["message"] = "读者激活码有效"
	}

	// 不在日志里打印 privateKey
	log.Printf("✅ GetBinding: ok role=%s codeHash=%s addr=%s hit=%s", role, codeHash, address, hitKey)
	h.sendJSON(w, http.StatusOK, resp)
}

// ==============================
// GET /secret/verify?codeHash=...
// 只验证：valid/used/role/address（不返回私钥）
// ==============================
func (h *AuthHandler) Verify(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		h.sendJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	log.Printf("🔔 [REQ] %s %s | From: %s", r.Method, r.URL.Path, r.RemoteAddr)

	raw := strings.TrimSpace(r.URL.Query().Get("codeHash"))
	codeHash, err := normalizeCodeHash(raw)
	if err != nil {
		h.sendJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": err.Error(),
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if h.isCodeUsed(ctx, codeHash) {
		h.sendJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "该激活码已被使用",
		})
		return
	}

	role := h.determineRole(ctx, codeHash)

	// 尝试从绑定里拿地址（兼容 key/字段）
	address := ""
	for _, k := range []string{"vault:bind:" + codeHash, "vault:bind:0x" + codeHash} {
		v, e := h.RDB.HGet(ctx, k, "address").Result()
		if e == nil && strings.TrimSpace(v) != "" {
			address = strings.TrimSpace(v)
			break
		}
		// 兼容 addr 字段
		v2, e2 := h.RDB.HGet(ctx, k, "addr").Result()
		if e2 == nil && strings.TrimSpace(v2) != "" {
			address = strings.TrimSpace(v2)
			break
		}
	}

	if role == "unknown" {
		h.sendJSON(w, http.StatusNotFound, map[string]any{
			"ok":    false,
			"error": "无效的激活码",
		})
		return
	}

	resp := map[string]any{
		"ok":      true,
		"role":    role,
		"address": address,
		"status":  "valid",
	}

	switch role {
	case "reader":
		resp["message"] = "读者身份验证成功"
	case "author":
		resp["message"] = "作者身份验证成功"
	case "publisher":
		resp["message"] = "出版商身份验证成功"
	}

	h.sendJSON(w, http.StatusOK, resp)
}

// ==============================
// GET /api/admin/check-access?address=0x...
// ==============================
func (h *AuthHandler) CheckAdminAccess(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		h.sendJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	log.Printf("🔔 [REQ] %s %s | From: %s", r.Method, r.URL.Path, r.RemoteAddr)

	address := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("address")))
	if address == "" {
		h.sendJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "缺少 address 参数"})
		return
	}
	if !common.IsHexAddress(address) {
		h.sendJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "无效的地址格式"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	isPublisher, _ := h.RDB.SIsMember(ctx, "vault:roles:publishers", address).Result()
	isAuthor, _ := h.RDB.SIsMember(ctx, "vault:roles:authors", address).Result()
	isAdmin, _ := h.RDB.SIsMember(ctx, "vault:roles:admins", address).Result()

	hasAccess := isPublisher || isAuthor || isAdmin

	h.sendJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"hasAccess": hasAccess,
		"address":   address,
		"roles": map[string]bool{
			"admin":     isAdmin,
			"publisher": isPublisher,
			"author":    isAuthor,
		},
	})
}

// ==============================
// GET /secret/health （可选，不影响 main.go）
// ==============================
func (h *AuthHandler) Health(w http.ResponseWriter, r *http.Request) {
	h.sendJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"service":   "vault-auth",
		"timestamp": time.Now().Unix(),
		"version":   "migrate-hardened-1",
	})
}

// ==============================
// determineRole 抗迁移：同时查带0x/不带0x
// ==============================
func (h *AuthHandler) determineRole(ctx context.Context, codeHash string) string {
	// 候选：64hex 和 0x64hex 都试
	cands := []string{codeHash, "0x" + codeHash}

	for _, c := range cands {
		if ok, _ := h.RDB.SIsMember(ctx, "vault:roles:publishers_codes", c).Result(); ok {
			return "publisher"
		}
	}
	for _, c := range cands {
		if ok, _ := h.RDB.SIsMember(ctx, "vault:roles:authors_codes", c).Result(); ok {
			return "author"
		}
	}
	for _, c := range cands {
		if ok, _ := h.RDB.SIsMember(ctx, "vault:codes:valid", c).Result(); ok {
			return "reader"
		}
	}
	return "unknown"
}

func (h *AuthHandler) isCodeUsed(ctx context.Context, codeHash string) bool {
	// used 集合也兼容 0x/不带0x
	for _, c := range []string{codeHash, "0x" + codeHash} {
		isUsed, _ := h.RDB.SIsMember(ctx, "vault:codes:used", c).Result()
		if isUsed {
			return true
		}
	}
	return false
}

// ==============================
// sendJSON
// ==============================
func (h *AuthHandler) sendJSON(w http.ResponseWriter, code int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("❌ JSON编码失败: %v", err)
		http.Error(w, "内部服务器错误", http.StatusInternalServerError)
	}
}

// ==============================
// utils
// ==============================

// normalizeCodeHash: 接受 "", "0x..." 或纯 hex
// 输出：64位小写 hex（不带0x）
func normalizeCodeHash(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("缺少 codeHash 参数")
	}
	s := strings.ToLower(raw)
	s = strings.TrimPrefix(s, "0x")
	if len(s) != 64 || !isHexLowerOrUpper(s) {
		return "", fmt.Errorf("codeHash格式错误，应为64字符的十六进制字符串")
	}
	return s, nil
}

func isHexLowerOrUpper(s string) bool {
	for _, ch := range s {
		if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')) {
			return false
		}
	}
	return true
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// DeriveAddressFromPrivateKey 从私钥派生地址（保留你原函数）
func DeriveAddressFromPrivateKey(privateKeyHex string) string {
	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(strings.TrimSpace(privateKeyHex), "0x"))
	if err != nil {
		return ""
	}
	return crypto.PubkeyToAddress(privateKey.PublicKey).Hex()
}

// ValidateSignature 验证签名（保留你原函数）
func ValidateSignature(address, message, signature string) bool {
	if !common.IsHexAddress(address) || signature == "" {
		return false
	}
	messageHash := crypto.Keccak256Hash([]byte(message))
	sigBytes := common.FromHex(signature)
	if len(sigBytes) != 65 {
		return false
	}
	recoveredPubKey, err := crypto.SigToPub(messageHash.Bytes(), sigBytes)
	if err != nil {
		return false
	}
	recoveredAddr := crypto.PubkeyToAddress(*recoveredPubKey)
	return strings.EqualFold(recoveredAddr.Hex(), address)
}
