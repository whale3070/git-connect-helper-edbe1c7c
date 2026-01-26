package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

// IPInfo 用于解析第三方地理定位 API 的响应 [cite: 2026-01-16]
type IPInfo struct {
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
	City string  `json:"city"`
}

// MapNode 对应前端 Heatmap.tsx 所需的数据结构
type MapNode struct {
	Name  string    `json:"name"`
	Value []float64 `json:"value"` // 格式: [经度, 纬度, 权重/次数]
}

// GetDistribution 获取全球读者的地理分布回响数据
func (h *RelayHandler) GetDistribution(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	// 从 Redis Hash "vault:analytics:locations" 中读取数据
	res, err := h.RDB.HGetAll(r.Context(), "vault:analytics:locations").Result()
	if err != nil {
		json.NewEncoder(w).Encode([]MapNode{})
		return
	}

	var data []MapNode
	for key, countStr := range res {
		// key 格式约定为: "CityName|lng,lat"
		parts := strings.Split(key, "|")
		if len(parts) < 2 {
			continue
		}

		coords := strings.Split(parts[1], ",")
		if len(coords) < 2 {
			continue
		}

		lng, _ := strconv.ParseFloat(coords[0], 64)
		lat, _ := strconv.ParseFloat(coords[1], 64)
		cnt, _ := strconv.ParseFloat(countStr, 64)

		data = append(data, MapNode{
			Name:  parts[0],
			Value: []float64{lng, lat, cnt},
		})
	}

	// 确保即使没数据也返回空数组 [] 而不是 null
	if data == nil {
		data = []MapNode{}
	}

	json.NewEncoder(w).Encode(data)
}

// CaptureEcho 异步捕获读者的 IP 并转换成地理回响存入 Redis [cite: 2026-01-16]
func (h *RelayHandler) CaptureEcho(ip string) {
	// 使用协程异步处理，不阻塞 Mint 交易响应
	go func(userIP string) {
		// 过滤本地回环地址
		if userIP == "127.0.0.1" || userIP == "::1" {
			return
		}

		// 调用 ip-api.com 获取位置 (免费版)
		resp, err := http.Get("http://ip-api.com/json/" + userIP + "?fields=status,city,lat,lon")
		if err != nil {
			return
		}
		defer resp.Body.Close()

		var info IPInfo
		if err := json.NewDecoder(resp.Body).Decode(&info); err == nil && info.Lat != 0 {
			// 存储格式: "城市|经度,纬度"
			locationKey := fmt.Sprintf("%s|%f,%f", info.City, info.Lon, info.Lat)
			// 在 Redis 中累加该位置的回响次数
			h.RDB.HIncrBy(ctx, "vault:analytics:locations", locationKey, 1)
		}
	}(ip)
}
