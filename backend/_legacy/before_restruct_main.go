package main

import (
	"context"
	"encoding/json"
//	"fmt"
	"log"
	"net/http"
	"os"
//	"sort"
//	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
        "whale-vault/relay/internal/blockchain"
	//"Whale-Vault-NFT/backend/blockchain" // 请确保这里的路径指向你的 reward.go 所在包
)

var (
	ctx    = context.Background()
	rdb    *redis.Client
	client *ethclient.Client
)

type CommonResponse struct {
	Ok     bool   `json:"ok,omitempty"`
	Status string `json:"status,omitempty"`
	TxHash string `json:"txHash,omitempty"`
	Error  string `json:"error,omitempty"`
}

func main() {
	godotenv.Load()
	rdb = redis.NewClient(&redis.Options{Addr: os.Getenv("REDIS_ADDR")})
	
	var err error
	client, err = ethclient.Dial(os.Getenv("RPC_URL"))
	if err != nil {
		log.Fatalf("无法连接到 RPC: %v", err)
	}

	router := mux.NewRouter()

	// --- 1. 暂存功能：保存单个有效书码到 Redis ---
	router.HandleFunc("/relay/save-code", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Address  string `json:"address"`
			CodeHash string `json:"codeHash"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			sendJSON(w, http.StatusBadRequest, CommonResponse{Error: "参数错误"})
			return
		}

		// 防伪验证：只有在 valid 集合中的码才能被暂存
		isValid, _ := rdb.SIsMember(ctx, "vault:codes:valid", req.CodeHash).Result()
		if !isValid {
			sendJSON(w, http.StatusForbidden, CommonResponse{Error: "无效的 Hash Code"})
			return
		}

		// 使用集合 (Set) 存储，防止同一地址重复暂存同一个码
		rdb.SAdd(ctx, "vault:saved:"+strings.ToLower(req.Address), req.CodeHash)
		count, _ := rdb.SCard(ctx, "vault:saved:"+strings.ToLower(req.Address)).Result()

		sendJSON(w, http.StatusOK, map[string]interface{}{
			"ok":    true,
			"count": count,
		})
	}).Methods("POST")

	// --- 2. 回显功能：获取该地址已暂存的所有码 ---
	router.HandleFunc("/relay/get-saved", func(w http.ResponseWriter, r *http.Request) {
		addr := strings.ToLower(r.URL.Query().Get("address"))
		codes, _ := rdb.SMembers(ctx, "vault:saved:"+addr).Result()
		sendJSON(w, http.StatusOK, map[string]interface{}{"codes": codes})
	}).Methods("GET")

	// --- 3. 兑换功能：集齐 5 码后调用合约 ---
	router.HandleFunc("/relay/reward", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Dest  string   `json:"dest"`
			Codes []string `json:"codes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Codes) < 5 {
			sendJSON(w, http.StatusBadRequest, CommonResponse{Error: "需要提供 5 个书码"})
			return
		}

		// 调用 reward.go 中的逻辑
		txHash, bizHash, err := blockchain.DispenseReward(req.Dest, os.Getenv("BACKEND_PRIVATE_KEY"), req.Codes)
		if err != nil {
			sendJSON(w, http.StatusInternalServerError, CommonResponse{Error: "合约调用失败: " + err.Error()})
			return
		}

		// 成功后清理 Redis 暂存并更新销量统计
		pipe := rdb.Pipeline()
		pipe.Del(ctx, "vault:saved:"+strings.ToLower(req.Dest))
		for _, c := range req.Codes {
			pipe.SRem(ctx, "vault:codes:valid", c) // 标记为已使用
			pipe.SAdd(ctx, "vault:codes:rewarded", c)
		}
		// 记录销量 (此处bizHash可作为唯一业务标识)
		pipe.HIncrBy(ctx, "whale_vault:daily_mints", time.Now().Format("2006-01-02"), 1)
		pipe.Exec(ctx)

		sendJSON(w, http.StatusOK, CommonResponse{Ok: true, Status: bizHash, TxHash: txHash})
	}).Methods("POST")

	// ... 其他接口 (销量统计等) 保持不变

	log.Printf("🚀 后端服务已启动，监听 8080 端口")
	log.Fatal(http.ListenAndServe(":8080", cors(router)))
}

// 辅助函数保持原有逻辑
func sendJSON(w http.ResponseWriter, code int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(payload)
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" { return }
		next.ServeHTTP(w, r)
	})
}
