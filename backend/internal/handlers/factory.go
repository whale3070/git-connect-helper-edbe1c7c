package handlers

import (
	"context"
	"encoding/json"
//	"fmt"
	"math/big"
	"net/http"
	"os"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/redis/go-redis/v9"
)

type FactoryHandler struct {
	RDB    *redis.Client
	Client *ethclient.Client
}

// DeployBook 处理前端 /api/v1/factory/deploy-book 的请求
func (h *FactoryHandler) DeployBook(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CodeHash   string `json:"codeHash"`
		BookName   string `json:"bookName"`
		AuthorName string `json:"authorName"`
		Symbol     string `json:"symbol"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendJSON(w, 400, map[string]interface{}{"ok": false, "error": "无效的参数格式"})
		return
	}

	// 1. 从 Redis 获取出版社私钥（从之前 main.go 逻辑平移）
	pubData, err := h.RDB.HGetAll(context.Background(), "vault:bind:"+req.CodeHash).Result()
	if err != nil || len(pubData) == 0 {
		h.sendJSON(w, 403, map[string]interface{}{"ok": false, "error": "鉴权失败：找不到该出版社的密钥信息"})
		return
	}

	privateKeyHex := pubData["private_key"]
	publisherAddress := pubData["address"]
	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil {
		h.sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "出版社私钥格式错误"})
		return
	}

	// 2. 检查余额 (至少需要 2 CFX: 1作为部署费, 1作为Gas预留)
	pubAddr := common.HexToAddress(publisherAddress)
	balance, _ := h.Client.BalanceAt(context.Background(), pubAddr, nil)
	minReq := new(big.Int).Mul(big.NewInt(2), big.NewInt(1e18))
	if balance.Cmp(minReq) < 0 {
		h.sendJSON(w, 400, map[string]interface{}{"ok": false, "error": "余额不足，部署需约 2 CFX"})
		return
	}

	// 3. 构造 ABI 编码 (对接 BookFactory.sol)
	// 参数: string name, string symbol, string author, string baseURI, address relayer
	factoryAddr := os.Getenv("FACTORY_ADDR")
	if factoryAddr == "" {
		factoryAddr = "0xe0c25B2D0C0bB524d0561496eb72816368986Ca7"
	}
	
	// 这里使用之前调试成功的 ABI 手动编码逻辑
	callData := encodeDeployBookData(req.BookName, req.Symbol, req.AuthorName, "https://arweave.net/metadata", common.Address{})

	// 4. 发送交易
	nonce, _ := h.Client.PendingNonceAt(context.Background(), pubAddr)
	gasPrice, _ := h.Client.SuggestGasPrice(context.Background())
	deployFee := new(big.Int).Mul(big.NewInt(1), big.NewInt(1e18)) // 1 CFX 部署费

	tx := types.NewTransaction(
		nonce,
		common.HexToAddress(factoryAddr),
		deployFee,
		uint64(6000000), // 【关键】高 Gas Limit 确保部署成功
		gasPrice,
		callData,
	)

	// 使用 EIP-155 签名 (ChainID 71)
	chainID := big.NewInt(71) 
	signedTx, _ := types.SignTx(tx, types.NewEIP155Signer(chainID), privateKey)
	
	err = h.Client.SendTransaction(context.Background(), signedTx)
	if err != nil {
		h.sendJSON(w, 500, map[string]interface{}{"ok": false, "error": "上链失败: " + err.Error()})
		return
	}

	h.sendJSON(w, 200, map[string]interface{}{
		"ok": true, 
		"txHash": signedTx.Hash().Hex(),
		"message": "书籍部署交易已发出",
	})
}

// 辅助函数：手动构造 ABI Data
func encodeDeployBookData(name, symbol, author, uri string, relayer common.Address) []byte {
	methodID := common.FromHex("7d9f6db5") // deployBook(string,string,string,string,address)
	
	encStr := func(s string) []byte {
		b := []byte(s)
		l := make([]byte, 32)
		big.NewInt(int64(len(b))).FillBytes(l)
		p := ((len(b) + 31) / 32) * 32
		data := make([]byte, p)
		copy(data, b)
		return append(l, data...)
	}

	d1, d2, d3, d4 := encStr(name), encStr(symbol), encStr(author), encStr(uri)
	hSize := 5 * 32 // 4个偏移量 + 1个地址
	o1 := hSize
	o2 := o1 + len(d1)
	o3 := o2 + len(d2)
	o4 := o3 + len(d3)

	res := append([]byte{}, methodID...)
	put := func(n int) {
		b := make([]byte, 32)
		big.NewInt(int64(n)).FillBytes(b)
		res = append(res, b...)
	}
	put(o1); put(o2); put(o3); put(o4)

	addrP := make([]byte, 32)
	copy(addrP[12:], relayer.Bytes())
	res = append(res, addrP...)
	res = append(res, d1...); res = append(res, d2...); res = append(res, d3...); res = append(res, d4...)

	return res
}

func (h *FactoryHandler) sendJSON(w http.ResponseWriter, code int, p interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(p)
}
