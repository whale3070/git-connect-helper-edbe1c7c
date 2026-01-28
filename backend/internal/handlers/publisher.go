package handlers

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"

	// 统一使用 v9 版本，解决与 main.go 的兼容性问题
	"github.com/redis/go-redis/v9"
	"github.com/skip2/go-qrcode"
)

// PublisherHandler 封装 Redis 依赖
type PublisherHandler struct {
	RDB *redis.Client
}

// GenerateAndDownloadZip 核心逻辑：自动生成、入库并打包
func (h *PublisherHandler) GenerateAndDownloadZip(w http.ResponseWriter, r *http.Request) {
	// 1. 获取生成数量，默认 100，最大限制 500
	countStr := r.URL.Query().Get("count")
	count, _ := strconv.Atoi(countStr)
	if count <= 0 || count > 500 {
		count = 100
	}

	zipBuf := new(bytes.Buffer)
	zipWriter := zip.NewWriter(zipBuf)
	var generatedCodes []string

	// 2. 循环生成哈希和二维码
	for i := 0; i < count; i++ {
		// 生成 32 字节强随机哈希
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			http.Error(w, "随机数生成失败", http.StatusInternalServerError)
			return
		}
		code := "0x" + hex.EncodeToString(b)
		generatedCodes = append(generatedCodes, code)

		// 构造二维码链接，确保指向前端 Mint 路由
		qrUrl := fmt.Sprintf("http://198.55.109.102:5173/valut_mint_nft/%s", code)
		qrPng, err := qrcode.Encode(qrUrl, qrcode.Medium, 256)
		if err != nil {
			continue
		}

		// 将图片写入压缩包
		f, _ := zipWriter.Create(fmt.Sprintf("qr_codes/book_code_%d.png", i+1))
		f.Write(qrPng)

		// 记录对应的哈希文本
		t, _ := zipWriter.Create(fmt.Sprintf("hashes/hash_%d.txt", i+1))
		t.Write([]byte(code))
	}

	// 3. 批量入库 Redis 有效池
	// 使用 Pipeline 提高写入效率
	pipe := h.RDB.Pipeline()
	for _, c := range generatedCodes {
		pipe.SAdd(r.Context(), "vault:codes:valid", c)
	}
	_, err := pipe.Exec(r.Context())
	if err != nil {
		// 如果数据库写入失败，停止下载，防止发放无效码
		http.Error(w, "Redis 写入失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 4. 关闭 zipWriter 并输出流
	zipWriter.Close()
	
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=WhaleVault_Codes_%d.zip", count))
	w.Write(zipBuf.Bytes())
}
