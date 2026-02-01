package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi/bind" // 用于 WaitMined 确权
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

// --- 物理配置区 ---
const (
	RPC_URL       = "https://rpc.api.moonbase.moonbeam.network"
	PRIVATE_KEY   = "f5e9d1dc4dcd90bb0e0b9350c8aa5973011635729926387256ac5ea66324ed2b"
//ad9f1a00f5514c831af92c28c4b381a69770ace6b7b9e75b9845ec8c8799a4ff"
	CONTRACT_ADDR = "0x705A0890bFDcD30eaf06b25b9D31a6C5C099100d"
//0xd0d2380ff21B0daB5Cd75DDA064146a6d36dC6C2"
//0x705A0890bFDcD30eaf06b25b9D31a6C5C099100d" 
	HASH_FILE     = "/opt/Whale-Vault/backend/hash-code.txt"
	DIST_PATH     = "/opt/Whale-Vault/dist"
)

type RelayRequest struct {
	Dest     string `json:"dest"`
	CodeHash string `json:"codeHash"`
}

type RelayResponse struct {
	Status  string `json:"status"`
	TxHash  string `json:"txHash,omitempty"`
	TokenID string `json:"token_id,omitempty"` 
	Error   string `json:"error,omitempty"`
}

// 物理查验：验证码匹配逻辑
func verifyCodeFromFile(inputCode string) bool {
	file, err := os.Open(HASH_FILE)
	if err != nil {
		log.Printf("❌ 无法打开验证文件: %v", err)
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

// 物理核销：一旦成功便从文件中移除提取码
func useCodeFromFile(inputCode string) {
	input := strings.TrimSpace(inputCode)
	content, err := os.ReadFile(HASH_FILE)
	if err != nil {
		log.Printf("❌ 读取文件失败无法核销: %v", err)
		return
	}

	lines := strings.Split(string(content), "\n")
	var newLines []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed != input && trimmed != "" {
			newLines = append(newLines, line)
		}
	}
	
	err = os.WriteFile(HASH_FILE, []byte(strings.Join(newLines, "\n")+"\n"), 0644)
	if err != nil {
		log.Printf("❌ 写入文件失败: %v", err)
	} else {
		log.Printf("♻️ 提取码 %s 已物理销毁（防止重复 Mint）", input)
	}
}

// 核心逻辑：带 ID 解析的代付铸造
func performActualMint(toAddress string) (string, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second) 
	defer cancel()

	client, err := ethclient.Dial(RPC_URL)
	if err != nil {
		return "", "", fmt.Errorf("RPC连接失败: %v", err)
	}

	privateKey, err := crypto.HexToECDSA(PRIVATE_KEY)
	if err != nil {
		return "", "", fmt.Errorf("私钥解析失败: %v", err)
	}

	fromAddress := crypto.PubkeyToAddress(privateKey.PublicKey)
	nonce, _ := client.PendingNonceAt(ctx, fromAddress)

	methodID := crypto.Keccak256([]byte("mint(address)"))[:4]
	toAddr := common.HexToAddress(toAddress)
	paddedAddress := common.LeftPadBytes(toAddr.Bytes(), 32)
	data := append(methodID, paddedAddress...)

	gasPrice, _ := client.SuggestGasPrice(ctx)
	contractAddr := common.HexToAddress(CONTRACT_ADDR)
	
	gasLimit, err := client.EstimateGas(ctx, ethereum.CallMsg{
		From: fromAddress, To: &contractAddr, Data: data,
	})
	if err != nil {
		gasLimit = 200000 
	}

	tx := types.NewTransaction(nonce, contractAddr, big.NewInt(0), gasLimit, gasPrice, data)
	chainID, _ := client.NetworkID(ctx)
	signedTx, _ := types.SignTx(tx, types.NewEIP155Signer(chainID), privateKey)

	err = client.SendTransaction(ctx, signedTx)
	if err != nil {
		return "", "", fmt.Errorf("发送交易失败: %v", err)
	}

	// 等待上链并抓取 TokenID
	receipt, err := bind.WaitMined(ctx, client, signedTx)
	if err != nil {
		return signedTx.Hash().Hex(), "", fmt.Errorf("等待确认超时: %s", signedTx.Hash().Hex())
	}

	tokenIdStr := "0"
	if len(receipt.Logs) > 0 {
		lastLog := receipt.Logs[len(receipt.Logs)-1]
		if len(lastLog.Topics) >= 4 {
			tokenIdStr = lastLog.Topics[3].Big().String()
		}
	}

	return signedTx.Hash().Hex(), tokenIdStr, nil
}

func main() {
	mux := http.NewServeMux()

	// 路由 A：分发页面逻辑优化
	mux.HandleFunc("/valut_mint_nft/", func(w http.ResponseWriter, r *http.Request) {
		trimmedPath := strings.Trim(r.URL.Path, "/")
		parts := strings.Split(trimmedPath, "/")
		userCode := ""
		if len(parts) >= 2 { userCode = parts[1] }

		if userCode != "" && verifyCodeFromFile(userCode) {
			log.Printf("✅ 提取码匹配成功: %s", userCode)
			http.ServeFile(w, r, DIST_PATH+"/index.html")
			return // 👈 关键修复：发送文件后立即返回，防止再次写入 Header
		} else {
			log.Printf("🚫 提取码无效: %s", userCode)
			w.WriteHeader(http.StatusForbidden)
			http.ServeFile(w, r, DIST_PATH+"/403.html")
			return // 👈 关键修复
		}
	})

	// 路由 B：Mint 接口
	mux.HandleFunc("/relay/mint", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}

		var req RelayRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		
		if !verifyCodeFromFile(req.CodeHash) {
			log.Printf("🚫 提取码 %s 已被使用或无效", req.CodeHash)
			w.WriteHeader(http.StatusForbidden) // 物理拦截：返回 403 触发前端精准报错
			json.NewEncoder(w).Encode(RelayResponse{Status: "failed", Error: "该验证码不存在或已被使用"})
			return
		}

		// 执行 Mint 并解析 ID
		txHash, tokenId, err := performActualMint(req.Dest)
		if err != nil {
			log.Printf("❌ Mint 失败: %v", err)
			json.NewEncoder(w).Encode(RelayResponse{Status: "failed", Error: err.Error()})
			return
		}

		// 成功后物理核销
		useCodeFromFile(req.CodeHash)

		log.Printf("🎉 铸造成功! ID=%s, TX=%s", tokenId, txHash)
		json.NewEncoder(w).Encode(RelayResponse{
			Status: "success", 
			TxHash: txHash, 
			TokenID: tokenId,
		})
	})

	log.Println("🚀 Whale Vault 核心服务已启动：监听端口 :8080")
	if err := http.ListenAndServe(":8080", mux); err != nil {
		log.Fatalf("❌ 服务启动失败: %v", err)
	}
}
