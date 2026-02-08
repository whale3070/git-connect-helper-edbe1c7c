// mint.go
package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
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
// ✅ 方案A：强制使用出版社 owner 私钥签名（mintToReader 通常 onlyOwner）
//
// 其他保留：
// 1) 默认不回退 CONTRACT_ADDR（避免“幽灵合约”回来），仅当 ALLOW_CONTRACT_FALLBACK=1 才允许
// 2) 可选 preflight eth_call（cast call），仅当 PREFLIGHT_CALL=1 启用
//
// ✅ 新增：Mint 成功后加入热力图回响
//    go (&RelayHandler{RDB: h.RDB}).CaptureEcho(ip)
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

	// ✅ 方案A：强制使用出版社 owner 私钥
	ownerPriv := strings.TrimSpace(os.Getenv("PUBLISHER_OWNER_PRIVKEY"))
	ownerPriv = strings.TrimPrefix(ownerPriv, "0x")
	if ownerPriv == "" {
		writeErr(w, "CONFIG_MISSING", "PUBLISHER_OWNER_PRIVKEY not set")
		return
	}

	ownerAddr, err := deriveAddressFromPriv(ownerPriv)
	if err != nil {
		writeErr(w, "CONFIG_MISSING", "PUBLISHER_OWNER_PRIVKEY invalid")
		return
	}

	// （可选但强烈推荐）硬校验：防止你 env 塞错 key
	const expectedOwner = "0x62d64E720bb617EfE92249ade17DF3d239eAe76E"
	if strings.ToLower(ownerAddr) != strings.ToLower(expectedOwner) {
		writeErr(w, "CONFIG_MISSING", fmt.Sprintf("owner key mismatch: got=%s want=%s", ownerAddr, expectedOwner))
		return
	}

	// ✅ 可选：preflight eth_call，尽早发现 revert 原因
	if strings.TrimSpace(os.Getenv("PREFLIGHT_CALL")) == "1" {
		if err := preflightMintByCastCall(ctx, bookAddr, readerAddr, ownerAddr); err != nil {
			mapMintError(w, err)
			return
		}
	}

	txHash, err := mintByCastSend(ctx, bookAddr, readerAddr, ownerPriv)
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
			"relayer", strings.ToLower(ownerAddr), // 字段名不改，值写 owner（方案A）
			"ts", fmt.Sprintf("%d", time.Now().Unix()),
		).Err()
		_ = h.RDB.Expire(r.Context(), "vault:tx:mint:"+strings.ToLower(txHash), 7*24*time.Hour).Err()
	}

	// ✅ 新增：Mint 成功后写一次“回响/热力图”
	// 这里不依赖 MintHandler 拥有 GeoIP；CaptureEcho 会 fallback 到全局 geoIPGlobal（SetGeoIP 注入）
	if h.RDB != nil {
		ip := extractClientIP(r)
		// 用一个轻量 RelayHandler 临时调用（避免改 main.go 传 relayH）
		go (&RelayHandler{RDB: h.RDB}).CaptureEcho(ip)
	}

	writeOK(w, map[string]string{
		"tx_hash":     txHash,
		"book_addr":   bookAddr,
		"reader_addr": readerAddr,
		"relayer":     strings.ToLower(ownerAddr),
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
// preflight: cast call (eth_call) with --from=owner
// ==============================
func preflightMintByCastCall(ctx context.Context, bookAddr, readerAddr, fromAddr string) error {
	castBin := foundryCastPath()
	rpcURL := strings.TrimSpace(os.Getenv("RPC_URL"))
	if rpcURL == "" {
		return errors.New("CONFIG_MISSING")
	}

	cmd := exec.CommandContext(
		ctx,
		castBin,
		"call",
		bookAddr,
		"mintToReader(address)",
		readerAddr,
		"--from", fromAddr,
		"--rpc-url", rpcURL,
	)

	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return parseCastError(stderr.String())
	}
	return nil
}

// ==============================
// send: cast send (signed by owner)
// ==============================
func mintByCastSend(ctx context.Context, bookAddr, readerAddr, privNo0x string) (string, error) {
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
		"--private-key", "0x"+privNo0x,
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
		writeErr(w, "INSUFFICIENT_GAS", "signer gas insufficient")
	case msg == "NONCE_ERROR":
		writeErr(w, "NONCE_ERROR", "nonce conflict, retry")
	case msg == "CONFIG_MISSING":
		writeErr(w, "CONFIG_MISSING", "PUBLISHER_OWNER_PRIVKEY or RPC_URL not set")
	case msg == "TX_HASH_NOT_FOUND":
		writeErr(w, "TX_HASH_NOT_FOUND", "tx hash not found in cast output")
	default:
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

// ==============================
// 新增：从请求里提取客户端 IP（和你之前 ip.go 的逻辑一致）
// ==============================
func extractClientIP(r *http.Request) string {
	// 1) X-Forwarded-For: "client, proxy1, proxy2"
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if len(parts) > 0 {
			ip := strings.TrimSpace(parts[0])
			if ip != "" {
				return ip
			}
		}
	}

	// 2) X-Real-IP
	if ip := strings.TrimSpace(r.Header.Get("X-Real-IP")); ip != "" {
		return ip
	}

	// 3) fallback: RemoteAddr
	if host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr)); err == nil {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}
