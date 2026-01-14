package main

import (
	"bufio"
	"context"
	"encoding/json"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

// --- 物理配置区 ---
const (
	RPC_URL       = "https://rpc.api.moonbase.moonbeam.network"
	PRIVATE_KEY   = "f5e9d1dc4dcd90bb0e0b9350c8aa5973011635729926387256ac5ea66324ed2b"
	CONTRACT_ADDR = "0x6A96C2513B94056241a798f060a7F573427E3606"
	HASH_FILE     = "/opt/Whale-Vault/backend/hash-code.txt"
	DIST_PATH     = "/opt/Whale-Vault/dist" // 前端文件所在物理路径
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

// 物理查验：验证码匹配逻辑（保持不变）
func verifyCodeFromFile(inputCode string) bool {
	file, err := os.Open(HASH_FILE)
	if err != nil {
		log.Printf("错误：无法打开验证文件: %v", err)
		return false
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		if strings.TrimSpace(scanner.Text()) == strings.TrimSpace(inputCode) {
			return true
		}
	}
	return false
}

// 核心逻辑：代付铸造（保持不变）
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

	methodID := crypto.Keccak256([]byte("mint(address)"))[:4]
	toAddr := common.HexToAddress(toAddress)
	paddedAddress := common.LeftPadBytes(toAddr.Bytes(), 32)
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

	// 1. 新增功能：页面分发路由
	// 匹配访问路径如：/valut_mint_nft/123 或 /valut_mint_nft/345
	mux.HandleFunc("/valut_mint_nft/", func(w http.ResponseWriter, r *http.Request) {
		// 提取路径中的 Code (例如 123)
		trimmedPath := strings.Trim(r.URL.Path, "/")
		parts := strings.Split(trimmedPath, "/")
		
		userCode := ""
		if len(parts) >= 2 {
			userCode = parts[1]
		}

		log.Printf("📥 页面访问请求：路径=%s, 提取码=%s", r.URL.Path, userCode)

		// 物理检索 hash-code.txt
		if userCode != "" && verifyCodeFromFile(userCode) {
			log.Printf("✅ 匹配成功，分发 NFT 领取页面")
			http.ServeFile(w, r, DIST_PATH+"/index.html")
		} else {
			log.Printf("🚫 匹配失败或路径非法，分发 403 页面")
			w.WriteHeader(http.StatusForbidden)
			http.ServeFile(w, r, DIST_PATH+"/403.html")
		}
	})

	// 2. 原有功能：Mint 接口（保持崩溃前逻辑）
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

		if !verifyCodeFromFile(req.CodeHash) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(RelayResponse{Status: "failed", Error: "无效的兑换码"})
			return
		}

		txHash, err := performActualMint(req.Dest)
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			json.NewEncoder(w).Encode(RelayResponse{Status: "failed", Error: err.Error()})
			return
		}
		json.NewEncoder(w).Encode(RelayResponse{Status: "success", TxHash: txHash})
	})

	log.Println("🚀 Whale Vault 路由增强版已启动: :8080")
	http.ListenAndServe(":8080", mux)
}
