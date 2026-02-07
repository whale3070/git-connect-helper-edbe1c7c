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
//
// ✅ FIX（你现在遇到的 bug 就在这）：
// - 以前 book_address 只从 .env (CONTRACT_ADDR 等) 读取，导致你在 Redis 里绑定了 book_address / book_addr 也永远返回空。
// - 现在优先级：
//   1) vault:bind:<codeHash> 里的 book_address / book_addr
//   2) vault:codes:book_addr 里 code -> book_addr 的映射（你 zip 生成时写入的）
//   3) 环境变量 CONTRACT_ADDR / BOOK_CONTRACT / BOOK_ADDRESS（兜底）
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

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	// ✅ 抗迁移：同时尝试多种key形态
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

	// 先判 used（避免自愈时把已核销码重新生成绑定）
	if h.isCodeUsed(ctx, codeHash) {
		h.sendJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "激活码已核销",
		})
		return
	}

	role := h.determineRole(ctx, codeHash)

	// ✅ 自愈：bind 不存在，但 reader code 合法 -> 自动生成绑定
	if len(bindData) == 0 {
		if role == "reader" {
			addr, privHex, genErr := h.ensureReaderBinding(ctx, codeHash)
			if genErr != nil {
				log.Printf("❌ GetBinding: ensureReaderBinding failed codeHash=%s err=%v", codeHash, genErr)
				h.sendJSON(w, http.StatusInternalServerError, map[string]any{
					"ok":    false,
					"error": "生成读者绑定失败: " + genErr.Error(),
				})
				return
			}

			// ✅ 关键：补齐 book_address（先查 vault:codes:book_addr，再兜底 env）
			bookAddress := h.resolveBookAddress(ctx, codeHash, nil)

			h.sendJSON(w, http.StatusOK, map[string]any{
				"ok":           true,
				"role":         "reader",
				"book_address": bookAddress,
				"address":      addr,
				"privateKey":   privHex,
				"_hit":         "auto-generated",
				"status":       "valid",
				"message":      "读者激活码有效（已自动补齐绑定信息）",
			})
			return
		}

		// publisher/author/unknown：保持严格
		log.Printf("❌ GetBinding: bind not found. role=%s codeHash=%s tried=%v", role, codeHash, keysToTry)
		h.sendJSON(w, http.StatusNotFound, map[string]any{
			"ok":    false,
			"error": "未找到绑定信息",
		})
		return
	}

	// ✅ 字段名兼容
	address := strings.TrimSpace(bindData["address"])
	if address == "" {
		address = strings.TrimSpace(bindData["addr"])
	}
	privateKey := strings.TrimSpace(bindData["privateKey"])
	if privateKey == "" {
		privateKey = strings.TrimSpace(bindData["private_key"])
	}

	// ✅ 关键：从 bind / codes 映射里取 book_address，而不是只看 env
	bookAddress := h.resolveBookAddress(ctx, codeHash, bindData)

	resp := map[string]any{
		"ok":           true,
		"role":         role,
		"book_address": bookAddress,
		"address":      address,
		"privateKey":   privateKey,
		"_hit":         hitKey, // debug only
	}

	if role == "reader" {
		resp["status"] = "valid"
		resp["message"] = "读者激活码有效"
	}

	// 不在日志里打印 privateKey
	log.Printf("✅ GetBinding: ok role=%s codeHash=%s addr=%s book=%s hit=%s", role, codeHash, address, bookAddress, hitKey)
	h.sendJSON(w, http.StatusOK, resp)
}

// resolveBookAddress: book_address 优先级
// 1) bindData[book_address/book_addr]
// 2) HGET vault:codes:book_addr <0xcodeHash> or <codeHash>
// 3) env CONTRACT_ADDR/BOOK_CONTRACT/BOOK_ADDRESS
func (h *AuthHandler) resolveBookAddress(ctx context.Context, codeHash string, bindData map[string]string) string {
	// 1) bindData
	if bindData != nil {
		if v := strings.TrimSpace(firstNonEmpty(
			bindData["book_address"],
			bindData["book_addr"],
			bindData["bookAddress"],
			bindData["bookAddr"],
		)); v != "" {
			return strings.ToLower(v)
		}
	}

	// 2) code -> book_addr 映射（publisher.zip 写入）
	for _, c := range []string{"0x" + codeHash, codeHash} {
		if v, err := h.RDB.HGet(ctx, "vault:codes:book_addr", c).Result(); err == nil {
			v = strings.TrimSpace(v)
			if v != "" && common.IsHexAddress(v) {
				return strings.ToLower(v)
			}
		}
	}

	// 3) env fallback
	bookAddress := firstNonEmpty(
		strings.TrimSpace(os.Getenv("CONTRACT_ADDR")),
		strings.TrimSpace(os.Getenv("BOOK_CONTRACT")),
		strings.TrimSpace(os.Getenv("BOOK_ADDRESS")),
	)
	if common.IsHexAddress(bookAddress) {
		return strings.ToLower(bookAddress)
	}
	return ""
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

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	if h.isCodeUsed(ctx, codeHash) {
		h.sendJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "该激活码已被使用",
		})
		return
	}

	role := h.determineRole(ctx, codeHash)
	if role == "unknown" {
		h.sendJSON(w, http.StatusNotFound, map[string]any{
			"ok":    false,
			"error": "无效的激活码",
		})
		return
	}

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

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
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
// GET /secret/health （可选）
// ==============================
func (h *AuthHandler) Health(w http.ResponseWriter, r *http.Request) {
	h.sendJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"service":   "vault-auth",
		"timestamp": time.Now().Unix(),
		"version":   "bookaddr-fixed-1",
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
		// reader codes（你当前 zip 生成是写入 vault:codes:valid SET，成员一般是 0x...）
		if ok, _ := h.RDB.SIsMember(ctx, "vault:codes:valid", c).Result(); ok {
			return "reader"
		}
	}
	return "unknown"
}

// isCodeUsed 兼容：
// 1) 新：vault:codes:used (SET)
// 2) 旧：vault:codes:<code> (HASH) 字段 used=true / 1
func (h *AuthHandler) isCodeUsed(ctx context.Context, codeHash string) bool {
	// 1) used set 兼容 0x/不带0x
	for _, c := range []string{codeHash, "0x" + codeHash} {
		isUsed, _ := h.RDB.SIsMember(ctx, "vault:codes:used", c).Result()
		if isUsed {
			return true
		}
	}

	// 2) legacy: vault:codes:<code> hash (这里约定 key 使用 0x 前缀更常见)
	for _, c := range []string{"0x" + codeHash, codeHash} {
		key := "vault:codes:" + c
		v, err := h.RDB.HGet(ctx, key, "used").Result()
		if err == nil {
			v = strings.ToLower(strings.TrimSpace(v))
			if v == "true" || v == "1" || v == "yes" {
				return true
			}
		}
	}
	return false
}

// ensureReaderBinding: 当 reader code 合法但 bind 缺失时，自愈生成钱包并双写 vault:bind:*
// 返回：address, privateKeyHex(0x...), error
func (h *AuthHandler) ensureReaderBinding(ctx context.Context, codeHash string) (string, string, error) {
	// 先 double-check：避免并发重复生成
	for _, k := range []string{"vault:bind:" + codeHash, "vault:bind:0x" + codeHash} {
		data, e := h.RDB.HGetAll(ctx, k).Result()
		if e == nil && len(data) > 0 {
			addr := strings.TrimSpace(firstNonEmpty(data["address"], data["addr"]))
			pk := strings.TrimSpace(firstNonEmpty(data["privateKey"], data["private_key"]))
			return addr, normalizePrivKey(pk), nil
		}
	}

	// 生成新钱包
	pk, err := crypto.GenerateKey()
	if err != nil {
		return "", "", err
	}
	addr := strings.ToLower(crypto.PubkeyToAddress(pk.PublicKey).Hex())
	privHex := "0x" + hexNo0x(crypto.FromECDSA(pk)) // 0x-prefixed

	mapping := map[string]any{
		"address":      addr,
		"private_key":  strings.TrimPrefix(privHex, "0x"), // 兼容你其它模块的字段名
		"privateKey":   privHex,                           // 兼容前端老字段
		"role":         "reader",
		"generated_at": time.Now().Unix(),
	}

	pipe := h.RDB.Pipeline()
	pipe.HSet(ctx, "vault:bind:"+codeHash, mapping)
	pipe.HSet(ctx, "vault:bind:0x"+codeHash, mapping)
	_, err = pipe.Exec(ctx)
	if err != nil {
		return "", "", err
	}
	return addr, privHex, nil
}

func normalizePrivKey(pk string) string {
	pk = strings.TrimSpace(pk)
	if pk == "" {
		return ""
	}
	if strings.HasPrefix(pk, "0x") {
		return pk
	}
	// 如果是 64 hex
	s := strings.TrimPrefix(strings.ToLower(pk), "0x")
	if len(s) == 64 && isHexLowerOrUpper(s) {
		return "0x" + s
	}
	return pk
}

func hexNo0x(b []byte) string {
	return strings.TrimPrefix(strings.ToLower(common.Bytes2Hex(b)), "0x")
}

// ==============================
// sendJSON + CORS
// ==============================
func (h *AuthHandler) sendJSON(w http.ResponseWriter, code int, payload any) {
	// ✅ 同域也建议保留，避免未来切分域名/端口时前端“误判 404”
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

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
