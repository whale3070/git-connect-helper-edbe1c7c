package main

import (
	"log"
	"net/http"
	"os"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"

	// 导入你的 handlers 包
	"whale-vault/relay/internal/handlers"
)

func main() {
	// 1. 初始化基础环境
	godotenv.Load()
	
	rdb := redis.NewClient(&redis.Options{
		Addr: os.Getenv("REDIS_ADDR"),
	})
	
	client, err := ethclient.Dial(os.Getenv("RPC_URL"))
	if err != nil {
		log.Fatalf("无法连接到 RPC: %v", err)
	}

	// 2. 实例化业务处理器 (注入 Redis 和 EthClient)
	relayH := &handlers.RelayHandler{
		RDB:    rdb,
		Client: client,
	}
	pubH := &handlers.PublisherHandler{
		RDB: rdb,
	}

	// 3. 注册路由
	router := mux.NewRouter()

	// 读者端路由 (Relay 业务)
	router.HandleFunc("/relay/save-code", relayH.SaveCode).Methods("POST")
	router.HandleFunc("/relay/get-saved", relayH.GetSaved).Methods("GET")
	router.HandleFunc("/relay/reward", relayH.Reward).Methods("POST")

	// 出版社管理路由 (Publisher 业务)
	router.HandleFunc("/admin/generate", pubH.GenerateAndDownloadZip).Methods("GET")

	// 4. 启动服务
	log.Printf("🚀 Whale Vault 后端已启动，监听 8080 端口")
	log.Fatal(http.ListenAndServe(":8080", cors(router)))
}

// cors 跨域中间件保持不变
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			return
		}
		next.ServeHTTP(w, r)
	})
}
