package main

import (
	"bufio"
	"context"
	"encoding/json"
	//"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto" // 这里的 crypto 指向的是以太坊库
	"github.com/ethereum/go-ethereum/ethclient"
)

// --- 物理配置区 ---
const (
	RPC_URL       = "https://rpc.api.moonbase.moonbeam.network"
	PRIVATE_KEY   = "f5e9d1dc4dcd90bb0e0b9350c8aa5973011635729926387256ac5ea66324ed2b"
//你的1.1-DEV钱包私钥" // 请确保这里填入你的私钥
	CONTRACT_ADDR = "0x6A96C2513B94056241a798f060a7F573427E3606" // 刚才部署的新合约
	HASH_FILE     = "/opt/Whale-Vault/backend/hash-code.txt"
)

type RelayRequest struct {
	Dest     string `json:"dest"`
	CodeHash string `json:"codeHash"`
}

type RelayResponse struct {
	Status string `json:"status"`
	TxHash string `json:"txHash,omitempty"`
	Error  string `json:"error,omitempty"`
}

// 物理查验：验证用户输入的 123 是否在 hash-code.txt 中
func verifyCodeFromFile(inputCode string) bool {
	file, err := os.Open(HASH_FILE)
	if err != nil {
		log.Printf("错误：无法打开验证文件: %v", err)
		return false
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		// 去掉空格并对比
		if strings.TrimSpace(scanner.Text()) == strings.TrimSpace(inputCode) {
			return true
		}
	}
	return false
}

// 核心逻辑：代付并发送给读者
func performActualMint(toAddress string) (string, error) {
	client, err := ethclient.Dial(RPC_URL)
	if err != nil {
		return "", err
	}

	privateKey, err := crypto.HexToECDSA(PRIVATE_KEY)
	if err != nil {
		return "", err
	}

	fromAddress := crypto.PubkeyToAddress(privateKey.PublicKey)
	nonce, err := client.PendingNonceAt(context.Background(), fromAddress)
	if err != nil {
		return "", err
	}

	gasPrice, err := client.SuggestGasPrice(context.Background())
	if err != nil {
		return "", err
	}

	// 构造 mint(address) 的 Data 数据
	methodID := crypto.Keccak256([]byte("mint(address)"))[:4] 
	toAddr := common.HexToAddress(toAddress)
	paddedAddress := common.LeftPadBytes(toAddr.Bytes(), 32)
	
	// 拼接：[4字节函数名] + [32字节地址]
	data := append(methodID, paddedAddress...)

	gasLimit := uint64(150000) 
	tx := types.NewTransaction(nonce, common.HexToAddress(CONTRACT_ADDR), big.NewInt(0), gasLimit, gasPrice, data)

	chainID, err := client.NetworkID(context.Background())
	if err != nil {
		return "", err
	}

	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(chainID), privateKey)
	if err != nil {
		return "", err
	}

	err = client.SendTransaction(context.Background(), signedTx)
	if err != nil {
		return "", err
	}

	return signedTx.Hash().Hex(), nil
}

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("/relay/mint", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "仅支持 POST", http.StatusMethodNotAllowed)
			return
		}

		var req RelayRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "无效请求", http.StatusBadRequest)
			return
		}

		log.Printf("收到请求：目标地址=%s, 验证码=%s", req.Dest, req.CodeHash)

		// 1. 物理查验验证码
		if !verifyCodeFromFile(req.CodeHash) {
			log.Printf("🚫 验证失败：兑换码无效")
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(RelayResponse{Status: "failed", Error: "无效的兑换码，请查阅书内正确哈希"})
			return
		}

		// 2. 验证通过，执行代付
		txHash, err := performActualMint(req.Dest)
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			log.Printf("❌ Mint 失败: %v", err)
			json.NewEncoder(w).Encode(RelayResponse{Status: "failed", Error: err.Error()})
			return
		}

		log.Printf("✅ Mint 成功！Hash: %s", txHash)
		json.NewEncoder(w).Encode(RelayResponse{Status: "success", TxHash: txHash})
	})

	log.Println("🚀 Whale Vault 真·物理验证版已启动: :8080")
	http.ListenAndServe(":8080", mux)
}
