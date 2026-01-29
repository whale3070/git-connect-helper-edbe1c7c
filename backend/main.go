package main

import (
	"context"
	"crypto/ecdsa"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"

	"whale-vault/relay/internal/blockchain"
	"whale-vault/relay/internal/handlers"
)

// --- 结构体定义 ---

type Relayer struct {
	PrivateKey *ecdsa.PrivateKey
	Address    common.Address
	mu         sync.Mutex // 保持并发安全
}

type CommonResponse struct {
	Ok      bool   `json:"ok"`
	Status  string `json:"status,omitempty"`
	TxHash  string `json:"txHash,omitempty"`
	Error   string `json:"error,omitempty"`
	Role    string `json:"role,omitempty"`
	Address string `json:"address,omitempty"`
}

// --- 全局变量 ---

var (
	ctx            = context.Background()
	rdb            *redis.Client
	client         *ethclient.Client
	relayers       []*Relayer
	relayerCounter uint64
	chainID        *big.Int
	relayH         *handlers.RelayHandler
	marketH        *handlers.MarketHandler
	factoryH       *blockchain.BookFactory
)

func main() {
	godotenv.Load()

	// 1. 初始化 Redis
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}
	rdb = redis.NewClient(&redis.Options{
		Addr: redisAddr,
	})

	// 2. 初始化以太坊客户端
	var err error
	client, err = ethclient.Dial(os.Getenv("RPC_URL"))
	if err != nil {
		log.Fatalf("RPC连接失败: %v", err)
	}

	cidStr := os.Getenv("CHAIN_ID")
	cInt, _ := strconv.ParseInt(cidStr, 10, 64)
	chainID = big.NewInt(cInt)

	loadRelayers()

	relayH = &handlers.RelayHandler{RDB: rdb, Client: client}
	marketH = &handlers.MarketHandler{RDB: rdb}
	factoryH = &blockchain.BookFactory{RDB: rdb, Client: client}

	r := mux.NewRouter()

	// 全局请求日志中间件
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fmt.Printf("🔔 [REQ] %s %s | From: %s\n", r.Method, r.URL.Path, r.RemoteAddr)
			next.ServeHTTP(w, r)
		})
	})

	// --- 路由挂载 ---
	r.HandleFunc("/api/v1/precheck-code", precheckCodeHandler).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/factory/verify-publisher", verifyPublisherHandler).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/factory/create", createBookHandler).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/v1/tickers", marketH.GetTickers).Methods("GET", "OPTIONS")
	r.HandleFunc("/secret/get-binding", getBindingHandler).Methods("GET", "OPTIONS")
	r.HandleFunc("/secret/verify", verifyHandler).Methods("GET", "OPTIONS")
	r.HandleFunc("/relay/mint", mintHandler).Methods("POST", "OPTIONS")
	r.HandleFunc("/relay/save-code", relayH.SaveCode).Methods("POST", "OPTIONS")
	r.HandleFunc("/relay/reward", relayH.Reward).Methods("POST", "OPTIONS")
	r.HandleFunc("/relay/stats", relayH.GetReferrerStats).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/admin/check-access", checkAdminAccessHandler).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/analytics/distribution", relayH.GetDistribution).Methods("GET", "OPTIONS")
	
	// 新增：NFT 统计 & 读者位置
	r.HandleFunc("/api/v1/nft/total-minted", getTotalMintedHandler).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/reader/location", getReaderLocationHandler).Methods("GET", "OPTIONS")

	port := "8080"
	fmt.Printf("🚀 Whale Vault 后端启动成功 (监听端口: %s)\n", port)
	
	srv := &http.Server{
		Addr:    "0.0.0.0:" + port,
		Handler: cors(r),
	}
	log.Fatal(srv.ListenAndServe())
}

// --- 业务处理器实现 ---

func getBindingHandler(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("codeHash")
	data, err := rdb.HGetAll(ctx, "vault:bind:"+code).Result()
	if err != nil || len(data) == 0 {
		fmt.Printf("⚠️  Binding 未找到: %s\n", code)
		sendJSON(w, 200, CommonResponse{Ok: false, Error: "No binding found"})
		return
	}
	sendJSON(w, 200, CommonResponse{Ok: true, Address: data["address"]})
}

func verifyHandler(w http.ResponseWriter, r *http.Request) {
	addr := strings.ToLower(r.URL.Query().Get("address"))
	code := r.URL.Query().Get("codeHash")

	if addr == "" || code == "" {
		sendJSON(w, 400, CommonResponse{Ok: false, Error: "Missing params"})
		return
	}

	// 1. 检查出版社激活码
	isPubCode, _ := rdb.SIsMember(ctx, "vault:roles:publishers_codes", code).Result()
	if isPubCode {
		rdb.SAdd(ctx, "vault:roles:publishers", addr)
		sendJSON(w, 200, CommonResponse{Ok: true, Role: "publisher"})
		return
	}

	// 2. 检查作者激活码
	isAuthorCode, _ := rdb.SIsMember(ctx, "vault:roles:authors_codes", code).Result()
	if isAuthorCode {
		rdb.SAdd(ctx, "vault:roles:authors", addr)
		sendJSON(w, 200, CommonResponse{Ok: true, Role: "author"})
		return
	}

	// 3. 检查读者激活码
	isValid, _ := rdb.SIsMember(ctx, "vault:codes:valid", code).Result()
	isUsed, _ := rdb.SIsMember(ctx, "vault:codes:used", code).Result()

	if isValid || isUsed {
		sendJSON(w, 200, CommonResponse{Ok: true, Role: "reader"})
		return
	}

	sendJSON(w, 403, CommonResponse{Ok: false, Error: "Unauthorized"})
}

func mintHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Dest     string `json:"dest"`
		CodeHash string `json:"codeHash"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, 400, CommonResponse{Ok: false, Error: "Invalid JSON"})
		return
	}

	isPubCode, _ := rdb.SIsMember(ctx, "vault:roles:publishers_codes", req.CodeHash).Result()
	if isPubCode {
		rdb.SAdd(ctx, "vault:roles:publishers", strings.ToLower(req.Dest))
		sendJSON(w, 200, CommonResponse{Ok: true, Status: "PUBLISHER_AUTHORIZED", Role: "publisher"})
		return
	}

	removed, _ := rdb.SRem(ctx, "vault:codes:valid", req.CodeHash).Result()
	if removed == 0 {
		alreadyUsed, _ := rdb.SIsMember(ctx, "vault:codes:used", req.CodeHash).Result()
		if alreadyUsed {
			sendJSON(w, 200, CommonResponse{Ok: true, Status: "ALREADY_MINTED", Role: "reader"})
			return
		}
		sendJSON(w, 403, CommonResponse{Ok: false, Error: "Code invalid or used"})
		return
	}

	// 🌟 抓取读者 IP 并存入 Redis 热力图数据
	clientIP := getClientIP(r)
	if clientIP != "" {
		// 存入 IP 集合用于热力图
		rdb.SAdd(ctx, "vault:heatmap:ips", clientIP)
		// 记录 IP 与时间戳
		rdb.HSet(ctx, "vault:heatmap:ip_time", clientIP, time.Now().Unix())
		fmt.Printf("📍 读者 IP 已记录: %s\n", clientIP)
	}

	txHash, err := executeMintLegacy(req.Dest)
	if err != nil {
		// 失败回滚到有效池
		rdb.SAdd(ctx, "vault:codes:valid", req.CodeHash) 
		sendJSON(w, 500, CommonResponse{Ok: false, Error: err.Error()})
		return
	}

	rdb.SAdd(ctx, "vault:codes:used", req.CodeHash)
	sendJSON(w, 200, CommonResponse{Ok: true, TxHash: txHash, Role: "reader"})
}

// 获取客户端真实 IP
func getClientIP(r *http.Request) string {
	// 优先检查代理头
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}
	// 直连情况
	ip := r.RemoteAddr
	if colonIdx := strings.LastIndex(ip, ":"); colonIdx != -1 {
		ip = ip[:colonIdx]
	}
	return ip
}

// 获取链上 NFT 总铸造数量
func getTotalMintedHandler(w http.ResponseWriter, r *http.Request) {
	contractAddr := os.Getenv("CONTRACT_ADDR")
	if contractAddr == "" {
		sendJSON(w, 500, map[string]interface{}{"error": "CONTRACT_ADDR not configured"})
		return
	}

	// 调用合约的 totalSales() 方法 - 方法签名: 7912d7c5 (不带0x前缀)
	methodID := common.FromHex("7912d7c5")
	
	toAddr := common.HexToAddress(contractAddr)
	msg := ethereum.CallMsg{
		To:   &toAddr,
		Data: methodID,
	}

	result, err := client.CallContract(ctx, msg, nil)
	if err != nil {
		fmt.Printf("❌ 查询 totalSales 失败: %v\n", err)
		sendJSON(w, 500, map[string]interface{}{"error": err.Error()})
		return
	}

	// 解析返回的 uint256 (处理空返回)
	var total int64 = 0
	if len(result) > 0 {
		total = new(big.Int).SetBytes(result).Int64()
	}
	sendJSON(w, 200, map[string]interface{}{"total": total})
}

// 获取读者地理位置（基于 IP）
func getReaderLocationHandler(w http.ResponseWriter, r *http.Request) {
	clientIP := getClientIP(r)
	if clientIP == "" || clientIP == "127.0.0.1" || strings.HasPrefix(clientIP, "192.168.") {
		sendJSON(w, 200, map[string]string{"city": "本地开发", "country": "CN"})
		return
	}

	// 使用免费 IP 地理位置 API
	resp, err := http.Get(fmt.Sprintf("http://ip-api.com/json/%s?lang=zh-CN", clientIP))
	if err != nil {
		sendJSON(w, 200, map[string]string{"city": "未知", "country": "未知"})
		return
	}
	defer resp.Body.Close()

	var geoData struct {
		City    string `json:"city"`
		Region  string `json:"regionName"`
		Country string `json:"country"`
		Lat     float64 `json:"lat"`
		Lon     float64 `json:"lon"`
	}
	json.NewDecoder(resp.Body).Decode(&geoData)

	// 同时存入热力图坐标数据
	if geoData.Lat != 0 && geoData.Lon != 0 {
		locKey := fmt.Sprintf("%s_%s", geoData.City, geoData.Country)
		// 存储格式: "城市_国家" -> "经度,纬度,计数"
		existingData, _ := rdb.HGet(ctx, "vault:heatmap:locations", locKey).Result()
		count := 1
		if existingData != "" {
			parts := strings.Split(existingData, ",")
			if len(parts) == 3 {
				oldCount, _ := strconv.Atoi(parts[2])
				count = oldCount + 1
			}
		}
		rdb.HSet(ctx, "vault:heatmap:locations", locKey, fmt.Sprintf("%f,%f,%d", geoData.Lon, geoData.Lat, count))
	}

	sendJSON(w, 200, map[string]string{
		"city":    geoData.City,
		"region":  geoData.Region,
		"country": geoData.Country,
	})
}

// --- 核心修复：调用 NFT 合约的 mint(address to) 方法 ---

func executeMintLegacy(to string) (string, error) {
	if len(relayers) == 0 {
		return "", fmt.Errorf("no relayers available")
	}

	// 获取 NFT 合约地址（子合约）
	contractAddr := os.Getenv("CONTRACT_ADDR")
	if contractAddr == "" {
		return "", fmt.Errorf("CONTRACT_ADDR not configured")
	}

	// 1. 选择 Relayer
	idx := atomic.AddUint64(&relayerCounter, 1) % uint64(len(relayers))
	rel := relayers[idx]
	
	rel.mu.Lock()
	defer rel.mu.Unlock()

	// 2. 实时获取链上 Pending Nonce
	nonce, err := client.PendingNonceAt(ctx, rel.Address)
	if err != nil {
		return "", fmt.Errorf("failed to fetch nonce: %v", err)
	}

	// 3. 获取实时建议 Gas 价格
	gasPrice, err := client.SuggestGasPrice(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to suggest gas price: %v", err)
	}

	// 4. 构建合约调用 Data: mint(address to) -> 方法签名 0x6a627842
	// mint(address) 的函数选择器是 keccak256("mint(address)")[:4] = 0x6a627842
	methodID := common.FromHex("0x6a627842")
	// 将目标地址填充为 32 字节
	paddedAddress := common.LeftPadBytes(common.HexToAddress(to).Bytes(), 32)
	// 拼接 calldata: 方法选择器 + 参数
	data := append(methodID, paddedAddress...)

	// 5. 构建交易 - 调用合约而非普通转账
	gasLimit := uint64(200000) // Mint 操作需要更多 Gas
	tx := types.NewTransaction(
		nonce,
		common.HexToAddress(contractAddr), // 目标是 NFT 合约地址
		big.NewInt(0),                      // 不发送 CFX
		gasLimit,
		gasPrice,
		data, // 合约调用数据
	)
	
	// 6. 签名
	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(chainID), rel.PrivateKey)
	if err != nil {
		return "", fmt.Errorf("failed to sign tx: %v", err)
	}

	// 7. 发送交易
	err = client.SendTransaction(ctx, signedTx)
	if err != nil {
		fmt.Printf("❌ Relayer %s Mint失败: %v\n", rel.Address.Hex(), err)
		return "", err
	}

	fmt.Printf("🚀 Mint成功 | 合约: %s | 接收者: %s | TX: %s | Nonce: %d\n", 
		contractAddr, to, signedTx.Hash().Hex(), nonce)
	return signedTx.Hash().Hex(), nil
}

func loadRelayers() {
	countStr := os.Getenv("RELAYER_COUNT")
	count, _ := strconv.Atoi(countStr)
	for i := 0; i < count; i++ {
		key := os.Getenv(fmt.Sprintf("PRIVATE_KEY_%d", i))
		if key == "" { continue }
		priv, err := crypto.HexToECDSA(strings.TrimPrefix(key, "0x"))
		if err != nil {
			log.Printf("加载密钥 PRIVATE_KEY_%d 失败: %v", i, err)
			continue
		}
		relayers = append(relayers, &Relayer{
			PrivateKey: priv,
			Address:    crypto.PubkeyToAddress(priv.PublicKey),
		})
	}
	fmt.Printf("✅ 已加载 %d 个中继器钱包\n", len(relayers))
}

func sendJSON(w http.ResponseWriter, code int, p interface{}) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(p)
}

func cors(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		h.ServeHTTP(w, r)
	})
}

// 空实现保持编译通过
func precheckCodeHandler(w http.ResponseWriter, r *http.Request) { sendJSON(w, 200, CommonResponse{Ok: true}) }
func verifyPublisherHandler(w http.ResponseWriter, r *http.Request) { sendJSON(w, 200, CommonResponse{Ok: true}) }
func createBookHandler(w http.ResponseWriter, r *http.Request) { sendJSON(w, 200, CommonResponse{Ok: true}) }
func checkAdminAccessHandler(w http.ResponseWriter, r *http.Request) { sendJSON(w, 200, CommonResponse{Ok: true}) }