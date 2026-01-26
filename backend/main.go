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
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"

	// 导入您的 handlers 包
	"whale-vault/relay/internal/handlers"
)

// --- 结构体定义 ---

type Relayer struct {
	PrivateKey *ecdsa.PrivateKey
	Address    common.Address
	Nonce      int64
	mu         sync.Mutex
}

type CommonResponse struct {
	Ok     bool   `json:"ok,omitempty"`
	Status string `json:"status,omitempty"`
	TxHash string `json:"txHash,omitempty"`
	Error  string `json:"error,omitempty"`
	Role   string `json:"role,omitempty"`
}

var (
	ctx            = context.Background()
	rdb            *redis.Client
	client         *ethclient.Client
	relayers       []*Relayer
	relayerCounter uint64
	chainID        *big.Int
)

func main() {
	// 1. 初始化基础环境
	godotenv.Load()
	
	rdb = redis.NewClient(&redis.Options{
		Addr: os.Getenv("REDIS_ADDR"),
	})
	
	var err error
	client, err = ethclient.Dial(os.Getenv("RPC_URL"))
	if err != nil {
		log.Fatalf("RPC 连接失败: %v", err)
	}

	cidStr := os.Getenv("CHAIN_ID")
	cInt, _ := strconv.ParseInt(cidStr, 10, 64)
	chainID = big.NewInt(cInt)

	loadRelayers()

	// 2. 实例化业务处理器 (用于新版推荐奖励功能)
	relayH := &handlers.RelayHandler{
		RDB:    rdb,
		Client: client,
	}

	r := mux.NewRouter()

	// --- 核心路由配置 ---

	// [身份与校验] 
	r.HandleFunc("/secret/get-binding", getBindingHandler).Methods("GET", "OPTIONS")
	r.HandleFunc("/secret/verify", verifyHandler).Methods("GET", "OPTIONS") // 兼顾读者扫码与 Reward 校验
	
	// [读者 Mint 业务] 
	r.HandleFunc("/relay/mint", mintHandler).Methods("POST", "OPTIONS")
	
	// [推荐奖励业务] 匹配 Reward.tsx 逻辑
	r.HandleFunc("/relay/save-code", relayH.SaveCode).Methods("POST", "OPTIONS")
	r.HandleFunc("/relay/reward", relayH.Reward).Methods("POST", "OPTIONS")
	r.HandleFunc("/relay/stats", relayH.GetReferrerStats).Methods("GET", "OPTIONS") // 排行榜接口

	// [出版社特权后台接口]
	r.HandleFunc("/api/admin/check-access", checkAdminAccessHandler).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/analytics/distribution", publisherOnly(distributionHandler)).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/stats/sales", publisherOnly(statsHandler)).Methods("GET", "OPTIONS")

	fmt.Println("🚀 Whale Vault 后端已就绪：三级权限系统 + 推荐排行榜已打通。")
	log.Fatal(http.ListenAndServe("0.0.0.0:8080", cors(r)))
}

// --- 中间件与权限逻辑 ---

func publisherOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		address := r.URL.Query().Get("address")
		if address == "" {
			authHeader := r.Header.Get("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				address = strings.TrimPrefix(authHeader, "Bearer ")
			}
		}
		
		isPub, _ := isPublisherAddress(address)
		if !isPub {
			sendJSON(w, http.StatusForbidden, CommonResponse{Error: "仅限出版社访问此功能"})
			return
		}
		next(w, r)
	}
}

func isPublisherAddress(address string) (bool, error) {
	if address == "" { return false, nil }
	members, err := rdb.SMembers(ctx, "vault:roles:publishers").Result()
	if err != nil { return false, err }
	
	lowerAddr := strings.ToLower(address)
	for _, member := range members {
		if strings.ToLower(member) == lowerAddr { return true, nil }
	}
	return false, nil
}

// --- 业务处理函数 ---

func mintHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Dest     string `json:"dest"`
		CodeHash string `json:"codeHash"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, http.StatusBadRequest, CommonResponse{Error: "参数格式错误"})
		return
	}
	
	destAddr := strings.ToLower(req.Dest)
	isPub, _ := isPublisherAddress(destAddr)

	// 出版社逻辑：直接返回成功并跳转后台
	if isPub || strings.HasPrefix(req.CodeHash, "pub_") {
		sendJSON(w, http.StatusOK, CommonResponse{Ok: true, Status: "PUBLISHER_WELCOME", Role: "publisher"})
		return
	}

	// 读者逻辑：核销并 Mint
	removed, _ := rdb.SRem(ctx, "vault:codes:valid", req.CodeHash).Result()
	if removed == 0 {
		sendJSON(w, http.StatusForbidden, CommonResponse{Error: "无效的兑换码"})
		return
	}

	txHash, err := executeMintLegacy(destAddr)
	if err != nil {
		rdb.SAdd(ctx, "vault:codes:valid", req.CodeHash) // 失败回滚
		sendJSON(w, http.StatusInternalServerError, CommonResponse{Error: "确权失败: " + err.Error()})
		return
	}

	sendJSON(w, http.StatusOK, CommonResponse{Ok: true, Status: "SUCCESS", TxHash: txHash, Role: "reader"})
}

func verifyHandler(w http.ResponseWriter, r *http.Request) {
	a := r.URL.Query().Get("address")
	h := r.URL.Query().Get("codeHash")
	
	isPub, _ := isPublisherAddress(a)
	if isPub {
		sendJSON(w, http.StatusOK, CommonResponse{Ok: true, Role: "publisher"})
		return
	}

	isValid, _ := rdb.SIsMember(ctx, "vault:codes:valid", h).Result()
	if isValid {
		sendJSON(w, http.StatusOK, CommonResponse{Ok: true, Role: "reader"})
	} else {
		sendJSON(w, http.StatusForbidden, CommonResponse{Error: "INVALID_CODE"})
	}
}

func checkAdminAccessHandler(w http.ResponseWriter, r *http.Request) {
	address := r.URL.Query().Get("address")
	isPub, _ := isPublisherAddress(address)
	if !isPub {
		sendJSON(w, http.StatusForbidden, CommonResponse{Error: "权限不足"})
		return
	}
	sendJSON(w, http.StatusOK, CommonResponse{Ok: true, Role: "publisher"})
}

// --- 辅助逻辑 ---

func executeMintLegacy(toAddr string) (string, error) {
	idx := atomic.AddUint64(&relayerCounter, 1) % uint64(len(relayers))
	relayer := relayers[idx]
	relayer.mu.Lock()
	defer relayer.mu.Unlock()

	gasPrice, _ := client.SuggestGasPrice(ctx)
	tx := types.NewTransaction(uint64(relayer.Nonce), common.HexToAddress(toAddr), big.NewInt(0), 21000, gasPrice, nil)
	signedTx, _ := types.SignTx(tx, types.NewEIP155Signer(chainID), relayer.PrivateKey)
	
	if err := client.SendTransaction(ctx, signedTx); err != nil { return "", err }
	relayer.Nonce++
	return signedTx.Hash().Hex(), nil
}

func loadRelayers() {
	count, _ := strconv.Atoi(os.Getenv("RELAYER_COUNT"))
	for i := 0; i < count; i++ {
		keyHex := os.Getenv(fmt.Sprintf("PRIVATE_KEY_%d", i))
		if keyHex == "" { continue }
		priv, _ := crypto.HexToECDSA(keyHex)
		r := &Relayer{
			PrivateKey: priv,
			Address:    crypto.PubkeyToAddress(priv.PublicKey),
		}
		n, _ := client.PendingNonceAt(ctx, r.Address)
		r.Nonce = int64(n)
		relayers = append(relayers, r)
	}
}

func cors(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" { return }
		h.ServeHTTP(w, r)
	})
}

func sendJSON(w http.ResponseWriter, code int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(payload)
}

// 以下为统计功能所需的占位符，实际逻辑可按需补全
func getBindingHandler(w http.ResponseWriter, r *http.Request) {}
func distributionHandler(w http.ResponseWriter, r *http.Request) {}
func statsHandler(w http.ResponseWriter, r *http.Request) {}
