package main

import (
	"context"
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
	godotenv.Load()

	// 初始化 Redis
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}
	rdb = redis.NewClient(&redis.Options{
		Addr: redisAddr,
	})
	log.Println("✅ Redis 连接成功")

	// 初始化以太坊客户端
	var err error
	client, err = ethclient.Dial(os.Getenv("RPC_URL"))
	if err != nil {
		log.Fatalf("❌ RPC 连接失败: %v", err)
	}
	log.Println("✅ 以太坊客户端连接成功")

	// 解析 Chain ID
	cidStr := os.Getenv("CHAIN_ID")
	cInt, _ := strconv.ParseInt(cidStr, 10, 64)
	chainID = big.NewInt(cInt)

	// ========================================
	// 2. 加载中继器钱包
	// ========================================
	handlers.LoadRelayers(client, chainID)

	// ========================================
	// 3. 实例化业务处理器 (依赖注入)
	// ========================================

	// 读者端处理器 (扫码、验证、兑奖)
	relayH := &handlers.RelayHandler{
		RDB:    rdb,
		Client: client,
	}

	// 大盘市场处理器 (书籍排行榜)
	marketH := &handlers.MarketHandler{
		RDB: rdb,
	}

	// 工厂合约处理器 (部署新书合约)
	factoryH := &handlers.FactoryHandler{
		RDB:     rdb,
		Client:  client,
		ChainID: chainID,
	}

	// NFT 铸造处理器
	mintH := &handlers.MintHandler{
		RDB:    rdb,
		Client: client,
	}

	// 身份验证处理器
	authH := &handlers.AuthHandler{
		RDB:    rdb,
		Client: client,
	}

	// ========================================
	// 4. 注册路由
	// ========================================
	r := mux.NewRouter()

	// 全局请求日志中间件
	r.Use(requestLoggerMiddleware)

	// --- 身份验证路由 ---
	// GET  /secret/get-binding      获取地址绑定信息
	// GET  /secret/verify           验证激活码并分配角色
	r.HandleFunc("/secret/get-binding", authH.GetBinding).Methods("GET", "OPTIONS")
	r.HandleFunc("/secret/verify", authH.Verify).Methods("GET", "OPTIONS")

	// --- 读者端路由 (Relay 业务) ---
	// POST /relay/save-code         验证并暂存书码
	// POST /relay/reward            执行 5 码兑换
	// GET  /relay/stats             获取推荐人统计/排行榜
	r.HandleFunc("/relay/save-code", relayH.SaveCode).Methods("POST", "OPTIONS")
	r.HandleFunc("/relay/reward", relayH.Reward).Methods("POST", "OPTIONS")
	r.HandleFunc("/relay/stats", relayH.GetReferrerStats).Methods("GET", "OPTIONS")

	// --- NFT 铸造路由 ---
	// POST /relay/mint              铸造 NFT
	// GET  /api/v1/nft/total-minted 获取链上总铸造量
	r.HandleFunc("/relay/mint", mintH.Mint).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/v1/nft/total-minted", mintH.GetTotalMinted).Methods("GET", "OPTIONS")

	// --- 大盘市场路由 ---
	// GET /api/v1/tickers           获取书籍销量排行榜 (兼容旧路径)
	// GET /api/v1/market/tickers    获取书籍销量排行榜
	r.HandleFunc("/api/v1/tickers", marketH.GetTickers).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/market/tickers", marketH.GetTickers).Methods("GET", "OPTIONS")

	// --- 工厂合约路由 (出版社后端代签) ---
	// GET  /api/v1/precheck-code          预检查激活码
	// GET  /api/v1/factory/verify-publisher 验证出版社身份
	// POST /api/v1/factory/create         创建书籍 (旧接口)
	// POST /api/v1/factory/deploy-book    部署书籍合约
	// GET  /api/v1/publisher/balance      查询出版社余额
	r.HandleFunc("/api/v1/precheck-code", factoryH.PrecheckCode).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/factory/verify-publisher", factoryH.VerifyPublisher).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/factory/create", factoryH.CreateBook).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/v1/factory/deploy-book", factoryH.DeployBook).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/v1/publisher/balance", factoryH.GetPublisherBalance).Methods("GET", "OPTIONS")

	// --- 数据分析路由 ---
	// GET /api/v1/analytics/distribution 获取读者地理分布热力图
	// GET /api/v1/reader/location        获取当前读者位置
	r.HandleFunc("/api/v1/analytics/distribution", relayH.GetDistribution).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/reader/location", mintH.GetReaderLocation).Methods("GET", "OPTIONS")

	// --- 管理员路由 ---
	// GET /api/admin/check-access 检查管理员权限
	r.HandleFunc("/api/admin/check-access", authH.CheckAdminAccess).Methods("GET", "OPTIONS")

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
// 中间件
// ========================================

// requestLoggerMiddleware 全局请求日志
func requestLoggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Printf("🔔 [REQ] %s %s | From: %s\n", r.Method, r.URL.Path, r.RemoteAddr)
		next.ServeHTTP(w, r)
	})
}

// corsMiddleware 跨域处理
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

// GetClientIP 获取客户端真实 IP
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

// DeriveAddressFromPrivateKey 从私钥推导地址
func DeriveAddressFromPrivateKey(privateKeyHex string) string {
	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil {
		return ""
	}
	return crypto.PubkeyToAddress(privateKey.PublicKey).Hex()
}
