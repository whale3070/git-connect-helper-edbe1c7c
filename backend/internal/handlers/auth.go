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
	
	// 清空现有的Relayer
	Relayers = []*Relayer{}
	
	// 尝试加载多个Relayer私钥
	for i := 0; i < 10; i++ {
		var privKey string
		
		if i == 0 {
			// 首先尝试 PRIVATE_KEY_0（旧格式）
			privKey = os.Getenv("PRIVATE_KEY_0")
			if privKey == "" {
				// 如果没有 PRIVATE_KEY_0，尝试 PRIVATE_KEY（兼容性）
				privKey = os.Getenv("PRIVATE_KEY")
			}
		} else {
			// 尝试 PRIVATE_KEY_1, PRIVATE_KEY_2, 等等
			privKey = os.Getenv(fmt.Sprintf("PRIVATE_KEY_%d", i))
		}
		
		if privKey == "" {
			if i == 0 {
				log.Println("⚠️  警告：未找到 PRIVATE_KEY_0 或 PRIVATE_KEY 环境变量")
			}
			break
		}
		
		// 清理私钥字符串
		privKey = strings.TrimSpace(privKey)
		privKey = strings.TrimPrefix(privKey, "0x")
		
		// 验证私钥格式
		if len(privKey) != 64 {
			log.Printf("⚠️  私钥格式错误 (PRIVATE_KEY_%d): 长度应为64字符，实际 %d 字符", i, len(privKey))
			continue
		}
		
		// 从私钥生成地址
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
		
		// 获取当前nonce
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
		
		// 创建Relayer实例
		relayer := &Relayer{
			PrivateKey: "0x" + privKey,
			Address:    strings.ToLower(address),
			Nonce:      currentNonce,
		}
		
		Relayers = append(Relayers, relayer)
		log.Printf("✅ 已加载 Relayer #%d: %s (Nonce: %d)", i, address, currentNonce)
		
		// 检查余额
		if client != nil {
			balance, err := client.BalanceAt(context.Background(), common.HexToAddress(address), nil)
			if err == nil {
				balanceCFX := new(big.Float).Quo(
					new(big.Float).SetInt(balance),
					big.NewFloat(1e18),
				)
				log.Printf("   💰 余额: %s CFX", balanceCFX.Text('f', 6))
				
				// 警告低余额
				if balance.Cmp(big.NewInt(1000000000000000000)) < 0 { // 少于1 CFX
					log.Printf("   ⚠️  警告：余额较低，可能无法支付多次Gas费用")
				}
			}
		}
	}
	
	if len(Relayers) == 0 {
		log.Fatal("❌ 未配置任何Relayer钱包，请设置 PRIVATE_KEY_0 环境变量")
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
	
	// 使用轮询策略选择Relayer
	r := Relayers[relayIdx%len(Relayers)]
	relayIdx++
	
	// 如果只有一个Relayer，始终返回它
	if len(Relayers) == 1 {
		return r
	}
	
	// 对于多个Relayer，可以添加额外的选择逻辑，例如：
	// 1. 检查余额是否充足
	// 2. 检查nonce是否最新
	// 3. 选择最近使用次数最少的
	
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

// AuthHandler 处理认证相关请求
type AuthHandler struct {
	RDB    *redis.Client
	Client *ethclient.Client
}

// NewAuthHandler 创建新的AuthHandler实例
func NewAuthHandler(rdb *redis.Client, client *ethclient.Client) *AuthHandler {
	return &AuthHandler{
		RDB:    rdb,
		Client: client,
	}
}

// GetBinding 获取激活码绑定信息
func (h *AuthHandler) GetBinding(w http.ResponseWriter, r *http.Request) {
	log.Printf("🔔 [REQ] %s %s | From: %s", r.Method, r.URL.Path, r.RemoteAddr)
	
	codeHash := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("codeHash")))
	if codeHash == "" {
		h.sendJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok":    false,
			"error": "缺少 codeHash 参数",
		})
		return
	}
	
	// 验证codeHash格式
	if len(codeHash) != 64 {
		h.sendJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok":    false,
			"error": "codeHash格式错误，应为64字符的十六进制字符串",
		})
		return
	}
	
	ctx := context.Background()
	bindData, err := h.RDB.HGetAll(ctx, "vault:bind:"+codeHash).Result()
	if err != nil || len(bindData) == 0 {
		h.sendJSON(w, http.StatusNotFound, map[string]interface{}{
			"ok":    false,
			"error": "未找到绑定信息",
		})
		return
	}
	
	// 检查激活码是否已使用
	isUsed, _ := h.RDB.SIsMember(ctx, "vault:codes:used", codeHash).Result()
	if isUsed {
		h.sendJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok":    false,
			"error": "激活码已核销",
		})
		return
	}
	
	role := h.determineRole(ctx, codeHash)
	
	// 从环境变量获取书籍合约地址
	bookAddress := os.Getenv("CONTRACT_ADDR")
	
	response := map[string]interface{}{
		"ok":           true,
		"address":      bindData["address"],
		"privateKey":   bindData["privateKey"],
		"role":         role,
		"book_address": bookAddress,
	}
	
	// 添加额外信息
	if role == "reader" {
		response["status"] = "valid"
		response["message"] = "读者激活码有效"
	}
	
	h.sendJSON(w, http.StatusOK, response)
}

// Verify 验证激活码状态
func (h *AuthHandler) Verify(w http.ResponseWriter, r *http.Request) {
	log.Printf("🔔 [REQ] %s %s | From: %s", r.Method, r.URL.Path, r.RemoteAddr)
	
	codeHash := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("codeHash")))
	if codeHash == "" {
		h.sendJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok":    false,
			"error": "缺少 codeHash 参数",
		})
		return
	}
	
	ctx := context.Background()
	
	// 检查激活码是否已使用
	isUsed, _ := h.RDB.SIsMember(ctx, "vault:codes:used", codeHash).Result()
	if isUsed {
		h.sendJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok":    false,
			"error": "该激活码已被使用",
		})
		return
	}
	
	role := h.determineRole(ctx, codeHash)
	address, _ := h.RDB.HGet(ctx, "vault:bind:"+codeHash, "address").Result()
	
	if role == "unknown" {
		h.sendJSON(w, http.StatusNotFound, map[string]interface{}{
			"ok":    false,
			"error": "无效的激活码",
		})
		return
	}
	
	response := map[string]interface{}{
		"ok":      true,
		"role":    role,
		"address": address,
		"status":  "valid",
	}
	
	// 添加角色特定信息
	switch role {
	case "reader":
		response["message"] = "读者身份验证成功"
	case "author":
		response["message"] = "作者身份验证成功"
	case "publisher":
		response["message"] = "出版商身份验证成功"
	}
	
	h.sendJSON(w, http.StatusOK, response)
}

// CheckAdminAccess 检查管理员访问权限
func (h *AuthHandler) CheckAdminAccess(w http.ResponseWriter, r *http.Request) {
	log.Printf("🔔 [REQ] %s %s | From: %s", r.Method, r.URL.Path, r.RemoteAddr)
	
	address := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("address")))
	if address == "" {
		h.sendJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok":    false,
			"error": "缺少 address 参数",
		})
		return
	}
	
	// 验证地址格式
	if !common.IsHexAddress(address) {
		h.sendJSON(w, http.StatusBadRequest, map[string]interface{}{
			"ok":    false,
			"error": "无效的地址格式",
		})
		return
	}
	
	ctx := context.Background()
	isPublisher, _ := h.RDB.SIsMember(ctx, "vault:roles:publishers", address).Result()
	isAuthor, _ := h.RDB.SIsMember(ctx, "vault:roles:authors", address).Result()
	isAdmin, _ := h.RDB.SIsMember(ctx, "vault:roles:admins", address).Result()
	
	hasAccess := isPublisher || isAuthor || isAdmin
	
	response := map[string]interface{}{
		"ok":        true,
		"hasAccess": hasAccess,
		"address":   address,
		"roles": map[string]bool{
			"admin":     isAdmin,
			"publisher": isPublisher,
			"author":    isAuthor,
		},
	}
	
	h.sendJSON(w, http.StatusOK, response)
}

// GetRelayerInfo 获取Relayer信息
func (h *AuthHandler) GetRelayerInfo(w http.ResponseWriter, r *http.Request) {
	log.Printf("🔔 [REQ] %s %s | From: %s", r.Method, r.URL.Path, r.RemoteAddr)
	
	relayMu.Lock()
	defer relayMu.Unlock()
	
	relayerInfos := make([]map[string]interface{}, 0, len(Relayers))
	for i, relayer := range Relayers {
		// 获取余额
		var balance *big.Int
		var balanceCFX float64
		if h.Client != nil {
			balance, _ = h.Client.BalanceAt(context.Background(), common.HexToAddress(relayer.Address), nil)
			if balance != nil {
				balanceCFX, _ = new(big.Float).Quo(
					new(big.Float).SetInt(balance),
					big.NewFloat(1e18),
				).Float64()
			}
		}
		
		relayerInfo := map[string]interface{}{
			"index":       i,
			"address":     relayer.Address,
			"nonce":       relayer.Nonce,
			"balance":     balanceCFX,
			"balance_wei": balance.String(),
			"is_active":   i == (relayIdx % len(Relayers)),
		}
		relayerInfos = append(relayerInfos, relayerInfo)
	}
	
	h.sendJSON(w, http.StatusOK, map[string]interface{}{
		"ok":          true,
		"relayers":    relayerInfos,
		"total":       len(Relayers),
		"current_idx": relayIdx,
	})
}

// Health 健康检查端点
func (h *AuthHandler) Health(w http.ResponseWriter, r *http.Request) {
	response := map[string]interface{}{
		"ok":        true,
		"service":   "vault-auth",
		"timestamp": time.Now().Unix(),
		"version":   "1.0.0",
	}
	
	h.sendJSON(w, http.StatusOK, response)
}

// determineRole 确定激活码的角色
func (h *AuthHandler) determineRole(ctx context.Context, codeHash string) string {
	// 检查是否是出版商激活码
	if isPublisher, _ := h.RDB.SIsMember(ctx, "vault:roles:publishers_codes", codeHash).Result(); isPublisher {
		return "publisher"
	}
	
	// 检查是否是作者激活码
	if isAuthor, _ := h.RDB.SIsMember(ctx, "vault:roles:authors_codes", codeHash).Result(); isAuthor {
		return "author"
	}
	
	// 检查是否是读者激活码
	if isValid, _ := h.RDB.SIsMember(ctx, "vault:codes:valid", codeHash).Result(); isValid {
		return "reader"
	}
	
	return "unknown"
}

// sendJSON 发送JSON响应
func (h *AuthHandler) sendJSON(w http.ResponseWriter, code int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("❌ JSON编码失败: %v", err)
		http.Error(w, "内部服务器错误", http.StatusInternalServerError)
	}
}

// DeriveAddressFromPrivateKey 从私钥派生地址
func DeriveAddressFromPrivateKey(privateKeyHex string) string {
	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil {
		return ""
	}
	return crypto.PubkeyToAddress(privateKey.PublicKey).Hex()
}

// ValidateSignature 验证签名
func ValidateSignature(address, message, signature string) bool {
	if !common.IsHexAddress(address) || signature == "" {
		return false
	}
	
	// 将消息哈希
	messageHash := crypto.Keccak256Hash([]byte(message))
	
	// 解码签名
	sigBytes := common.FromHex(signature)
	if len(sigBytes) != 65 {
		return false
	}
	
	// 恢复公钥
	recoveredPubKey, err := crypto.SigToPub(messageHash.Bytes(), sigBytes)
	if err != nil {
		return false
	}
	
	// 从公钥获取地址
	recoveredAddr := crypto.PubkeyToAddress(*recoveredPubKey)
	
	// 比较地址
	return strings.EqualFold(recoveredAddr.Hex(), address)
}
