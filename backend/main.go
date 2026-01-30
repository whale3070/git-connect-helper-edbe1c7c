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
	r.HandleFunc("/api/v1/market/tickers", marketH.GetTickers).Methods("GET", "OPTIONS") // 添加完整路径
	r.HandleFunc("/api/v1/factory/deploy-book", deployBookHandler).Methods("POST", "OPTIONS") // 出版社部署书籍
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
	
	// 新增：出版社余额查询
	r.HandleFunc("/api/v1/publisher/balance", getPublisherBalanceHandler).Methods("GET", "OPTIONS")

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

// 出版社部署书籍合约
func deployBookHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CodeHash   string `json:"codeHash"`   // 出版社的激活码哈希
		BookName   string `json:"bookName"`   // 书籍名称
		AuthorName string `json:"authorName"` // 作者名称
		Symbol     string `json:"symbol"`     // 书籍代码
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, 400, map[string]interface{}{"ok": false, "error": "参数格式错误"})
		return
	}

	// 1. 验证出版社身份
	isPubCode, _ := rdb.SIsMember(ctx, "vault:roles:publishers_codes", req.CodeHash).Result()
	if !isPubCode {
		sendJSON(w, 403, map[string]interface{}{"ok": false, "error": "非出版社身份，无权部署"})
		return
	}

	// 2. 从 Redis 获取出版社私钥（金库协议统一存储格式）
	// 格式: vault:bind:{codeHash} -> {"address": "0x...", "private_key": "xxx", "role": "publisher"}
	pubData, err := rdb.HGetAll(ctx, "vault:bind:"+req.CodeHash).Result()
	if err != nil || len(pubData) == 0 {
		sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "无法获取出版社密钥信息"})
		return
	}

	privateKeyHex := pubData["private_key"]
	publisherAddress := pubData["address"]

	if privateKeyHex == "" || publisherAddress == "" {
		sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "出版社密钥配置不完整"})
		return
	}

	// 3. 解析私钥
	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil {
		sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "私钥格式无效"})
		return
	}

	// 4. 检查余额是否足够（需要 1 CFX 部署费 + Gas）
	pubAddr := common.HexToAddress(publisherAddress)
	balance, err := client.BalanceAt(ctx, pubAddr, nil)
	if err != nil {
		sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "无法查询余额: " + err.Error()})
		return
	}

	// 需要至少 1.5 CFX (1 CFX 部署费 + 0.5 CFX Gas 预留)
	minRequired := new(big.Int).Mul(big.NewInt(15), big.NewInt(1e17)) // 1.5 * 10^18
	if balance.Cmp(minRequired) < 0 {
		actualBalance := new(big.Float).Quo(new(big.Float).SetInt(balance), big.NewFloat(1e18))
		sendJSON(w, 400, map[string]interface{}{
			"ok":      false,
			"error":   fmt.Sprintf("余额不足 (当前: %.4f CFX)，部署书籍合约需至少 1.5 CFX", actualBalance),
			"balance": fmt.Sprintf("%.4f", actualBalance),
		})
		return
	}

	// 5. 构建调用工厂合约的交易
	factoryAddr := os.Getenv("FACTORY_CONTRACT_ADDR")
	if factoryAddr == "" {
		factoryAddr = "0xfd19cc70af0a45d032df566ef8cc8027189fd5f3" // 默认工厂合约地址
	}

	// 获取 Relayer 地址（用于代付 Mint Gas）
	relayerAddr := common.Address{}
	if len(relayers) > 0 {
		relayerAddr = relayers[0].Address
	}

	// 手动编码参数（复杂，使用辅助函数）
	callData := encodeDeployBookCall(req.BookName, req.Symbol, req.AuthorName, "https://arweave.net/metadata", relayerAddr)
	if callData == nil {
		sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "编码交易数据失败"})
		return
	}

	// 6. 获取 Nonce 和 Gas Price
	nonce, err := client.PendingNonceAt(ctx, pubAddr)
	if err != nil {
		sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "获取 Nonce 失败"})
		return
	}

	gasPrice, err := client.SuggestGasPrice(ctx)
	if err != nil {
		sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "获取 Gas 价格失败"})
		return
	}

	// 7. 创建交易（发送 1 CFX 作为部署费）
	deployFee := new(big.Int).Mul(big.NewInt(1), big.NewInt(1e18)) // 1 CFX
	tx := types.NewTransaction(
		nonce,
		common.HexToAddress(factoryAddr),
		deployFee,
		uint64(3000000), // Gas Limit (部署合约需要更多)
		gasPrice,
		callData,
	)

	// 8. 签名交易
	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(chainID), privateKey)
	if err != nil {
		sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "签名交易失败: " + err.Error()})
		return
	}

	// 9. 发送交易
	err = client.SendTransaction(ctx, signedTx)
	if err != nil {
		sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "发送交易失败: " + err.Error()})
		return
	}

	txHash := signedTx.Hash().Hex()
	fmt.Printf("📚 书籍合约部署中 | 出版社: %s | 书名: %s | TX: %s\n", publisherAddress, req.BookName, txHash)

	// 10. 记录到 Redis 大盘（初始销量为 0）
	bookKey := fmt.Sprintf("%s:%s:%s", req.Symbol, req.BookName, req.AuthorName)
	rdb.HSet(ctx, "vault:books:pending", txHash, bookKey)

	sendJSON(w, 200, map[string]interface{}{
		"ok":        true,
		"txHash":    txHash,
		"status":    "PENDING",
		"message":   "书籍合约部署交易已提交，请等待链上确认",
		"bookName":  req.BookName,
		"symbol":    req.Symbol,
		"author":    req.AuthorName,
		"publisher": publisherAddress,
	})
}

// encodeDeployBookCall 编码 deployBook 函数调用
func encodeDeployBookCall(bookName, symbol, authorName, baseURI string, relayer common.Address) []byte {
	// 函数选择器: deployBook(string,string,string,string,address)
	// 需要手动进行 ABI 编码

	// 方法 ID (4 bytes)
	methodID := common.FromHex("3d4bd2ed")

	// 编码动态参数偏移量 (5 个参数: 4个string + 1个address)
	// string 是动态类型，address 是静态类型
	// 偏移量布局:
	// [0-31]   string1 offset
	// [32-63]  string2 offset
	// [64-95]  string3 offset
	// [96-127] string4 offset
	// [128-159] address (静态，直接存值)
	// [160+]   动态数据区

	// 先计算各个偏移量
	headerSize := 32 * 5 // 5个参数槽位

	// 编码字符串函数
	encodeString := func(s string) []byte {
		strBytes := []byte(s)
		// 长度 (32 bytes)
		length := make([]byte, 32)
		big.NewInt(int64(len(strBytes))).FillBytes(length)
		// 数据 (填充到32字节倍数)
		paddedLen := ((len(strBytes) + 31) / 32) * 32
		data := make([]byte, paddedLen)
		copy(data, strBytes)
		return append(length, data...)
	}

	// 编码各个字符串
	str1Data := encodeString(bookName)
	str2Data := encodeString(symbol)
	str3Data := encodeString(authorName)
	str4Data := encodeString(baseURI)

	// 计算偏移量
	offset1 := headerSize
	offset2 := offset1 + len(str1Data)
	offset3 := offset2 + len(str2Data)
	offset4 := offset3 + len(str3Data)

	// 构建编码数据
	result := make([]byte, 0)
	result = append(result, methodID...)

	// 偏移量1
	off1Bytes := make([]byte, 32)
	big.NewInt(int64(offset1)).FillBytes(off1Bytes)
	result = append(result, off1Bytes...)

	// 偏移量2
	off2Bytes := make([]byte, 32)
	big.NewInt(int64(offset2)).FillBytes(off2Bytes)
	result = append(result, off2Bytes...)

	// 偏移量3
	off3Bytes := make([]byte, 32)
	big.NewInt(int64(offset3)).FillBytes(off3Bytes)
	result = append(result, off3Bytes...)

	// 偏移量4
	off4Bytes := make([]byte, 32)
	big.NewInt(int64(offset4)).FillBytes(off4Bytes)
	result = append(result, off4Bytes...)

	// address (填充到32字节)
	addrBytes := make([]byte, 32)
	copy(addrBytes[12:], relayer.Bytes())
	result = append(result, addrBytes...)

	// 动态数据
	result = append(result, str1Data...)
	result = append(result, str2Data...)
	result = append(result, str3Data...)
	result = append(result, str4Data...)

	return result
}

// getPublisherBalanceHandler 查询出版社钱包余额
func getPublisherBalanceHandler(w http.ResponseWriter, r *http.Request) {
	codeHash := r.URL.Query().Get("codeHash")
	fmt.Printf("📊 [Balance] 收到余额查询请求, codeHash: %s\n", codeHash)
	
	if codeHash == "" {
		sendJSON(w, 400, map[string]interface{}{"ok": false, "error": "缺少 codeHash 参数"})
		return
	}

	// 从 Redis 获取出版社信息
	redisKey := "vault:bind:" + codeHash
	fmt.Printf("📊 [Balance] 查询 Redis key: %s\n", redisKey)
	
	pubData, err := rdb.HGetAll(ctx, redisKey).Result()
	if err != nil {
		fmt.Printf("❌ [Balance] Redis 错误: %v\n", err)
		sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "Redis 查询失败: " + err.Error()})
		return
	}
	
	if len(pubData) == 0 {
		fmt.Printf("❌ [Balance] Redis 未找到数据, key: %s\n", redisKey)
		sendJSON(w, 404, map[string]interface{}{"ok": false, "error": "未找到出版社信息"})
		return
	}
	
	fmt.Printf("📊 [Balance] Redis 数据: %+v\n", pubData)

	// 验证角色
	role := pubData["role"]
	if role != "publisher" {
		fmt.Printf("❌ [Balance] 角色不匹配: %s (期望 publisher)\n", role)
		sendJSON(w, 403, map[string]interface{}{"ok": false, "error": "非出版社账户，当前角色: " + role})
		return
	}

	publisherAddress := pubData["address"]
	if publisherAddress == "" {
		fmt.Printf("❌ [Balance] 地址为空\n")
		sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "出版社地址无效"})
		return
	}

	fmt.Printf("📊 [Balance] 查询地址: %s\n", publisherAddress)

	// 查询链上余额
	address := common.HexToAddress(publisherAddress)
	balance, err := client.BalanceAt(ctx, address, nil)
	if err != nil {
		fmt.Printf("❌ [Balance] 链上查询失败: %v\n", err)
		sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "无法查询链上余额: " + err.Error()})
		return
	}

	fmt.Printf("📊 [Balance] 原始余额(Wei): %s\n", balance.String())

	// 转换为 CFX (1 CFX = 10^18 Wei)
	balanceFloat := new(big.Float).Quo(new(big.Float).SetInt(balance), big.NewFloat(1e18))
	balanceCFX, _ := balanceFloat.Float64()

	// 部署费用：1 CFX + 预估 Gas 费 ~0.5 CFX = 1.5 CFX
	deployFee := 1.5
	maxDeploys := int(balanceCFX / deployFee)

	fmt.Printf("✅ [Balance] 查询成功: %.4f CFX, 可部署 %d 次\n", balanceCFX, maxDeploys)

	sendJSON(w, 200, map[string]interface{}{
		"ok":          true,
		"address":     publisherAddress,
		"balance":     balanceCFX,
		"balanceWei":  balance.String(),
		"deployFee":   deployFee,
		"maxDeploys":  maxDeploys,
	})
}