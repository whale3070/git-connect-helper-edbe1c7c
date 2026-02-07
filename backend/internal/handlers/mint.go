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
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
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
//
// ✅ 改动要点（针对你现在的现象）
// 1) 默认不再回退 CONTRACT_ADDR（避免 e250 “幽灵合约”回来）
//    - 只有当 ALLOW_CONTRACT_FALLBACK=1 时才允许回退
// 2) 增加 preflight eth_call（cast call）来提前拿到 revert（更好排查）
//    - 只有当 PREFLIGHT_CALL=1 时启用
// 3) 关键：确保使用“正确的 relayer 私钥”签名
//    - 许多合约会限制 minter 角色，如果你 RELAYER_PRIVATE_KEY 对应地址不在 allowlist，会直接 revert
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

	bookAddr := strings.ToLower(strings.TrimSpace(req.BookAddress))
	readerAddr := strings.ToLower(strings.TrimSpace(req.ReaderAddress))

	// ✅ 默认不回退旧的 CONTRACT_ADDR，除非你明确允许
	if bookAddr == "" && strings.TrimSpace(os.Getenv("ALLOW_CONTRACT_FALLBACK")) == "1" {
		bookAddr = strings.ToLower(strings.TrimSpace(os.Getenv("CONTRACT_ADDR")))
	}

	if bookAddr == "" || readerAddr == "" {
		writeErr(w, "BAD_REQUEST", "missing book_address or reader_address")
		return
	}
	if !common.IsHexAddress(bookAddr) {
		writeErr(w, "BAD_REQUEST", "book_address format invalid")
		return
	}
	if !common.IsHexAddress(readerAddr) {
		writeErr(w, "BAD_REQUEST", "reader_address format invalid")
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
	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
	defer cancel()

	// 解析 relayer（很关键：后面 preflight 需要 --from）
	relayerPriv := strings.TrimSpace(os.Getenv("RELAYER_PRIVATE_KEY"))
	relayerPriv = strings.TrimPrefix(relayerPriv, "0x")
	if relayerPriv == "" {
		writeErr(w, "CONFIG_MISSING", "RELAYER_PRIVATE_KEY not set")
		return
	}
	relayerAddr, err := deriveAddressFromPriv(relayerPriv)
	if err != nil {
		writeErr(w, "CONFIG_MISSING", "RELAYER_PRIVATE_KEY invalid")
		return
	}

	// ✅ 可选：preflight eth_call，尽早发现 revert 原因
	if strings.TrimSpace(os.Getenv("PREFLIGHT_CALL")) == "1" {
		if err := preflightMintByCastCall(ctx, bookAddr, readerAddr, relayerAddr); err != nil {
			// 这里把 preflight 的错误直接透出（比“send 后 revert”更好定位）
			mapMintError(w, err)
			return
		}
	}

	txHash, err := mintByCastSend(ctx, bookAddr, readerAddr, relayerPriv)
	if err != nil {
		mapMintError(w, err)
		return
	}

	// ✅ 注册合约进统计集合（你之前的逻辑保留）
	if h.RDB != nil {
		_ = h.RDB.SAdd(r.Context(), "vault:nft:contracts", bookAddr).Err()
		_ = h.RDB.HSet(r.Context(), "vault:tx:mint:"+strings.ToLower(txHash),
			"book", bookAddr,
			"reader", readerAddr,
			"relayer", strings.ToLower(relayerAddr),
			"ts", fmt.Sprintf("%d", time.Now().Unix()),
		).Err()
		_ = h.RDB.Expire(r.Context(), "vault:tx:mint:"+strings.ToLower(txHash), 7*24*time.Hour).Err()
	}

	writeOK(w, map[string]string{
		"tx_hash":     txHash,
		"book_addr":   bookAddr,
		"reader_addr": readerAddr,
		"relayer":     strings.ToLower(relayerAddr),
	})
}

func deriveAddressFromPriv(privHexNo0x string) (string, error) {
	pk, err := crypto.HexToECDSA(privHexNo0x)
	if err != nil {
		return "", err
	}
	return crypto.PubkeyToAddress(pk.PublicKey).Hex(), nil
}

// ==============================
// preflight: cast call (eth_call) with --from=relayer
// ==============================
func preflightMintByCastCall(ctx context.Context, bookAddr, readerAddr, relayerAddr string) error {
	castBin := foundryCastPath()
	rpcURL := strings.TrimSpace(os.Getenv("RPC_URL"))
	if rpcURL == "" {
		return errors.New("CONFIG_MISSING")
	}

	// cast call <addr> "mintToReader(address)" <reader> --from <relayer> --rpc-url <rpc>
	cmd := exec.CommandContext(
		ctx,
		castBin,
		"call",
		bookAddr,
		"mintToReader(address)",
		readerAddr,
		"--from", relayerAddr,
		"--rpc-url", rpcURL,
	)

	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		// preflight 失败：通常能在 stderr 里看到更直观的 revert 信息
		return parseCastError(stderr.String())
	}
	return nil
}

// ==============================
// send: cast send
// ==============================
func mintByCastSend(ctx context.Context, bookAddr, readerAddr, relayerPrivNo0x string) (string, error) {
	castBin := foundryCastPath()
	rpcURL := strings.TrimSpace(os.Getenv("RPC_URL"))
	if rpcURL == "" {
		return "", errors.New("CONFIG_MISSING")
	}

	cmd := exec.CommandContext(
		ctx,
		castBin,
		"send",
		bookAddr,
		"mintToReader(address)",
		readerAddr,
		"--private-key", "0x"+relayerPrivNo0x,
		"--rpc-url", rpcURL,
		"--legacy",
	)

	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return "", parseCastError(stderr.String())
	}

	out := stdout.String()
	for _, line := range strings.Split(out, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "transactionHash") {
			parts := strings.Fields(line)
			if len(parts) > 0 {
				return parts[len(parts)-1], nil
			}
		}
	}

	return "", errors.New("TX_HASH_NOT_FOUND")
}

func foundryCastPath() string {
	if p := strings.TrimSpace(os.Getenv("CAST_BIN")); p != "" {
		return p
	}
	return "cast"
}

// parseCastError: 尽量把 stderr 归一化成你的 API code
func parseCastError(stderr string) error {
	s := strings.ToLower(stderr)

	switch {
	case strings.Contains(s, "already minted"):
		return errors.New("ALREADY_MINTED")
	case strings.Contains(s, "insufficient funds"):
		return errors.New("INSUFFICIENT_GAS")
	case strings.Contains(s, "nonce"):
		return errors.New("NONCE_ERROR")
	case strings.Contains(s, "revert"):
		// 很多情况下 stderr 里会包含 revert reason / selector 等
		// 你也可以在这里做更细分的匹配
		return fmt.Errorf("EVM_REVERT: %s", strings.TrimSpace(stderr))
	default:
		return fmt.Errorf("CAST_ERROR: %s", strings.TrimSpace(stderr))
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
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":   true,
		"data": data,
	})
}

func writeErr(w http.ResponseWriter, code string, msg string) {
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":    false,
		"code":  code,
		"error": msg,
	})
}

func mapMintError(w http.ResponseWriter, err error) {
	msg := err.Error()
	switch {
	case msg == "ALREADY_MINTED":
		writeErr(w, "ALREADY_MINTED", "reader already minted this nft")
	case msg == "INSUFFICIENT_GAS":
		writeErr(w, "INSUFFICIENT_GAS", "relayer gas insufficient")
	case msg == "NONCE_ERROR":
		writeErr(w, "NONCE_ERROR", "nonce conflict, retry")
	case msg == "CONFIG_MISSING":
		writeErr(w, "CONFIG_MISSING", "RELAYER_PRIVATE_KEY or RPC_URL not set")
	case msg == "TX_HASH_NOT_FOUND":
		writeErr(w, "TX_HASH_NOT_FOUND", "tx hash not found in cast output")
	default:
		// 把 revert/cast 的 stderr 原样（短一些）透出去，排错更快
		if strings.HasPrefix(msg, "EVM_REVERT:") {
			writeErr(w, "REVERT", strings.TrimSpace(strings.TrimPrefix(msg, "EVM_REVERT:")))
			return
		}
		if strings.HasPrefix(msg, "CAST_ERROR:") {
			writeErr(w, "CAST_FAILED", strings.TrimSpace(strings.TrimPrefix(msg, "CAST_ERROR:")))
			return
		}
		writeErr(w, "MINT_FAILED", msg)
	}
}
