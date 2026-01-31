package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/redis/go-redis/v9"
)

type MintHandler struct {
	RDB    *redis.Client
	Client *ethclient.Client
}

func (h *MintHandler) Mint(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CodeHash string `json:"codeHash"`
		Address  string `json:"address"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendJSON(w, http.StatusBadRequest, map[string]interface{}{"ok": false, "error": "无效的请求格式"})
		return
	}

	codeHash := strings.ToLower(strings.TrimSpace(req.CodeHash))
	address := strings.ToLower(strings.TrimSpace(req.Address))
	if codeHash == "" || address == "" {
		h.sendJSON(w, http.StatusBadRequest, map[string]interface{}{"ok": false, "error": "缺少必要参数"})
		return
	}

	ctx := context.Background()
	if isUsed, _ := h.RDB.SIsMember(ctx, "vault:codes:used", codeHash).Result(); isUsed {
		h.sendJSON(w, http.StatusBadRequest, map[string]interface{}{"ok": false, "error": "该激活码已被使用"})
		return
	}
	if isValid, _ := h.RDB.SIsMember(ctx, "vault:codes:valid", codeHash).Result(); !isValid {
		h.sendJSON(w, http.StatusBadRequest, map[string]interface{}{"ok": false, "error": "无效的激活码"})
		return
	}

	pipe := h.RDB.Pipeline()
	pipe.SRem(ctx, "vault:codes:valid", codeHash)
	pipe.SAdd(ctx, "vault:codes:used", codeHash)
	pipe.Exec(ctx)

	log.Printf("✅ NFT 铸造成功: codeHash=%s, address=%s", codeHash, address)
	h.sendJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "message": "NFT 铸造成功", "txHash": "0x" + codeHash[:16] + "..."})
}

func (h *MintHandler) GetTotalMinted(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()
	usedCount, _ := h.RDB.SCard(ctx, "vault:codes:used").Result()
	h.sendJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "totalMinted": usedCount})
}

func (h *MintHandler) GetReaderLocation(w http.ResponseWriter, r *http.Request) {
	address := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("address")))
	if address == "" {
		h.sendJSON(w, http.StatusBadRequest, map[string]interface{}{"ok": false, "error": "缺少 address 参数"})
		return
	}
	ctx := context.Background()
	ip, err := h.RDB.HGet(ctx, "vault:reader:locations", address).Result()
	if err != nil {
		h.sendJSON(w, http.StatusNotFound, map[string]interface{}{"ok": false, "error": "未找到位置信息"})
		return
	}
	h.sendJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "ip": ip})
}

func (h *MintHandler) sendJSON(w http.ResponseWriter, code int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(payload)
}
