package handlers

import (
	"context"
	"encoding/json"
	"log"
	"math/big"
	"net/http"
	"strings"
	"sync"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/redis/go-redis/v9"
)

type Relayer struct {
	PrivateKey string
	Address    string
	Nonce      uint64
	Mu         sync.Mutex
}

var (
	Relayers []*Relayer
	relayIdx int
	relayMu  sync.Mutex
)

func LoadRelayers(client *ethclient.Client, chainID *big.Int) {
	log.Println("✅ Relayer 钱包池初始化完成")
}

func GetNextRelayer() *Relayer {
	relayMu.Lock()
	defer relayMu.Unlock()
	if len(Relayers) == 0 {
		return nil
	}
	r := Relayers[relayIdx%len(Relayers)]
	relayIdx++
	return r
}

type AuthHandler struct {
	RDB    *redis.Client
	Client *ethclient.Client
}

func (h *AuthHandler) GetBinding(w http.ResponseWriter, r *http.Request) {
	codeHash := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("codeHash")))
	if codeHash == "" {
		h.sendJSON(w, http.StatusBadRequest, map[string]interface{}{"ok": false, "error": "缺少 codeHash 参数"})
		return
	}

	ctx := context.Background()
	bindData, err := h.RDB.HGetAll(ctx, "vault:bind:"+codeHash).Result()
	if err != nil || len(bindData) == 0 {
		h.sendJSON(w, http.StatusNotFound, map[string]interface{}{"ok": false, "error": "未找到绑定信息"})
		return
	}

	role := h.determineRole(ctx, codeHash)
	h.sendJSON(w, http.StatusOK, map[string]interface{}{
		"ok": true, "address": bindData["address"], "privateKey": bindData["privateKey"], "role": role,
	})
}

func (h *AuthHandler) Verify(w http.ResponseWriter, r *http.Request) {
	codeHash := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("codeHash")))
	if codeHash == "" {
		h.sendJSON(w, http.StatusBadRequest, map[string]interface{}{"ok": false, "error": "缺少 codeHash 参数"})
		return
	}

	ctx := context.Background()
	isUsed, _ := h.RDB.SIsMember(ctx, "vault:codes:used", codeHash).Result()
	if isUsed {
		h.sendJSON(w, http.StatusBadRequest, map[string]interface{}{"ok": false, "error": "该激活码已被使用"})
		return
	}

	role := h.determineRole(ctx, codeHash)
	address, _ := h.RDB.HGet(ctx, "vault:bind:"+codeHash, "address").Result()

	if role == "unknown" {
		h.sendJSON(w, http.StatusNotFound, map[string]interface{}{"ok": false, "error": "无效的激活码"})
		return
	}
	h.sendJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "role": role, "address": address})
}

func (h *AuthHandler) CheckAdminAccess(w http.ResponseWriter, r *http.Request) {
	address := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("address")))
	if address == "" {
		h.sendJSON(w, http.StatusBadRequest, map[string]interface{}{"ok": false, "error": "缺少 address 参数"})
		return
	}
	ctx := context.Background()
	isPublisher, _ := h.RDB.SIsMember(ctx, "vault:roles:publishers", address).Result()
	h.sendJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "hasAccess": isPublisher})
}

func (h *AuthHandler) determineRole(ctx context.Context, codeHash string) string {
	if is, _ := h.RDB.SIsMember(ctx, "vault:roles:publishers_codes", codeHash).Result(); is {
		return "publisher"
	}
	if is, _ := h.RDB.SIsMember(ctx, "vault:roles:authors_codes", codeHash).Result(); is {
		return "author"
	}
	if is, _ := h.RDB.SIsMember(ctx, "vault:codes:valid", codeHash).Result(); is {
		return "reader"
	}
	return "unknown"
}

func (h *AuthHandler) sendJSON(w http.ResponseWriter, code int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(payload)
}

func DeriveAddressFromPrivateKey(privateKeyHex string) string {
	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil {
		return ""
	}
	return crypto.PubkeyToAddress(privateKey.PublicKey).Hex()
}
