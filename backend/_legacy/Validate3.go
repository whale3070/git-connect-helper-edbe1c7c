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
//	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
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
	godotenv.Load()
	rdb = redis.NewClient(&redis.Options{Addr: os.Getenv("REDIS_ADDR")})
	
	var err error
	client, err = ethclient.Dial(os.Getenv("RPC_URL"))
	if err != nil {
		log.Fatalf("RPC 连接失败: %v", err)
	}

	cidStr := os.Getenv("CHAIN_ID")
	cInt, _ := strconv.ParseInt(cidStr, 10, 64)
	chainID = big.NewInt(cInt)

	loadRelayers()

	r := mux.NewRouter()
	r.HandleFunc("/secret/get-binding", getBindingHandler).Methods("GET")
	r.HandleFunc("/secret/verify", verifyHandler).Methods("GET")
	r.HandleFunc("/relay/mint", mintHandler).Methods("POST")
	r.HandleFunc("/api/v1/analytics/distribution", distributionHandler).Methods("GET")
	r.HandleFunc("/api/v1/stats/sales", statsHandler).Methods("GET")

	fmt.Println("🚀 Whale Vault 后端已启动：出版社特权逻辑已锁定。端口 :8080")
	log.Fatal(http.ListenAndServe(":8080", cors(r)))
}

// --- 核心修复逻辑 ---

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

	// 【第一步：绝对拦截】首先检查是否为出版社地址
	// 只要地址在出版社名单里，直接返回 OK，跳过所有后续逻辑
	isPub, _ := rdb.SIsMember(ctx, "vault:roles:publishers", destAddr).Result()
	if isPub {
		fmt.Printf("检测到出版社访问: %s, 激活码: %s。已跳过 Mint，允许长期通行。\n", destAddr, req.CodeHash)
		sendJSON(w, http.StatusOK, CommonResponse{
			Ok:     true,
			Status: "WELCOME_PUBLISHER",
			Role:   "publisher",
		})
		return // ！！！关键：这里必须 return，防止执行下面的 SRem 和 Mint ！！！
	}

	// 【第二步：读者逻辑】不是出版社，才需要核销激活码
	removed, _ := rdb.SRem(ctx, "vault:codes:valid", req.CodeHash).Result()
	if removed == 0 {
		sendJSON(w, http.StatusForbidden, CommonResponse{Error: "权限验证失败：无效的兑换码或已被使用"})
		return
	}

	// 【第三步：执行读者 Mint】
	txHash, err := executeMintLegacy(destAddr)
	if err != nil {
		rdb.SAdd(ctx, "vault:codes:valid", req.CodeHash) // 失败回滚
		sendJSON(w, http.StatusInternalServerError, CommonResponse{Error: "链上确权失败: " + err.Error()})
		return
	}

	sendJSON(w, http.StatusOK, CommonResponse{
		Ok:     true,
		Status: "SUCCESS",
		TxHash: txHash,
		Role:   "reader",
	})
}

func verifyHandler(w http.ResponseWriter, r *http.Request) {
	a := strings.ToLower(r.URL.Query().Get("address"))
	h := r.URL.Query().Get("codeHash")

	// 方案1：优先通过 codeHash 判定角色（检查各角色的 codes 集合）
	// 出版社激活码检查
	isPubCode, _ := rdb.SIsMember(ctx, "vault:roles:publishers_codes", h).Result()
	if isPubCode {
		sendJSON(w, http.StatusOK, CommonResponse{Ok: true, Role: "publisher"})
		return
	}

	// 作者激活码检查
	isAuthorCode, _ := rdb.SIsMember(ctx, "vault:roles:authors_codes", h).Result()
	if isAuthorCode {
		sendJSON(w, http.StatusOK, CommonResponse{Ok: true, Role: "author"})
		return
	}

	// 方案2：通过地址判定（兼容旧逻辑）
	isPub, _ := rdb.SIsMember(ctx, "vault:roles:publishers", a).Result()
	if isPub {
		sendJSON(w, http.StatusOK, CommonResponse{Ok: true, Role: "publisher"})
		return
	}

	isAuthor, _ := rdb.SIsMember(ctx, "vault:roles:authors", a).Result()
	if isAuthor {
		sendJSON(w, http.StatusOK, CommonResponse{Ok: true, Role: "author"})
		return
	}

	// 读者验证激活码池
	isValid, _ := rdb.SIsMember(ctx, "vault:codes:valid", h).Result()
	if isValid {
		sendJSON(w, http.StatusOK, CommonResponse{Ok: true, Role: "reader"})
	} else {
		sendJSON(w, http.StatusForbidden, CommonResponse{Error: "INVALID_CODE"})
	}
}

// --- 辅助函数 ---

func executeMintLegacy(toAddr string) (string, error) {
	idx := atomic.AddUint64(&relayerCounter, 1) % uint64(len(relayers))
	r := relayers[idx]
	r.mu.Lock()
	defer r.mu.Unlock()

	gasPrice, _ := client.SuggestGasPrice(ctx)
	tx := types.NewTransaction(uint64(r.Nonce), common.HexToAddress(toAddr), big.NewInt(0), 21000, gasPrice, nil)
	signedTx, _ := types.SignTx(tx, types.NewEIP155Signer(chainID), r.PrivateKey)
	
	if err := client.SendTransaction(ctx, signedTx); err != nil {
		return "", err
	}
	r.Nonce++
	return signedTx.Hash().Hex(), nil
}

func getBindingHandler(w http.ResponseWriter, r *http.Request) {
	h := r.URL.Query().Get("codeHash")
	addr, _ := rdb.HGet(ctx, "vault:bind:"+h, "address").Result()
	sendJSON(w, http.StatusOK, map[string]string{"address": addr})
}

func distributionHandler(w http.ResponseWriter, r *http.Request) {
	data := []map[string]interface{}{
		{"name": "Beijing", "value": []float64{116.46, 39.92, 10}},
	}
	sendJSON(w, http.StatusOK, data)
}

func statsHandler(w http.ResponseWriter, r *http.Request) {
	stats, _ := rdb.HGetAll(ctx, "whale_vault:daily_mints").Result()
	var keys []string
	for k := range stats { keys = append(keys, k) }
	sort.Strings(keys)
	
	type Data struct { Date string `json:"date"`; Sales int `json:"sales"` }
	var result []Data
	total := 0
	for _, k := range keys {
		c, _ := strconv.Atoi(stats[k])
		total += c
		result = append(result, Data{Date: k, Sales: total})
	}
	sendJSON(w, http.StatusOK, result)
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
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" { return }
		h.ServeHTTP(w, r)
	})
}

func sendJSON(w http.ResponseWriter, code int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(payload)
}
