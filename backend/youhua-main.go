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
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
)

// Relayer 结构体：管理每个中继钱包的私钥与本地 Nonce
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
		log.Fatalf("无法连接到 RPC: %v", err)
	}

	cidStr := os.Getenv("CHAIN_ID")
	cInt, _ := strconv.ParseInt(cidStr, 10, 64)
	chainID = big.NewInt(cInt)

	loadRelayers()

	router := mux.NewRouter()

	router.HandleFunc("/secret/get-binding", getBindingHandler).Methods("GET")
	router.HandleFunc("/secret/verify", verifyHandler).Methods("GET")
	
	// 免 Gas 铸造接口：实现“代付 gas 服务费”逻辑
	router.HandleFunc("/relay/mint", mintHandler).Methods("POST")
	
	router.HandleFunc("/api/v1/stats/sales", statsHandler).Methods("GET")

	fmt.Printf("[%s] 🚀 鲸鱼金库：Monad Legacy版已启动。端口 :8080\n", time.Now().Format("15:04:05"))
	log.Fatal(http.ListenAndServe(":8080", cors(router)))
}

// --- Handler 实现 ---

func mintHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Dest     string `json:"dest"`
		CodeHash string `json:"codeHash"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendJSON(w, http.StatusBadRequest, CommonResponse{Error: "参数错误"})
		return
	}

	// 1. 原子化校验
	removed, _ := rdb.SRem(ctx, "vault:codes:valid", req.CodeHash).Result()
	if removed == 0 {
		fmt.Printf("⚠️  [拦截] 无效码或已领取: %s\n", req.CodeHash)
		sendJSON(w, http.StatusForbidden, CommonResponse{Error: "此码已失效或已领取"})
		return
	}

	// 2. 调用 Legacy 模式的 Mint
	txHash, err := executeMintLegacy(req.Dest)
	if err != nil {
		fmt.Printf("❌ [失败] 接收者: %s | 错误: %v\n", req.Dest, err)
		rdb.SAdd(ctx, "vault:codes:valid", req.CodeHash) // 失败补偿
		sendJSON(w, http.StatusInternalServerError, CommonResponse{Error: "链上提交失败: " + err.Error()})
		return
	}

	// 3. 记录成功
	rdb.SAdd(ctx, "vault:codes:used", req.CodeHash)
	rdb.HIncrBy(ctx, "whale_vault:daily_mints", time.Now().Format("2006-01-02"), 1)

	fmt.Printf("✅ [成功] 接收者: %s | Tx: %s\n", req.Dest, txHash)
	sendJSON(w, http.StatusOK, CommonResponse{Ok: true, Status: "submitted", TxHash: txHash})
}

// --- 核心优化逻辑：Legacy 交易格式 ---

func executeMintLegacy(destAddr string) (string, error) {
	idx := atomic.AddUint64(&relayerCounter, 1) % uint64(len(relayers))
	relayer := relayers[idx]

	relayer.mu.Lock()
	defer relayer.mu.Unlock()

	// 使用 SuggestGasPrice 获取当前网络建议价格
	gasPrice, err := client.SuggestGasPrice(ctx)
	if err != nil {
		return "", err
	}

	// 构造合约调用 Data: mint(address to) -> 0x6a627842
	methodID := common.FromHex("6a627842")
	paddedAddress := common.LeftPadBytes(common.HexToAddress(destAddr).Bytes(), 32)
	data := append(methodID, paddedAddress...)

	// 创建 Legacy 交易 (Type 0)
	tx := types.NewTransaction(
		uint64(relayer.Nonce),
		common.HexToAddress(os.Getenv("CONTRACT_ADDR")),
		big.NewInt(0),
		uint64(250000), // Gas Limit
		gasPrice,
		data,
	)

	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(chainID), relayer.PrivateKey)
	if err != nil {
		return "", err
	}

	if err := client.SendTransaction(ctx, signedTx); err != nil {
		if strings.Contains(err.Error(), "nonce too low") {
			syncNonce(relayer)
		}
		return "", err
	}

	relayer.Nonce++
	return signedTx.Hash().Hex(), nil
}

// --- 其余功能函数 ---

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
		syncNonce(r)
		relayers = append(relayers, r)
	}
}

func syncNonce(r *Relayer) {
	n, _ := client.PendingNonceAt(ctx, r.Address)
	r.Nonce = int64(n)
}

func getBindingHandler(w http.ResponseWriter, r *http.Request) {
	h := r.URL.Query().Get("codeHash")
	mapping, err := rdb.HGetAll(ctx, "vault:bind:"+h).Result()
	if err != nil || len(mapping) == 0 {
		sendJSON(w, http.StatusOK, map[string]string{"address": "", "role": "", "private_key": ""})
		return
	}
	// 返回完整绑定信息：address, role, private_key (用于出版社部署合约)
	sendJSON(w, http.StatusOK, map[string]string{
		"address":     mapping["address"],
		"role":        mapping["role"],
		"private_key": mapping["private_key"],
	})
}

func verifyHandler(w http.ResponseWriter, r *http.Request) {
	h := r.URL.Query().Get("codeHash")
	a := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("address")))
	adminAddr := strings.ToLower(strings.TrimSpace(os.Getenv("ADMIN_ADDRESS")))

	isValid, _ := rdb.SIsMember(ctx, "vault:codes:valid", h).Result()
	if isValid {
		if adminAddr != "" && a == adminAddr {
			sendJSON(w, http.StatusOK, CommonResponse{Ok: true, Status: "ADMIN", Role: "publisher"})
			return
		}
		sendJSON(w, http.StatusOK, CommonResponse{Ok: true, Status: "VALID_READER"})
		return
	}
	sendJSON(w, http.StatusForbidden, CommonResponse{Ok: false, Error: "INVALID_CODE"})
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
