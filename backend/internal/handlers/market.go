package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/redis/go-redis/v9"
)

type MarketHandler struct {
	RDB *redis.Client
}

// BookMeta 定义书籍的元数据结构
type BookMeta struct {
	Symbol     string            `json:"symbol"`
	Name       map[string]string `json:"name"`   // 支持多语言
	Author     map[string]string `json:"author"`
	Address    string            `json:"address"`
	Sales      int64             `json:"sales"`
	Change     string            `json:"change"`
	Publisher  string            `json:"publisher,omitempty"`
	DeployedAt int64             `json:"deployedAt,omitempty"`
}

// GetTickers 获取海量书籍大盘（支持分页）
func (h *MarketHandler) GetTickers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// 1. 获取分页参数
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	pageSize := int64(50)
	start := int64(page-1) * pageSize
	stop := start + pageSize - 1

	// 设置响应头
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// 2. 尝试从 Redis ZSet 获取按销量排名的书籍
	addresses, err := h.RDB.ZRevRange(ctx, "vault:tickers:sales", start, stop).Result()
	if err != nil {
		// Redis 错误时返回空数组而非500
		json.NewEncoder(w).Encode([]BookMeta{})
		return
	}

	// 如果 ZSet 为空，尝试从 registry Hash 获取所有书籍
	if len(addresses) == 0 {
		addresses = h.getAllBookAddresses(ctx)
	}

	// 3. 批量获取书籍详情
	var result []BookMeta
	for _, addr := range addresses {
		book := h.getBookDetail(ctx, addr)
		if book != nil {
			result = append(result, *book)
		}
	}

	// 如果仍然没有数据，返回模拟数据（开发阶段）
	if len(result) == 0 {
		result = h.getMockData()
	}

	json.NewEncoder(w).Encode(result)
}

// getAllBookAddresses 从 registry 获取所有书籍地址
func (h *MarketHandler) getAllBookAddresses(ctx context.Context) []string {
	// 从 vault:books:registry 获取所有 key
	data, err := h.RDB.HGetAll(ctx, "vault:books:registry").Result()
	if err != nil {
		return nil
	}
	
	addresses := make([]string, 0, len(data))
	for addr := range data {
		addresses = append(addresses, addr)
	}
	return addresses
}

// getBookDetail 获取单本书籍详情
func (h *MarketHandler) getBookDetail(ctx context.Context, addr string) *BookMeta {
	// 从 registry 获取基本信息
	data, err := h.RDB.HGet(ctx, "vault:books:registry", addr).Result()
	if err != nil || data == "" {
		return nil
	}

	// 尝试解析 JSON 格式
	var book BookMeta
	if err := json.Unmarshal([]byte(data), &book); err == nil {
		book.Address = addr
		// 获取销量
		if sales, err := h.RDB.ZScore(ctx, "vault:tickers:sales", addr).Result(); err == nil {
			book.Sales = int64(sales)
		}
		return &book
	}

	// 兼容旧格式 "Symbol:BookName:Author"
	parts := strings.Split(data, ":")
	if len(parts) >= 2 {
		return &BookMeta{
			Symbol:  parts[0],
			Name:    map[string]string{"zh": parts[1], "en": parts[1]},
			Author:  map[string]string{"zh": getOrDefault(parts, 2, "未知"), "en": getOrDefault(parts, 2, "Unknown")},
			Address: addr,
			Sales:   0,
			Change:  "+0%",
		}
	}

	return nil
}

// getMockData 返回开发阶段的模拟数据
func (h *MarketHandler) getMockData() []BookMeta {
	return []BookMeta{
		{
			Symbol:  "WHALE",
			Name:    map[string]string{"zh": "鲸鱼传奇", "en": "Whale Legend"},
			Author:  map[string]string{"zh": "深海作者", "en": "Deep Sea Author"},
			Address: "0x0000000000000000000000000000000000000001",
			Sales:   1234,
			Change:  "+12.5%",
		},
		{
			Symbol:  "VAULT",
			Name:    map[string]string{"zh": "金库密码", "en": "Vault Code"},
			Author:  map[string]string{"zh": "神秘作家", "en": "Mystery Writer"},
			Address: "0x0000000000000000000000000000000000000002",
			Sales:   856,
			Change:  "+8.2%",
		},
		{
			Symbol:  "NFT01",
			Name:    map[string]string{"zh": "区块链入门", "en": "Blockchain Basics"},
			Author:  map[string]string{"zh": "技术大牛", "en": "Tech Guru"},
			Address: "0x0000000000000000000000000000000000000003",
			Sales:   567,
			Change:  "-2.1%",
		},
	}
}

// getOrDefault 安全获取数组元素
func getOrDefault(arr []string, idx int, def string) string {
	if idx < len(arr) && arr[idx] != "" {
		return arr[idx]
	}
	return def
}
