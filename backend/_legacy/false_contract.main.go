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
	"strings"
//	"sync"
//	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/gorilla/mux"
)

const (
	RPC_URL       = "https://rpc.api.moonbase.moonbeam.network"
	CHAIN_ID      = 1287
	CONTRACT_ADDR = "0x6A96C2513B94056241a798f060a7F573427E3606"
//0xd0d2380ff21B0daB5Cd75DDA064146a6d36dC6C2"
	// 你的物理私钥（已填入）
	PRIVATE_KEY   = "f5e9d1dc4dcd90bb0e0b9350c8aa5973011635729926387256ac5ea66324ed2b"
	HASH_FILE     = "/opt/Whale-Vault/backend/hash-code.txt"
)

type RelayRequest struct {
	Dest     string `json:"dest"`     // 接收者的地址
	CodeHash string `json:"codeHash"` // 验证码
}

type RelayResponse struct {
	Status string `json:"status"`
	TxHash string `json:"txHash,omitempty"`
	Error  string `json:"error,omitempty"`
}

// 模拟文件校验逻辑
func verifyCodeFromFile(code string) bool {
	content, err := os.ReadFile(HASH_FILE)
	if err != nil {
		return false
	}
	return strings.Contains(string(content), code)
}

// 核心：真正调用链上 Mint 的函数
func performActualMint(toAddress string) (string, error) {
	client, err := ethclient.Dial(RPC_URL)
	if err != nil {
		return "", fmt.Errorf("连接 RPC 失败: %v", err)
	}

	privateKey, err := crypto.HexToECDSA(PRIVATE_KEY)
	if err != nil {
		return "", fmt.Errorf("解析私钥失败: %v", err)
	}

	publicKey := privateKey.Public()
	publicKeyECDSA, ok := publicKey.(*ecdsa.PublicKey)
	if !ok {
		return "", fmt.Errorf("无法导出公钥")
	}
	fromAddress := crypto.PubkeyToAddress(*publicKeyECDSA)

	// 获取 Nonce
	nonce, err := client.PendingNonceAt(context.Background(), fromAddress)
	if err != nil {
		return "", fmt.Errorf("获取 Nonce 失败: %v", err)
	}

	// 建议 Gas 价格
	gasPrice, err := client.SuggestGasPrice(context.Background())
	if err != nil {
		return "", fmt.Errorf("获取 Gas 价格失败: %v", err)
	}

	// 构造合约调用数据：mint(address) 的函数签名是 0x6a627842
	// 我们手动拼接：0x6a627842 + (补齐到 32 字节的地址)
	//toAddr := common.HexToAddress(toAddress)
	//methodID := crypto.Keccak256([]byte("mint(address)"))[:4] // 0x6a627842
	methodID := crypto.Keccak256([]byte("mint()"))[:4]
	//data := append(methodID, paddedAddress...)
        data := methodID
	// 构造交易
	gasLimit := uint64(200000) 
	tx := types.NewTransaction(nonce, common.HexToAddress(CONTRACT_ADDR), big.NewInt(0), gasLimit, gasPrice, data)

	// 签名交易
	chainID := big.NewInt(int64(CHAIN_ID))
	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(chainID), privateKey)
	if err != nil {
		return "", fmt.Errorf("签名失败: %v", err)
	}

	// 发送交易
	err = client.SendTransaction(context.Background(), signedTx)
	if err != nil {
		return "", fmt.Errorf("广播交易失败: %v", err)
	}

	return signedTx.Hash().Hex(), nil
}

func main() {
	router := mux.NewRouter()

	router.HandleFunc("/relay/mint", func(w http.ResponseWriter, r *http.Request) {
		var req RelayRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "无效请求", http.StatusBadRequest)
			return
		}

		// 1. 物理校验
		if !verifyCodeFromFile(req.CodeHash) {
			json.NewEncoder(w).Encode(RelayResponse{Status: "failed", Error: "无效的兑换码"})
			return
		}

		// 2. 真正执行链上交易
		log.Printf("正在为地址 %s 执行链上 Mint...", req.Dest)
		txHash, err := performActualMint(req.Dest)
		if err != nil {
			log.Printf("❌ Mint 失败: %v", err)
			json.NewEncoder(w).Encode(RelayResponse{Status: "failed", Error: err.Error()})
			return
		}

		log.Printf("✅ Mint 成功！Hash: %s", txHash)
		json.NewEncoder(w).Encode(RelayResponse{
			Status: "success",
			TxHash: txHash,
		})
	}).Methods("POST", "OPTIONS")

	log.Println("🚀 Whale Vault 真·验证版已启动: :8080")
	http.ListenAndServe(":8080", router)
}
