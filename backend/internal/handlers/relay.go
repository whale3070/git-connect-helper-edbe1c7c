//读者扫码 → 先在 Redis 做校验和暂存 → 凑够规则后发起奖励交易 → 提供统计查询
package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/oschwald/geoip2-golang" // 1. 添加此引用
	"github.com/redis/go-redis/v9"

	"whale-vault/relay/internal/blockchain"
)

// RelayHandler 封装读者端依赖
type RelayHandler struct {
	RDB        *redis.Client
	Client     *ethclient.Client
	RewardSvc  *blockchain.RewardService
	GeoIP     *geoip2.Reader // 2. 添加此字段
}

// CommonResponse 统一响应格式
type CommonResponse struct {
	Ok     bool   `json:"ok,omitempty"`
	Status string `json:"status,omitempty"`
	TxHash string `json:"txHash,omitempty"`
	Error  string `json:"error,omitempty"`
}

/* -------------------------------------------------------------------------- */
/*                                   书码相关                                   */
/* -------------------------------------------------------------------------- */

// SaveCode 处理书码校验与暂存
func (h *RelayHandler) SaveCode(w http.ResponseWriter, r *http.Request) {
	var codeHash, address string

	if r.Method == http.MethodGet {
		codeHash = r.URL.Query().Get("codeHash")
		address = r.URL.Query().Get("address")
	} else {
		var req struct {
			CodeHash string `json:"codeHash"`
			Address  string `json:"address"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
			codeHash = req.CodeHash
			address = req.Address
		}
	}

	codeHash = strings.ToLower(strings.TrimSpace(codeHash))
	address = strings.ToLower(strings.TrimSpace(address))

	if codeHash == "" {
		h.sendJSON(w, http.StatusBadRequest, CommonResponse{Error: "缺失书码哈希"})
		return
	}

	ctx := r.Context()
	isValid, err := h.RDB.SIsMember(ctx, "vault:codes:valid", codeHash).Result()
	if err != nil {
		h.sendJSON(w, http.StatusInternalServerError, CommonResponse{Error: "数据库异常"})
		return
	}

	if !isValid {
		h.sendJSON(w, http.StatusBadRequest, CommonResponse{
			Error: "无效二维码：可能已使用或非正版",
		})
		return
	}

	var count int64
	if address != "" {
		key := "vault:saved:" + address
		h.RDB.SAdd(ctx, key, codeHash)
		count, _ = h.RDB.SCard(ctx, key).Result()
	}

	h.sendJSON(w, http.StatusOK, map[string]interface{}{
		"ok":    true,
		"code":  codeHash,
		"count": count,
	})
}

// GetSaved 获取用户已暂存书码
func (h *RelayHandler) GetSaved(w http.ResponseWriter, r *http.Request) {
	addr := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("address")))
	if addr == "" {
		h.sendJSON(w, http.StatusBadRequest, CommonResponse{Error: "缺少 address"})
		return
	}

	codes, _ := h.RDB.SMembers(r.Context(), "vault:saved:"+addr).Result()
	h.sendJSON(w, http.StatusOK, map[string]interface{}{
		"ok":    true,
		"codes": codes,
	})
}

/* -------------------------------------------------------------------------- */
/*                                 推荐统计                                   */
/* -------------------------------------------------------------------------- */

// GetReferrerStats 获取推荐人统计（支持排行榜）
func (h *RelayHandler) GetReferrerStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	addr := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("address")))

	if addr == "" {
		stats, err := h.RDB.HGetAll(ctx, "whale_vault:referrer_stats").Result()
		if err != nil {
			h.sendJSON(w, http.StatusInternalServerError, CommonResponse{Error: "读取排行榜失败"})
			return
		}
		h.sendJSON(w, http.StatusOK, map[string]interface{}{
			"ok":   true,
			"all":  stats,
		})
		return
	}

	count, err := h.RDB.HGet(ctx, "whale_vault:referrer_stats", addr).Result()
	if err == redis.Nil {
		count = "0"
	}

	h.sendJSON(w, http.StatusOK, map[string]interface{}{
		"ok":      true,
		"address": addr,
		"count":   count,
	})
}

/* -------------------------------------------------------------------------- */
/*                                 推荐奖励                                   */
/* -------------------------------------------------------------------------- */

// Reward 执行推荐奖励（5 个 hashcode）
func (h *RelayHandler) Reward(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Referrer string   `json:"referrer"`
		Recipient string `json:"recipient"`
		Codes     []string `json:"codes"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendJSON(w, http.StatusBadRequest, CommonResponse{Error: "参数解析失败"})
		return
	}

	if len(req.Codes) != 5 {
		h.sendJSON(w, http.StatusBadRequest, CommonResponse{Error: "必须提供 5 个 hashcode"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	txHash, businessHash, err := h.RewardSvc.DispenseReward(
		ctx,
		strings.ToLower(req.Referrer),
		strings.ToLower(req.Recipient),
		req.Codes,
	)

	if err != nil {
		log.Printf("❌ 推荐奖励失败: %v", err)
		h.sendJSON(w, http.StatusInternalServerError, CommonResponse{
			Error: err.Error(),
		})
		return
	}

	h.sendJSON(w, http.StatusOK, CommonResponse{
		Ok:     true,
		TxHash: txHash,
		Status: businessHash,
	})
}

/* -------------------------------------------------------------------------- */
/*                                   工具                                    */
/* -------------------------------------------------------------------------- */

func (h *RelayHandler) sendJSON(w http.ResponseWriter, code int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(payload)
}
