package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
//	"sync"
	"time"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/redis/go-redis/v9"
)

var (
	mintSemaphore = make(chan struct{}, 5) // 并发保护：最多 5 笔 mint 同时进行
)

// ==============================
// MintHandler
// ==============================
type MintHandler struct {
	RDB    *redis.Client
	Client *ethclient.Client
}

// ==============================
// HTTP Handler: Mint NFT
// POST /relay/mint
// ==============================
func (h *MintHandler) Mint(w http.ResponseWriter, r *http.Request) {
	type MintReq struct {
		BookAddress   string `json:"book_address"`
		ReaderAddress string `json:"reader_address"`
	}

	var req MintReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, "BAD_REQUEST", "invalid json body")
		return
	}

	if req.BookAddress == "" || req.ReaderAddress == "" {
		writeErr(w, "BAD_REQUEST", "missing book_address or reader_address")
		return
	}

	// 并发保护
	select {
	case mintSemaphore <- struct{}{}:
		defer func() { <-mintSemaphore }()
	default:
		writeErr(w, "BUSY", "mint service busy, retry later")
		return
	}

	// 超时控制
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	txHash, err := mintByCast(ctx, req.BookAddress, req.ReaderAddress)
	if err != nil {
		mapMintError(w, err)
		return
	}

	writeOK(w, map[string]string{
		"tx_hash": txHash,
	})
}

// ==============================
// 核心：通过 Foundry cast mint
// ==============================
func mintByCast(
	ctx context.Context,
	bookAddr string,
	readerAddr string,
) (string, error) {

	castBin := foundryCastPath()

	privateKey := os.Getenv("RELAYER_PRIVATE_KEY")
	rpcURL := os.Getenv("RPC_URL")

	if privateKey == "" || rpcURL == "" {
		return "", errors.New("CONFIG_MISSING")
	}

	cmd := exec.CommandContext(
		ctx,
		castBin,
		"send",
		bookAddr,
		"mintToReader(address)",
		readerAddr,
		"--private-key", privateKey,
		"--rpc-url", rpcURL,
		"--legacy",
	)

	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		return "", parseCastError(stderr.String())
	}

	out := stdout.String()

	// 从 cast 输出中提取 tx hash
	for _, line := range strings.Split(out, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "transactionHash") {
			parts := strings.Fields(line)
			return parts[len(parts)-1], nil
		}
	}

	return "", errors.New("TX_HASH_NOT_FOUND")
}

// ==============================
// Foundry 路径 util（未来可替换 AA）
// ==============================
func foundryCastPath() string {
	if p := os.Getenv("CAST_BIN"); p != "" {
		return p
	}
	return "cast" // 默认依赖 PATH
}

// ==============================
// cast stderr → 结构化错误
// ==============================
func parseCastError(stderr string) error {
	s := strings.ToLower(stderr)

	switch {
	case strings.Contains(s, "already minted"):
		return errors.New("ALREADY_MINTED")
	case strings.Contains(s, "revert"):
		return errors.New("EVM_REVERT")
	case strings.Contains(s, "insufficient funds"):
		return errors.New("INSUFFICIENT_GAS")
	case strings.Contains(s, "execution reverted"):
		return errors.New("EXECUTION_REVERTED")
	case strings.Contains(s, "nonce"):
		return errors.New("NONCE_ERROR")
	default:
		return fmt.Errorf("CAST_ERROR: %s", stderr)
	}
}

// ==============================
// 其他接口（保留，避免破坏 main.go）
// ==============================

func (h *MintHandler) GetTotalMinted(w http.ResponseWriter, r *http.Request) {
	writeOK(w, map[string]int{"total": 0})
}

func (h *MintHandler) GetReaderLocation(w http.ResponseWriter, r *http.Request) {
	writeOK(w, map[string]string{"location": "unknown"})
}

// ==============================
// HTTP 工具
// ==============================
func writeOK(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"ok":   true,
		"data": data,
	})
}

func writeErr(w http.ResponseWriter, code string, msg string) {
	w.WriteHeader(http.StatusBadRequest)
	json.NewEncoder(w).Encode(map[string]any{
		"ok":    false,
		"code":  code,
		"error": msg,
	})
}

func mapMintError(w http.ResponseWriter, err error) {
	switch err.Error() {
	case "ALREADY_MINTED":
		writeErr(w, "ALREADY_MINTED", "reader already minted this nft")
	case "INSUFFICIENT_GAS":
		writeErr(w, "INSUFFICIENT_GAS", "relayer gas insufficient")
	case "NONCE_ERROR":
		writeErr(w, "NONCE_ERROR", "nonce conflict, retry")
	case "EVM_REVERT", "EXECUTION_REVERTED":
		writeErr(w, "REVERT", "contract reverted")
	default:
		writeErr(w, "CAST_FAILED", err.Error())
	}
}
