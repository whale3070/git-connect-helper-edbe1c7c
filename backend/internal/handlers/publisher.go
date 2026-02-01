package handlers

import (
	"archive/zip"
	"bytes"
	//"context"
	//"crypto/ecdsa"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	//"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/redis/go-redis/v9"
	"github.com/skip2/go-qrcode"
)

// PublisherHandler 封装 Redis 和 Ethereum 客户端
type PublisherHandler struct {
	RDB    *redis.Client
	Client *ethclient.Client
	FactoryAddr string // 工厂合约地址
}

// -----------------------------
// 1️⃣ 生成兑换码 ZIP
// -----------------------------
func (h *PublisherHandler) GenerateAndDownloadZip(w http.ResponseWriter, r *http.Request) {
	countStr := r.URL.Query().Get("count")
	count, _ := strconv.Atoi(countStr)
	if count <= 0 || count > 500 {
		count = 100
	}

	zipBuf := new(bytes.Buffer)
	zipWriter := zip.NewWriter(zipBuf)
	var generatedCodes []string

	for i := 0; i < count; i++ {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			http.Error(w, "随机数生成失败", http.StatusInternalServerError)
			return
		}
		code := "0x" + hex.EncodeToString(b)
		generatedCodes = append(generatedCodes, code)

		qrUrl := fmt.Sprintf("http://198.55.109.102:5173/valut_mint_nft/%s", code)
		qrPng, _ := qrcode.Encode(qrUrl, qrcode.Medium, 256)

		f, _ := zipWriter.Create(fmt.Sprintf("qr_codes/book_code_%d.png", i+1))
		f.Write(qrPng)

		t, _ := zipWriter.Create(fmt.Sprintf("hashes/hash_%d.txt", i+1))
		t.Write([]byte(code))
	}

	pipe := h.RDB.Pipeline()
	for _, c := range generatedCodes {
		pipe.SAdd(r.Context(), "vault:codes:valid", c)
	}
	if _, err := pipe.Exec(r.Context()); err != nil {
		http.Error(w, "Redis 写入失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	zipWriter.Close()
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=WhaleVault_Codes_%d.zip", count))
	w.Write(zipBuf.Bytes())
}

// -----------------------------
// 2️⃣ 部署子合约接口
// -----------------------------
type DeployBookRequest struct {
	Name      string `json:"name"`      // 书名
	Symbol    string `json:"symbol"`    // NFT 符号
	Author    string `json:"author"`    // 作者
	Serial    string `json:"serial"`    // 序列号
	Publisher string `json:"publisher"` // 出版社钱包地址
	PrivKey   string `json:"privKey"`   // 部署私钥
}

type DeployBookResponse struct {
	Ok       bool   `json:"ok"`
	TxHash   string `json:"txHash"`
	BookAddr string `json:"bookAddr"`
}

// CreateBook 通过工厂合约部署子合约
func (h *PublisherHandler) CreateBook(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req DeployBookRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "解析请求失败: "+err.Error(), http.StatusBadRequest)
		return
	}

	privKey, err := crypto.HexToECDSA(strings.TrimPrefix(req.PrivKey, "0x"))
	if err != nil {
		http.Error(w, "私钥无效: "+err.Error(), http.StatusBadRequest)
		return
	}
	fromAddr := crypto.PubkeyToAddress(privKey.PublicKey)

	// 工厂合约地址
	contractAddr := common.HexToAddress(h.FactoryAddr)

	// 构造 createBook 方法调用数据
	methodSig := crypto.Keccak256([]byte("createBook(string,string,string,string,address)"))[:4]
	nameBytes := append([]byte(req.Name), make([]byte, 32-len(req.Name))...)
	symbolBytes := append([]byte(req.Symbol), make([]byte, 32-len(req.Symbol))...)
	authorBytes := append([]byte(req.Author), make([]byte, 32-len(req.Author))...)
	serialBytes := append([]byte(req.Serial), make([]byte, 32-len(req.Serial))...)
	publisherAddrBytes := common.HexToAddress(req.Publisher).Bytes()

	data := append(methodSig, nameBytes...)
	data = append(data, symbolBytes...)
	data = append(data, authorBytes...)
	data = append(data, serialBytes...)
	data = append(data, publisherAddrBytes...)

	// 获取 nonce 和 gas price
	client := h.Client
	nonce, _ := client.PendingNonceAt(ctx, fromAddr)
	gasPrice, _ := client.SuggestGasPrice(ctx)
	chainID, _ := client.ChainID(ctx)

	tx := types.NewTx(&types.LegacyTx{
		Nonce:    nonce,
		To:       &contractAddr,
		Value:    nil,
		Gas:      5000000,
		GasPrice: gasPrice,
		Data:     data,
	})

	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(chainID), privKey)
	if err != nil {
		http.Error(w, "签名交易失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := client.SendTransaction(ctx, signedTx); err != nil {
		http.Error(w, "发送交易失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 子合约地址可以通过 factory 事件或 CREATE2 预计算，这里简单使用 tx.Hash() 暂存
	bookKey := fmt.Sprintf("publisher:%s:books", req.Publisher)
	if err := h.RDB.SAdd(ctx, bookKey, signedTx.Hash().Hex()).Err(); err != nil {
		http.Error(w, "Redis 写入失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	resp := DeployBookResponse{
		Ok:       true,
		TxHash:   signedTx.Hash().Hex(),
		BookAddr: signedTx.Hash().Hex(), // 注意：实际部署合约地址需通过 CREATE2 或事件获取
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
