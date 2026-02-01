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

	// 【第一步：区分出版社激活码和普通激活码】
	// 检查是否是出版社激活码（以"pub_"开头）
	if strings.HasPrefix(req.CodeHash, "pub_") {
		// 验证出版社激活码是否有效
		isValid, _ := rdb.SIsMember(ctx, "vault:codes:valid", req.CodeHash).Result()
		if !isValid {
			sendJSON(w, http.StatusForbidden, CommonResponse{Error: "无效的出版社兑换码"})
			return
		}
		
		// 检查地址是否是出版社地址
		isPub, _ := rdb.SIsMember(ctx, "vault:roles:publishers", destAddr).Result()
		if !isPub {
			sendJSON(w, http.StatusForbidden, CommonResponse{Error: "此兑换码仅限出版社使用"})
			return
		}
		
		// 出版社激活码使用后不删除，保持有效
		// 可以将使用记录记录到另一个集合，但不在主集合中删除
		rdb.SAdd(ctx, "vault:codes:used:publishers", req.CodeHash+":"+destAddr)
		
		fmt.Printf("出版社访问成功: %s, 激活码: %s。跳转到后台页面。\n", destAddr, req.CodeHash)
		sendJSON(w, http.StatusOK, CommonResponse{
			Ok:     true,
			Status: "PUBLISHER_WELCOME",
			Role:   "publisher",
		})
		return
	}
	
	// 【第二步：检查是否为出版社地址（使用普通激活码的情况）】
	isPub, _ := rdb.SIsMember(ctx, "vault:roles:publishers", destAddr).Result()
	if isPub {
		// 出版社使用普通激活码，直接返回成功，不执行Mint，激活码失效
		removed, _ := rdb.SRem(ctx, "vault:codes:valid", req.CodeHash).Result()
		if removed == 0 {
			sendJSON(w, http.StatusForbidden, CommonResponse{Error: "权限验证失败：无效的兑换码或已被使用"})
			return
		}
		
		fmt.Printf("出版社使用普通激活码: %s, 激活码: %s。跳转到后台页面。\n", destAddr, req.CodeHash)
		sendJSON(w, http.StatusOK, CommonResponse{
			Ok:     true,
			Status: "PUBLISHER_WELCOME",
			Role:   "publisher",
		})
		return
	}

	// 【第三步：读者逻辑】不是出版社，才需要核销激活码并执行Mint
	removed, _ := rdb.SRem(ctx, "vault:codes:valid", req.CodeHash).Result()
	if removed == 0 {
		sendJSON(w, http.StatusForbidden, CommonResponse{Error: "权限验证失败：无效的兑换码或已被使用"})
		return
	}

	// 【第四步：执行读者 Mint】
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

	// 优先判定出版社
	isPub, _ := rdb.SIsMember(ctx, "vault:roles:publishers", a).Result()
	if isPub {
		// 检查是否是出版社专用激活码
		if strings.HasPrefix(h, "pub_") {
			// 验证出版社激活码是否有效
			isValid, _ := rdb.SIsMember(ctx, "vault:codes:valid", h).Result()
			if isValid {
				sendJSON(w, http.StatusOK, CommonResponse{Ok: true, Role: "publisher"})
				return
			}
		} else {
			// 出版社使用普通激活码也允许验证通过
			// 但实际使用时会在mintHandler中消耗
			sendJSON(w, http.StatusOK, CommonResponse{Ok: true, Role: "publisher"})
			return
		}
	}

	// 判定作者
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
