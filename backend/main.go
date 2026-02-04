package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strconv"
	"strings"

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
		Protocol: 2, // ✅ 强制 RESP2，FT.SEARCH 返回数组结构，你的 parseFTSearchResult 就能正常工作
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

	// ✅ 出版社处理器（批量生成二维码 ZIP / 部署书合约）
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
	//r.HandleFunc("/api/v1/publisher/create-book", factoryH.DeployBook).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/v1/publisher/deploy-book", factoryH.DeployBook).Methods("POST", "OPTIONS")

	// --- 数据分析路由 ---
	r.HandleFunc("/api/v1/analytics/distribution", relayH.GetDistribution).Methods("GET", "OPTIONS")

	// --- 管理员路由 ---
	r.HandleFunc("/api/admin/check-access", authH.CheckAdminAccess).Methods("GET", "OPTIONS")

	// ✅ 新增：管理员给出版社充值 USDT（调用 usdt.go）
	// POST /api/admin/usdt/recharge  body: {"to":"0x...","amount":1000}
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
	// 可选：如果你想加“备注/订单号”，可扩展字段
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

		// （可选）用一个简单 header 保护，避免公网随便打
		// 在 .env 配 ADMIN_API_KEY=xxx
		// 请求带：Authorization: Bearer xxx
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

		// ✅ 这里就是调用你上传的 usdt.go
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
