package main

import (
	"context"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strconv"
	"strings"
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

// ========================================
// 全局变量
// ========================================
var (
	ctx     = context.Background()
	rdb     *redis.Client
	client  *ethclient.Client
	chainID *big.Int
)

// ========================================
// NFT Stats (ERC-721 Transfer logs)
// ========================================

var (
	// ERC721 Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
	transferSigHash = common.HexToHash("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")

	zeroTopic = "0x0000000000000000000000000000000000000000000000000000000000000000"
	// Conflux eSpace 常见系统/预留地址（你要求过滤的那个）
	systemUser = "0x0000000000000000000000000000000000001000"
)

type NFTStatsJob struct {
	RDB           *redis.Client
	Client        *ethclient.Client
	Contract      common.Address
	FromBlockHint uint64        // 合约部署区块（强烈建议配上）
	Interval      time.Duration // 例如 30s/1m/5m
	ChunkSize     uint64        // 分段扫区块，避免 RPC 超时（例如 50_000）
	Logger        *log.Logger
}

// Start 启动定时任务（建议 goroutine）
func (j *NFTStatsJob) Start(ctx context.Context) {
	if j.Interval <= 0 {
		j.Interval = 1 * time.Minute
	}
	if j.ChunkSize == 0 {
		j.ChunkSize = 50_000
	}

	// 启动时先跑一遍
	j.runOnce(ctx)

	ticker := time.NewTicker(j.Interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			j.logf("NFTStatsJob stopped: %v", ctx.Err())
			return
		case <-ticker.C:
			j.runOnce(ctx)
		}
	}
}

func (j *NFTStatsJob) runOnce(ctx context.Context) {
	if j.RDB == nil || j.Client == nil {
		j.logf("NFTStatsJob missing deps: rdb/client nil")
		return
	}

	contract := strings.ToLower(j.Contract.Hex())

	// Redis keys
	keyPrefix := fmt.Sprintf("vault:stats:nft:%s", contract)
	keyLast := keyPrefix + ":last_block"
	keyMinted := keyPrefix + ":minted_total"
	keyUnique := keyPrefix + ":unique_minters"
	keyReal := keyPrefix + ":unique_real_users"
	keyMintersSet := keyPrefix + ":minters:set"
	keyRealSet := keyPrefix + ":real_users:set"

	// 读 last scanned block（增量）
	startBlock := j.FromBlockHint
	if v, err := j.RDB.Get(ctx, keyLast).Result(); err == nil && v != "" {
		if b, ok := new(big.Int).SetString(v, 10); ok {
			startBlock = b.Uint64() + 1
		}
	}

	latest, err := j.Client.BlockNumber(ctx)
	if err != nil {
		j.logf("BlockNumber error: %v", err)
		return
	}
	if startBlock > latest {
		return
	}

	var (
		mintedInc   int64
		toBlockDone uint64
	)

	for from := startBlock; from <= latest; {
		to := from + j.ChunkSize - 1
		if to > latest {
			to = latest
		}

		logs, err := j.fetchTransferLogs(ctx, from, to)
		if err != nil {
			j.logf("FilterLogs %d-%d error: %v", from, to, err)
			return
		}

		for _, lg := range logs {
			if len(lg.Topics) < 3 {
				continue
			}

			// Mint: from == 0x0
			fromTopic := strings.ToLower(lg.Topics[1].Hex())
			if fromTopic != zeroTopic {
				continue
			}

			mintedInc++

			toAddr := strings.ToLower(topicToAddress(lg.Topics[2]))

			// 领取者集合
			_ = j.RDB.SAdd(ctx, keyMintersSet, toAddr).Err()

			// 过滤系统地址后的真实用户集合
			if toAddr != systemUser {
				_ = j.RDB.SAdd(ctx, keyRealSet, toAddr).Err()
			}
		}

		toBlockDone = to
		from = to + 1
	}

	// minted_total：增量累加
	if mintedInc > 0 {
		_ = j.RDB.IncrBy(ctx, keyMinted, mintedInc).Err()
	}

	// unique_*：以 SCARD 为准（最稳）
	uniqueMinters, _ := j.RDB.SCard(ctx, keyMintersSet).Result()
	uniqueReal, _ := j.RDB.SCard(ctx, keyRealSet).Result()

	_ = j.RDB.Set(ctx, keyUnique, uniqueMinters, 0).Err()
	_ = j.RDB.Set(ctx, keyReal, uniqueReal, 0).Err()

	// 更新 last scanned block
	_ = j.RDB.Set(ctx, keyLast, fmt.Sprintf("%d", toBlockDone), 0).Err()

	mintedTotal, _ := j.RDB.Get(ctx, keyMinted).Result()
	j.logf("NFTStats updated contract=%s blocks=%d..%d minted+%d (total=%s) unique=%d real=%d",
		contract, startBlock, toBlockDone, mintedInc, mintedTotal, uniqueMinters, uniqueReal,
	)
}

func (j *NFTStatsJob) fetchTransferLogs(ctx context.Context, from, to uint64) ([]types.Log, error) {
	q := ethereum.FilterQuery{
		FromBlock: big.NewInt(int64(from)),
		ToBlock:   big.NewInt(int64(to)),
		Addresses: []common.Address{j.Contract},
		Topics:    [][]common.Hash{{transferSigHash}},
	}
	return j.Client.FilterLogs(ctx, q)
}

func topicToAddress(topic common.Hash) string {
	b := topic.Bytes() // 32 bytes
	return "0x" + hex.EncodeToString(b[12:]) // last 20 bytes
}

func (j *NFTStatsJob) logf(format string, args ...any) {
	if j.Logger != nil {
		j.Logger.Printf(format, args...)
	} else {
		log.Printf(format, args...)
	}
}

// 读 stats 给前端
func nftStatsHandler() http.HandlerFunc {
	type resp struct {
		Ok   bool   `json:"ok"`
		Error string `json:"error,omitempty"`
		Data  any    `json:"data,omitempty"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		contract := strings.TrimSpace(r.URL.Query().Get("contract"))
		if contract == "" {
			// 允许走默认
			contract = strings.TrimSpace(os.Getenv("NFT_STATS_CONTRACT"))
		}
		if !isHexAddress(contract) {
			writeJSON(w, http.StatusBadRequest, resp{Ok: false, Error: "invalid contract"})
			return
		}
		contract = strings.ToLower(contract)

		keyPrefix := fmt.Sprintf("vault:stats:nft:%s", contract)
		keyLast := keyPrefix + ":last_block"
		keyMinted := keyPrefix + ":minted_total"
		keyUnique := keyPrefix + ":unique_minters"
		keyReal := keyPrefix + ":unique_real_users"

		last, _ := rdb.Get(ctx, keyLast).Result()
		minted, _ := rdb.Get(ctx, keyMinted).Result()
		unique, _ := rdb.Get(ctx, keyUnique).Result()
		real, _ := rdb.Get(ctx, keyReal).Result()

		// 统一为数字（读不到就给 0）
		toInt := func(s string) int64 {
			s = strings.TrimSpace(s)
			if s == "" {
				return 0
			}
			v, err := strconv.ParseInt(s, 10, 64)
			if err != nil {
				return 0
			}
			return v
		}

		writeJSON(w, http.StatusOK, resp{
			Ok: true,
			Data: map[string]any{
				"contract":           contract,
				"minted_total":       toInt(minted),
				"unique_minters":     toInt(unique),
				"unique_real_users":  toInt(real),
				"last_scanned_block": toInt(last),
			},
		})
	}
}

func main() {
	// ========================================
	// 1. 初始化基础环境
	// ========================================
	_ = godotenv.Load("/root/git-connect-helper-edbe1c7c/backend/.env")
	if err := godotenv.Load("/root/git-connect-helper-edbe1c7c/backend/.env"); err != nil {
		log.Println("⚠️ 未加载 .env:", err)
	} else {
		log.Println("✅ 已加载 .env")
	}

	// 初始化 Redis
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}
	rdb = redis.NewClient(&redis.Options{
		Addr:     redisAddr,
		Protocol: 2, // ✅ 强制 RESP2
	})
	log.Println("✅ Redis 连接成功, addr =", redisAddr)

	// 初始化以太坊客户端
	var err error
	rpcURL := strings.TrimSpace(os.Getenv("RPC_URL"))
	if rpcURL == "" {
		log.Fatal("❌ RPC_URL 未设置")
	}
	client, err = ethclient.Dial(rpcURL)
	if err != nil {
		log.Fatalf("❌ RPC 连接失败: %v", err)
	}
	log.Println("✅ 以太坊客户端连接成功")

	// 解析 Chain ID
	cidStr := strings.TrimSpace(os.Getenv("CHAIN_ID"))
	if cidStr == "" {
		log.Fatal("❌ CHAIN_ID 未设置")
	}
	cInt, err := strconv.ParseInt(cidStr, 10, 64)
	if err != nil || cInt <= 0 {
		log.Fatalf("❌ CHAIN_ID 无效: %s", cidStr)
	}
	chainID = big.NewInt(cInt)

	// ========================================
	// 2. 加载中继器钱包
	// ========================================
	handlers.LoadRelayers(client, chainID)

	// ========================================
	// 3. 实例化业务处理器 (依赖注入)
	// ========================================

	relayH := &handlers.RelayHandler{
		RDB:    rdb,
		Client: client,
	}

	marketH := &handlers.MarketHandler{
		RDB: rdb,
	}

	factoryH := &handlers.FactoryHandler{
		RDB:     rdb,
		Client:  client,
		ChainID: chainID,
	}

	mintH := &handlers.MintHandler{
		RDB:    rdb,
		Client: client,
	}

	authH := &handlers.AuthHandler{
		RDB:    rdb,
		Client: client,
	}

	// ✅ 出版社处理器
	factoryAddr := strings.TrimSpace(os.Getenv("FACTORY_ADDR"))
	if factoryAddr == "" {
		log.Println("⚠️ FACTORY_ADDR 未设置：publisher.CreateBook 将无法正常调用工厂合约")
	}
	publisherH := &handlers.PublisherHandler{
		RDB:         rdb,
		Client:      client,
		FactoryAddr: factoryAddr,
	}

	// ========================================
	// 3.5 启动 NFT 统计任务（可选，但你要的就在这）
	// ========================================
	nftContract := strings.TrimSpace(os.Getenv("NFT_STATS_CONTRACT"))
	if nftContract != "" && isHexAddress(nftContract) {
		fromBlockHint := uint64(0)
		if v := strings.TrimSpace(os.Getenv("NFT_STATS_FROM_BLOCK")); v != "" {
			if u, e := strconv.ParseUint(v, 10, 64); e == nil {
				fromBlockHint = u
			}
		}

		interval := 1 * time.Minute
		if v := strings.TrimSpace(os.Getenv("NFT_STATS_INTERVAL_SECONDS")); v != "" {
			if sec, e := strconv.ParseInt(v, 10, 64); e == nil && sec > 0 {
				interval = time.Duration(sec) * time.Second
			}
		}

		chunk := uint64(50_000)
		if v := strings.TrimSpace(os.Getenv("NFT_STATS_CHUNK")); v != "" {
			if u, e := strconv.ParseUint(v, 10, 64); e == nil && u > 0 {
				chunk = u
			}
		}

		job := &NFTStatsJob{
			RDB:           rdb,
			Client:        client,
			Contract:      common.HexToAddress(nftContract),
			FromBlockHint: fromBlockHint,
			Interval:      interval,
			ChunkSize:     chunk,
			Logger:        log.Default(),
		}

		go job.Start(ctx)
		log.Printf("📊 NFTStatsJob started: contract=%s fromBlock=%d interval=%s chunk=%d",
			strings.ToLower(common.HexToAddress(nftContract).Hex()), fromBlockHint, interval.String(), chunk)
	} else {
		log.Println("ℹ️ NFT_STATS_CONTRACT 未配置或无效：跳过 NFTStatsJob（如需启用，在 .env 配 NFT_STATS_CONTRACT=0x...）")
	}

	// ========================================
	// 4. 注册路由
	// ========================================
	r := mux.NewRouter()
	r.Use(requestLoggerMiddleware)

	// --- 身份验证路由 ---
	r.HandleFunc("/secret/get-binding", authH.GetBinding).Methods("GET", "OPTIONS")
	r.HandleFunc("/secret/verify", authH.Verify).Methods("GET", "OPTIONS")

	// --- 读者端路由 (Relay 业务) ---
	r.HandleFunc("/relay/save-code", relayH.SaveCode).Methods("POST", "OPTIONS")
	r.HandleFunc("/relay/reward", relayH.Reward).Methods("POST", "OPTIONS")
	r.HandleFunc("/relay/stats", relayH.GetReferrerStats).Methods("GET", "OPTIONS")

	// --- NFT 铸造路由 ---
	r.HandleFunc("/relay/mint", mintH.Mint).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/v1/nft/total-minted", mintH.GetTotalMinted).Methods("GET", "OPTIONS")
	r.PathPrefix("/relay/tx/").HandlerFunc(mintH.GetTxResult).Methods("GET", "OPTIONS")

	// ✅ 新增：NFT 统计数据（前端展示用）
	// GET /api/v1/nft/stats?contract=0x...
	r.HandleFunc("/api/v1/nft/stats", nftStatsHandler()).Methods("GET", "OPTIONS")

	// --- 大盘市场路由 ---
	r.HandleFunc("/api/v1/tickers", marketH.GetTickers).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/market/tickers", marketH.GetTickers).Methods("GET", "OPTIONS")

	// --- 工厂合约路由 (出版社后端代签) ---
	r.HandleFunc("/api/v1/precheck-code", factoryH.PrecheckCode).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/factory/verify-publisher", factoryH.VerifyPublisher).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/publisher/balance", factoryH.GetPublisherBalance).Methods("GET", "OPTIONS")

	// ✅ 出版社：批量生成读者专用二维码 ZIP
	r.HandleFunc("/api/v1/publisher/zip", publisherH.GenerateAndDownloadZip).Methods("GET", "OPTIONS")
	// ✅ 出版社：搜索书籍（RediSearch）
	r.HandleFunc("/api/v1/publisher/books/search", publisherH.SearchPublisherBooks).Methods("GET", "OPTIONS")

	// 出版社：通过工厂部署书合约 / 后端从 Redis 取私钥部署
	r.HandleFunc("/api/v1/factory/create", factoryH.DeployBook).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/v1/publisher/deploy-book", factoryH.DeployBook).Methods("POST", "OPTIONS")

	// --- 数据分析路由 ---
	r.HandleFunc("/api/v1/analytics/distribution", relayH.GetDistribution).Methods("GET", "OPTIONS")

	// --- 管理员路由 ---
	r.HandleFunc("/api/admin/check-access", authH.CheckAdminAccess).Methods("GET", "OPTIONS")

	// ✅ 管理员给出版社充值 USDT
	r.HandleFunc("/api/admin/usdt/recharge", adminRechargeUSDTHandler()).Methods("POST", "OPTIONS")

	// ========================================
	// 5. 启动服务
	// ========================================
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	fmt.Printf("🚀 Whale Vault 后端启动成功 (监听端口: %s)\n", port)
	srv := &http.Server{
		Addr:    "0.0.0.0:" + port,
		Handler: corsMiddleware(r),
	}
	log.Fatal(srv.ListenAndServe())
}

// ========================================
// 新增：USDT 充值接口（调用 internal/blockchain/usdt.go）
// ========================================

type rechargeUSDTReq struct {
	To     string `json:"to"`
	Amount int64  `json:"amount"` // 人类单位：例如 1000 表示 1000 USDT
}

type apiResp struct {
	Ok     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
	TxHash string `json:"txHash,omitempty"`
}

func adminRechargeUSDTHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		// 可选：header 保护
		if key := strings.TrimSpace(os.Getenv("ADMIN_API_KEY")); key != "" {
			got := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
			if subtle.ConstantTimeCompare([]byte(got), []byte(key)) != 1 {
				writeJSON(w, http.StatusUnauthorized, apiResp{Ok: false, Error: "unauthorized"})
				return
			}
		}

		var req rechargeUSDTReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{Ok: false, Error: "invalid json"})
			return
		}

		to := strings.TrimSpace(req.To)
		if !isHexAddress(to) {
			writeJSON(w, http.StatusBadRequest, apiResp{Ok: false, Error: "invalid 'to' address"})
			return
		}
		if req.Amount <= 0 {
			writeJSON(w, http.StatusBadRequest, apiResp{Ok: false, Error: "amount must be > 0"})
			return
		}

		contract := strings.TrimSpace(os.Getenv("USDT_CONTRACT"))
		if !isHexAddress(contract) {
			writeJSON(w, http.StatusBadRequest, apiResp{Ok: false, Error: "USDT_CONTRACT not set or invalid"})
			return
		}

		rpcURL := strings.TrimSpace(os.Getenv("RPC_URL"))
		if rpcURL == "" {
			writeJSON(w, http.StatusInternalServerError, apiResp{Ok: false, Error: "RPC_URL not set"})
			return
		}

		priv := strings.TrimSpace(os.Getenv("USDT_ADMIN_PRIVKEY"))
		priv = strings.TrimPrefix(priv, "0x")
		if priv == "" {
			writeJSON(w, http.StatusInternalServerError, apiResp{Ok: false, Error: "USDT_ADMIN_PRIVKEY not set"})
			return
		}

		c := blockchain.NewUSDTClient(contract, rpcURL, priv)
		tx, err := c.Recharge(to, req.Amount)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResp{Ok: false, Error: err.Error()})
			return
		}

		writeJSON(w, http.StatusOK, apiResp{Ok: true, TxHash: tx})
	}
}

func isHexAddress(s string) bool {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "0x") {
		return false
	}
	if len(s) != 42 {
		return false
	}
	for _, ch := range s[2:] {
		if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')) {
			return false
		}
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// ========================================
// 中间件
// ========================================

func requestLoggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Printf("🔔 [REQ] %s %s | From: %s\n", r.Method, r.URL.Path, r.RemoteAddr)
		next.ServeHTTP(w, r)
	})
}

func corsMiddleware(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		h.ServeHTTP(w, r)
	})
}

// ========================================
// 工具函数 (供其他包使用)
// ========================================

func GetClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}
	ip := r.RemoteAddr
	if colonIdx := strings.LastIndex(ip, ":"); colonIdx != -1 {
		ip = ip[:colonIdx]
	}
	return ip
}

func DeriveAddressFromPrivateKey(privateKeyHex string) string {
	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil {
		return ""
	}
	return crypto.PubkeyToAddress(privateKey.PublicKey).Hex()
}
