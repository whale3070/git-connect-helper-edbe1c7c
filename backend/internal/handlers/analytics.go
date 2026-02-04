package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// 必须定义一个 package 内部使用的 ctx
var analyticsCtx = context.Background()

// 给 IP 查询加超时，避免 goroutine 堆积卡死
var ipHTTPClient = &http.Client{
	Timeout: 2 * time.Second,
}

type IPInfo struct {
	Status string  `json:"status"` // ip-api 会返回 success/fail
	Lat    float64 `json:"lat"`
	Lon    float64 `json:"lon"`
	City   string  `json:"city"`
	// 你也可以加 country / region / query 等字段，但你现在只用到 city/lat/lon
}

type MapNode struct {
	Name  string    `json:"name"`
	Value []float64 `json:"value"` // [lng, lat, count]
}

// 注意：这里的 (h *RelayHandler) 必须完全匹配你的 RelayHandler 结构体名
func (h *RelayHandler) GetDistribution(w http.ResponseWriter, r *http.Request) {
	// CORS（如果你有统一 middleware，这里可以省）
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	var data []MapNode

	// 1) 读取旧格式数据: vault:analytics:locations
	// 格式: "城市|经度,纬度" -> count
	res, err := h.RDB.HGetAll(r.Context(), "vault:analytics:locations").Result()
	if err == nil {
		for key, countStr := range res {
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
	}

	// 2) 读取新格式数据: vault:heatmap:locations
	// 格式: "城市_国家" -> "经度,纬度,计数"
	newRes, err := h.RDB.HGetAll(r.Context(), "vault:heatmap:locations").Result()
	if err == nil {
		for key, value := range newRes {
			parts := strings.Split(value, ",")
			if len(parts) < 3 {
				continue
			}
			lng, _ := strconv.ParseFloat(parts[0], 64)
			lat, _ := strconv.ParseFloat(parts[1], 64)
			cnt, _ := strconv.ParseFloat(parts[2], 64)

			// 城市名从 key 提取 (格式: "城市_国家")
			cityName := strings.Split(key, "_")[0]
			if cityName == "" {
				cityName = key
			}

			data = append(data, MapNode{
				Name:  cityName,
				Value: []float64{lng, lat, cnt},
			})
		}
	}

	if data == nil {
		data = []MapNode{}
	}
	_ = json.NewEncoder(w).Encode(data)
}

// CaptureEcho：捕获一次“读者行为/回响”并按 IP 统计地理位置
func (h *RelayHandler) CaptureEcho(ip string) {
	go func(userIP string) {
		// 本地/空 IP 直接忽略
		if userIP == "" || userIP == "127.0.0.1" || userIP == "::1" {
			return
		}

		// ip-api：建议用 https，避免某些环境 http 被拦
		url := "https://ip-api.com/json/" + userIP + "?fields=status,city,lat,lon"
		resp, err := ipHTTPClient.Get(url)
		if err != nil {
			return
		}
		defer resp.Body.Close()

		var info IPInfo
		if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
			return
		}
		if info.Status != "success" {
			return
		}
		// city 为空也没关系，给个兜底
		city := strings.TrimSpace(info.City)
		if city == "" {
			city = "Unknown"
		}

		// --- 旧格式写入（保持兼容）---
		locationKeyOld := fmt.Sprintf("%s|%f,%f", city, info.Lon, info.Lat)
		_ = h.RDB.HIncrBy(analyticsCtx, "vault:analytics:locations", locationKeyOld, 1).Err()

		// --- 新格式写入（你 GetDistribution 在读这个）---
		// 你现在 new key 的 field 是 "城市_国家"，但你没取 country，所以先用城市做 field
		// value 结构: "lng,lat,count"
		field := fmt.Sprintf("%s_%s", city, "NA")
		val, err := h.RDB.HGet(analyticsCtx, "vault:heatmap:locations", field).Result()
		if err != nil {
			// 不存在就写 1
			newVal := fmt.Sprintf("%f,%f,%d", info.Lon, info.Lat, 1)
			_ = h.RDB.HSet(analyticsCtx, "vault:heatmap:locations", field, newVal).Err()
			return
		}

		parts := strings.Split(val, ",")
		if len(parts) >= 3 {
			oldCnt, _ := strconv.Atoi(strings.TrimSpace(parts[2]))
			newCnt := oldCnt + 1
			newVal := fmt.Sprintf("%f,%f,%d", info.Lon, info.Lat, newCnt)
			_ = h.RDB.HSet(analyticsCtx, "vault:heatmap:locations", field, newVal).Err()
		} else {
			// 格式坏了就重置
			newVal := fmt.Sprintf("%f,%f,%d", info.Lon, info.Lat, 1)
			_ = h.RDB.HSet(analyticsCtx, "vault:heatmap:locations", field, newVal).Err()
		}
	}(ip)
}
