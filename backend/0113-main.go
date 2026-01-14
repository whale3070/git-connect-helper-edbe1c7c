package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
)

// 全局变量
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
	// 1. 加载 .env 配置文件
	err := godotenv.Load()
	if err != nil {
		log.Fatal("❌ 错误: 找不到 .env 文件，请确认文件存在并配置正确")
	}

	// 2. 初始化 Redis
	rdb = redis.NewClient(&redis.Options{
		Addr: os.Getenv("REDIS_ADDR"),
	})

	// 3. 连接区块链节点 (Moonbase Alpha)
	client, err = ethclient.Dial(os.Getenv("RPC_URL"))
	if err != nil {
		log.Fatalf("❌ 无法连接到 RPC 节点: %v", err)
	}

	router := mux.NewRouter()

	// --- 路由 1: 预检接口 (用于前端区分：假码、已领、可用) ---
	router.HandleFunc("/secret/verify", func(w http.ResponseWriter, r *http.Request) {
		codeHash := r.URL.Query().Get("codeHash")
		
		// 优先检查是否在合法池
		isValid, _ := rdb.SIsMember(ctx, "vault:codes:valid", codeHash).Result()
		if !isValid {
			// 如果不在合法池，检查是否在已使用池
			isUsed, _ := rdb.SIsMember(ctx, "vault:codes:used", codeHash).Result()
			if isUsed {
				sendJSON(w, http.StatusConflict, CommonResponse{Ok: false, Error: "此书已领取过 NFT"})
			} else {
				sendJSON(w, http.StatusForbidden, CommonResponse{Ok: false, Error: "无效的兑换码"})
			}
			return
		}
		// 校验通过
		sendJSON(w, http.StatusOK, CommonResponse{Ok: true})
	}).Methods("GET")

	// --- 路由 2: 链上代付 Mint 接口 ---
	router.HandleFunc("/relay/mint", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Dest     string `json:"dest"`
			CodeHash string `json:"codeHash"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			sendJSON(w, http.StatusBadRequest, CommonResponse{Error: "请求格式错误"})
			return
		}

		// 权限二次校验 (防止跳过 verify 接口直接请求)
		valid, _ := rdb.SIsMember(ctx, "vault:codes:valid", req.CodeHash).Result()
		if !valid {
			sendJSON(w, http.StatusForbidden, CommonResponse{Error: "兑换码无效或已被占用"})
			return
		}

		// 执行物理接管：调用私钥进行链上签名铸造
		txHash, err := executeMint(req.Dest)
		if err != nil {
			log.Printf("[%s] 铸造失败: %v", time.Now().Format("15:04:05"), err)
			sendJSON(w, http.StatusInternalServerError, CommonResponse{Error: "区块链代付失败，请稍后重试"})
			return
		}

		// 原子化核销：更新 Redis 状态
		pipe := rdb.Pipeline()
		pipe.SRem(ctx, "vault:codes:valid", req.CodeHash)
		pipe.SAdd(ctx, "vault:codes:used", req.CodeHash)
		pipe.Exec(ctx)

		// 异步通知 Matrix 作者群
		go notifyMatrix(req.Dest, txHash)

		log.Printf("[%s] 成功为地址 %s 铸造 NFT! Hash: %s", time.Now().Format("15:04:05"), req.Dest, txHash)
		sendJSON(w, http.StatusOK, CommonResponse{Status: "submitted", TxHash: txHash})
	}).Methods("POST")

	// 跨域处理
	corsHandler := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
			next.ServeHTTP(w, r)
		})
	}

	fmt.Printf("[%s] 🚀 Whale Vault 后端服务已启动在 :8080\n", time.Now().Format("2006-01-02 15:04:05"))
	http.ListenAndServe(":8080", corsHandler(router))
}

// 核心铸造逻辑：从 .env 读取私钥并执行代付
func executeMint(destAddr string) (string, error) {
	privateKey, err := crypto.HexToECDSA(os.Getenv("PRIVATE_KEY"))
	if err != nil {
		return "", fmt.Errorf("私钥配置错误")
	}

	fromAddress := crypto.PubkeyToAddress(privateKey.PublicKey)
	nonce, err := client.PendingNonceAt(ctx, fromAddress)
	if err != nil { return "", err }

	gasPrice, err := client.SuggestGasPrice(ctx)
	if err != nil { return "", err }
	
	chainIDInt, _ := strconv.Atoi(os.Getenv("CHAIN_ID"))
	chainID := big.NewInt(int64(chainIDInt))

	// 构造合约数据 (Selector: 0x6a627842)
	toAddr := common.HexToAddress(destAddr)
	data := append(common.FromHex("6a627842"), common.LeftPadBytes(toAddr.Bytes(), 32)...)

	// 创建交易 (设置 200000 GasLimit 以确保 Mint 成功)
	tx := types.NewTransaction(nonce, common.HexToAddress(os.Getenv("CONTRACT_ADDR")), big.NewInt(0), 200000, gasPrice, data)
	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(chainID), privateKey)
	if err != nil { return "", err }

	err = client.SendTransaction(ctx, signedTx)
	if err != nil { return "", err }

	return signedTx.Hash().Hex(), nil
}

// 异步通知 Matrix
func notifyMatrix(dest string, txHash string) {
	msg := fmt.Sprintf("🎉 鲸鱼金库：新读者领取了 NFT！\n接收人: %s\n交易哈希: %s", dest, txHash)
	
	url := fmt.Sprintf("%s/_matrix/client/r0/rooms/%s/send/m.room.message?access_token=%s", 
		os.Getenv("MATRIX_URL"), os.Getenv("MATRIX_ROOM_ID"), os.Getenv("MATRIX_ACCESS_TOKEN"))
	
	payload, _ := json.Marshal(map[string]interface{}{
		"msgtype": "m.text",
		"body":    msg,
	})

	resp, err := http.Post(url, "application/json", bytes.NewBuffer(payload))
	if err != nil {
		log.Printf("Matrix 通知发送失败: %v", err)
		return
	}
	defer resp.Body.Close()
}

func sendJSON(w http.ResponseWriter, code int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(payload)
}
