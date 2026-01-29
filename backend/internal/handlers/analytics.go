package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"context"
)

// 必须定义一个 package 内部使用的 ctx
var analyticsCtx = context.Background()

type IPInfo struct {
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
	City string  `json:"city"`
}

type MapNode struct {
	Name  string    `json:"name"`
	Value []float64 `json:"value"`
}

// 注意：这里的 (h *RelayHandler) 必须完全匹配你的 RelayHandler 结构体名
func (h *RelayHandler) GetDistribution(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")

	// 从两个数据源读取: vault:analytics:locations (旧) 和 vault:heatmap:locations (新)
	var data []MapNode
	
	// 1. 读取旧格式数据
	res, err := h.RDB.HGetAll(r.Context(), "vault:analytics:locations").Result()
	if err == nil {
		for key, countStr := range res {
			parts := strings.Split(key, "|")
			if len(parts) < 2 { continue }
			coords := strings.Split(parts[1], ",")
			lng, _ := strconv.ParseFloat(coords[0], 64)
			lat, _ := strconv.ParseFloat(coords[1], 64)
			cnt, _ := strconv.ParseFloat(countStr, 64)

			data = append(data, MapNode{
				Name:  parts[0],
				Value: []float64{lng, lat, cnt},
			})
		}
	}

	// 2. 读取新格式数据 (vault:heatmap:locations)
	// 格式: "城市_国家" -> "经度,纬度,计数"
	newRes, err := h.RDB.HGetAll(r.Context(), "vault:heatmap:locations").Result()
	if err == nil {
		for key, value := range newRes {
			parts := strings.Split(value, ",")
			if len(parts) < 3 { continue }
			lng, _ := strconv.ParseFloat(parts[0], 64)
			lat, _ := strconv.ParseFloat(parts[1], 64)
			cnt, _ := strconv.ParseFloat(parts[2], 64)
			
			// 城市名从 key 提取 (格式: "城市_国家")
			cityName := strings.Split(key, "_")[0]
			if cityName == "" { cityName = key }

			data = append(data, MapNode{
				Name:  cityName,
				Value: []float64{lng, lat, cnt},
			})
		}
	}

	if data == nil { data = []MapNode{} }
	json.NewEncoder(w).Encode(data)
}

func (h *RelayHandler) CaptureEcho(ip string) {
	go func(userIP string) {
		if userIP == "127.0.0.1" || userIP == "::1" || userIP == "" { return }
		resp, err := http.Get("http://ip-api.com/json/" + userIP + "?fields=status,city,lat,lon")
		if err != nil { return }
		defer resp.Body.Close()

		var info IPInfo
		if err := json.NewDecoder(resp.Body).Decode(&info); err == nil && info.Lat != 0 {
			locationKey := fmt.Sprintf("%s|%f,%f", info.City, info.Lon, info.Lat)
			// 使用 analyticsCtx
			h.RDB.HIncrBy(analyticsCtx, "vault:analytics:locations", locationKey, 1)
		}
	}(ip)
}
