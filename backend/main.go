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

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"

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
)

func main() {
	godotenv.Load()

	// 1. Redis
	rdb = redis.NewClient(&redis.Options{Addr: os.Getenv("REDIS_ADDR")})
	
	// 2. RPC
	var err error
	client, err = ethclient.Dial(os.Getenv("RPC_URL"))
	if err != nil { log.Fatalf("RPC连接失败: %v", err) }

	cidStr := os.Getenv("CHAIN_ID")
	cInt, _ := strconv.ParseInt(cidStr, 10, 64)
	chainID = big.NewInt(cInt)

	// 3. Relayers
	loadRelayers()

	// 4. Handlers
	relayH = &handlers.RelayHandler{RDB: rdb, Client: client}
	r := mux.NewRouter()

	// --- 路由 ---
	r.HandleFunc("/secret/get-binding", getBindingHandler).Methods("GET", "OPTIONS")
	r.HandleFunc("/secret/verify", verifyHandler).Methods("GET", "OPTIONS")
	r.HandleFunc("/relay/mint", mintHandler).Methods("POST", "OPTIONS")
	r.HandleFunc("/relay/save-code", relayH.SaveCode).Methods("POST", "OPTIONS")
	r.HandleFunc("/relay/reward", relayH.Reward).Methods("POST", "OPTIONS")
	r.HandleFunc("/relay/stats", relayH.GetReferrerStats).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/admin/check-access", checkAdminAccessHandler).Methods("GET", "OPTIONS")
	
	// 指向 analytics.go 中的方法
	r.HandleFunc("/api/v1/analytics/distribution", relayH.GetDistribution).Methods("GET", "OPTIONS")

	fmt.Println("🚀 Whale Vault 后端启动成功 (端口:8080)")
	log.Fatal(http.ListenAndServe("0.0.0.0:8080", cors(r)))
}

// --- 核心逻辑处理器 ---

func mintHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Dest     string `json:"dest"`
		CodeHash string `json:"codeHash"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, 400, CommonResponse{Ok: false, Error: "Invalid JSON"})
		return
	}

	// 1. 检查出版社
	isPub, _ := rdb.SIsMember(ctx, "vault:roles:publishers_codes", req.CodeHash).Result()
	if isPub {
		sendJSON(w, 200, CommonResponse{Ok: true, Status: "PUBLISHER_WELCOME", Role: "publisher"})
		return
	}

	// 2. 核销码
	removed, _ := rdb.SRem(ctx, "vault:codes:valid", req.CodeHash).Result()
	if removed == 0 {
		sendJSON(w, 403, CommonResponse{Ok: false, Error: "Code used or invalid"})
		return
	}

	// 3. 执行 Mint
	txHash, err := executeMintLegacy(req.Dest)
	if err != nil {
		rdb.SAdd(ctx, "vault:codes:valid", req.CodeHash) // 回滚
		sendJSON(w, 500, CommonResponse{Ok: false, Error: err.Error()})
		return
	}

	// 4. 异步捕获 IP [cite: 2026-01-16]
	ip := r.Header.Get("X-Forwarded-For")
	if ip == "" { ip = strings.Split(r.RemoteAddr, ":")[0] }
	relayH.CaptureEcho(ip)

	sendJSON(w, 200, CommonResponse{Ok: true, TxHash: txHash, Role: "reader"})
}

func verifyHandler(w http.ResponseWriter, r *http.Request) {
	addr := strings.ToLower(r.URL.Query().Get("address"))
	code := r.URL.Query().Get("codeHash")

	// 出版社逻辑
	isPubCode, _ := rdb.SIsMember(ctx, "vault:roles:publishers_codes", code).Result()
	if isPubCode {
		isPubAddr, _ := rdb.SIsMember(ctx, "vault:roles:publishers", addr).Result()
		if isPubAddr {
			sendJSON(w, 200, CommonResponse{Ok: true, Role: "publisher"})
			return
		}
	}

	// 读者逻辑
	isReader, _ := rdb.SIsMember(ctx, "vault:codes:valid", code).Result()
	if isReader {
		sendJSON(w, 200, CommonResponse{Ok: true, Role: "reader"})
		return
	}

	sendJSON(w, 403, CommonResponse{Ok: false, Error: "Unauthorized"})
}

// --- 辅助函数 ---

func executeMintLegacy(to string) (string, error) {
	if len(relayers) == 0 { return "", fmt.Errorf("No relayers") }
	idx := atomic.AddUint64(&relayerCounter, 1) % uint64(len(relayers))
	rel := relayers[idx]
	rel.mu.Lock()
	defer rel.mu.Unlock()

	gp, _ := client.SuggestGasPrice(ctx)
	tx := types.NewTransaction(uint64(rel.Nonce), common.HexToAddress(to), big.NewInt(0), 100000, gp, nil)
	signed, _ := types.SignTx(tx, types.NewEIP155Signer(chainID), rel.PrivateKey)
	if err := client.SendTransaction(ctx, signed); err != nil { return "", err }
	rel.Nonce++
	return signed.Hash().Hex(), nil
}

func loadRelayers() {
	count, _ := strconv.Atoi(os.Getenv("RELAYER_COUNT"))
	for i := 0; i < count; i++ {
		key := os.Getenv(fmt.Sprintf("PRIVATE_KEY_%d", i))
		if key == "" { continue }
		priv, _ := crypto.HexToECDSA(strings.TrimPrefix(key, "0x"))
		addr := crypto.PubkeyToAddress(priv.PublicKey)
		n, _ := client.PendingNonceAt(ctx, addr)
		relayers = append(relayers, &Relayer{PrivateKey: priv, Address: addr, Nonce: int64(n)})
	}
}

func getBindingHandler(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("codeHash")
	data, _ := rdb.HGetAll(ctx, "vault:bind:"+code).Result()
	sendJSON(w, 200, CommonResponse{Ok: true, Address: data["address"]})
}

func checkAdminAccessHandler(w http.ResponseWriter, r *http.Request) { sendJSON(w, 200, CommonResponse{Ok: true}) }

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
		if r.Method == "OPTIONS" { return }
		h.ServeHTTP(w, r)
	})
}
