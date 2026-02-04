package handlers

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/redis/go-redis/v9"
	"github.com/skip2/go-qrcode"
)

// PublisherHandler 封装 Redis 和 Ethereum 客户端
type PublisherHandler struct {
	RDB         *redis.Client
	Client      *ethclient.Client
	FactoryAddr string // 工厂合约地址（已不在本文件中用于部署，但保留字段避免其它代码改动）

	// cache RediSearch schema to avoid guessing TAG/TEXT types
	ftSchemaOnce sync.Once
	ftSchema     map[string]string // field -> TYPE (TAG/TEXT/NUMERIC/etc)
	ftSchemaErr  error
}

// -----------------------------
// 1️⃣ 生成兑换码 ZIP（读者专用二维码）
// -----------------------------
func (h *PublisherHandler) GenerateAndDownloadZip(w http.ResponseWriter, r *http.Request) {
	countStr := r.URL.Query().Get("count")
	count, _ := strconv.Atoi(countStr)
	if count <= 0 || count > 500 {
		count = 100
	}

	// ✅ 可选：绑定 book_id（32 bytes），用于让每个兑换码/二维码对应某一本书（业务ID，不是合约地址）
	bookID := strings.TrimSpace(r.URL.Query().Get("book_id"))
	if bookID != "" && !isHexBytesN(bookID, 32) {
		http.Error(w, "book_id 格式不正确：需要 0x+64(hex)", http.StatusBadRequest)
		return
	}
	bookID = strings.ToLower(bookID)

	zipBuf := new(bytes.Buffer)
	zipWriter := zip.NewWriter(zipBuf)
	var generatedCodes []string

	for i := 0; i < count; i++ {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			http.Error(w, "随机数生成失败", http.StatusInternalServerError)
			return
		}
		code := "0x" + hex.EncodeToString(b)
		generatedCodes = append(generatedCodes, code)

		qrUrl := fmt.Sprintf("http://whale3070.com/valut_mint_nft/%s", code)
		if bookID != "" {
			qrUrl = qrUrl + "?book_id=" + bookID
		}

		qrPng, _ := qrcode.Encode(qrUrl, qrcode.Medium, 256)

		f, _ := zipWriter.Create(fmt.Sprintf("qr_codes/book_code_%d.png", i+1))
		_, _ = f.Write(qrPng)

		t, _ := zipWriter.Create(fmt.Sprintf("hashes/hash_%d.txt", i+1))
		_, _ = t.Write([]byte(code))
	}

	// 写入 Redis：读者码有效集合 + 可选 book_id 绑定
	ctx := r.Context()
	pipe := h.RDB.Pipeline()
	for _, c := range generatedCodes {
		pipe.SAdd(ctx, "vault:codes:valid", c)
		if bookID != "" {
			// code -> book_id 的映射
			pipe.HSet(ctx, "vault:codes:book_id", c, bookID)
			// 也可以按 book_id 聚合一份，方便后续统计/作废
			pipe.SAdd(ctx, "vault:codes:by_book_id:"+bookID, c)
		}
	}

	if _, err := pipe.Exec(ctx); err != nil {
		http.Error(w, "Redis 写入失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	_ = zipWriter.Close()
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=WhaleVault_Codes_%d.zip", count))
	_, _ = w.Write(zipBuf.Bytes())
}

// -----------------------------
// 2️⃣ 删除“部署书籍合约”逻辑后的兼容入口
// -----------------------------
//
// 你当前 main.go 仍绑定了：
// - /api/v1/factory/create        -> publisherH.CreateBook
// - /api/v1/publisher/create-book -> publisherH.CreateBook
//
// 为避免你删掉方法后编译失败，这里保留 CreateBook，但明确返回 410，提示走新的部署路由。
// ✅ 你已经把 /api/v1/publisher/deploy-book 指向 factoryH.DeployBook，所以部署仍然可用。
func (h *PublisherHandler) CreateBook(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusGone)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":    false,
		"error": "publisher.CreateBook 已废弃：请改用 /api/v1/publisher/deploy-book（当前由 FactoryHandler 处理）",
	})
}

// indexDeployedBook writes a fast index for publisher -> books (ZSET) and per-book meta (HASH).
// ✅ 部署逻辑已移出本文件，但索引函数可保留，供未来“从链上事件同步/其他模块写入”复用。
func (h *PublisherHandler) indexDeployedBook(ctx context.Context, publisherLower, bookAddrLower string, reqName, reqSymbol, reqAuthor, reqSerial, txHash string) {
	zkey := "vault:publisher:books:z:" + publisherLower
	_ = h.RDB.ZAdd(ctx, zkey, redis.Z{
		Score:  float64(time.Now().Unix()),
		Member: bookAddrLower,
	}).Err()

	mkey := "vault:book:meta:" + bookAddrLower
	_ = h.RDB.HSet(ctx, mkey, map[string]interface{}{
		"name":      reqName,
		"symbol":    reqSymbol,
		"author":    reqAuthor,
		"serial":    reqSerial,
		"publisher": publisherLower,
		"txHash":    txHash,
		"createdAt": time.Now().Unix(),
	}).Err()
}

type PublisherBookItem struct {
	BookAddr  string `json:"bookAddr"`
	Name      string `json:"name,omitempty"`
	Symbol    string `json:"symbol,omitempty"`
	Author    string `json:"author,omitempty"`
	Serial    string `json:"serial,omitempty"`
	Publisher string `json:"publisher,omitempty"`
	TxHash    string `json:"txHash,omitempty"`
	CreatedAt int64  `json:"createdAt,omitempty"`
}

// GetPublisherBooks
// GET /api/v1/publisher/books?publisher=0x...&offset=0&limit=50
func (h *PublisherHandler) GetPublisherBooks(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	publisher := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("publisher")))
	if publisher == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": false, "error": "publisher is required"})
		return
	}
	if !common.IsHexAddress(publisher) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": false, "error": "publisher format invalid"})
		return
	}

	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	ctx := r.Context()
	zkey := "vault:publisher:books:z:" + publisher

	total, err := h.RDB.ZCard(ctx, zkey).Result()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}
	if total == 0 {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"ok": true, "publisher": publisher, "total": 0, "items": []PublisherBookItem{},
		})
		return
	}

	start := int64(offset)
	stop := int64(offset + limit - 1)
	addrs, err := h.RDB.ZRevRange(ctx, zkey, start, stop).Result()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}

	pipe := h.RDB.Pipeline()
	cmds := make([]*redis.MapStringStringCmd, 0, len(addrs))
	for _, a := range addrs {
		cmds = append(cmds, pipe.HGetAll(ctx, "vault:book:meta:"+strings.ToLower(a)))
	}
	_, _ = pipe.Exec(ctx)

	items := make([]PublisherBookItem, 0, len(addrs))
	for i, a := range addrs {
		meta := map[string]string{}
		if i < len(cmds) {
			meta = cmds[i].Val()
		}
		it := PublisherBookItem{
			BookAddr:  strings.ToLower(a),
			Name:      meta["name"],
			Symbol:    meta["symbol"],
			Author:    meta["author"],
			Serial:    meta["serial"],
			Publisher: meta["publisher"],
			TxHash:    meta["txHash"],
		}
		if v := meta["createdAt"]; v != "" {
			if n, err := strconv.ParseInt(v, 10, 64); err == nil {
				it.CreatedAt = n
			}
		}
		items = append(items, it)
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"ok": true, "publisher": publisher, "total": total, "items": items,
	})
}

// -----------------------------
// ✅ RediSearch schema-aware query builder (no more Syntax error)
// -----------------------------

// normalizeFTText: 只保留字母/数字/_；其他字符一律转成空格并压缩空格。
// 用于 TEXT 查询，保证永远不会把 RediSearch parser 炸掉。
func normalizeFTText(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	var b strings.Builder
	lastSpace := false
	for _, r := range s {
		// 允许：字母/数字/_/以及所有非ASCII字符（中文等）
		if r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r) || r > 127 {
			b.WriteRune(r)
			lastSpace = false
			continue
		}

		// 其余全部转空格，避免炸 RediSearch parser（例如: (){}[]|@:" 等）
		if !lastSpace {
			b.WriteByte(' ')
			lastSpace = true
		}
	}
	out := strings.TrimSpace(b.String())
	out = strings.Join(strings.Fields(out), " ")
	return out
}

// normalizeFTTag: TAG 值只保留字母/数字/_；其余全部移除。
func normalizeFTTag(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range s {
		if r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func (h *PublisherHandler) loadFTSchemaOnce(ctx context.Context) {
	h.ftSchemaOnce.Do(func() {
		h.ftSchema = map[string]string{}

		res, err := h.RDB.Do(ctx, "FT.INFO", "idx:books").Result()
		if err != nil {
			h.ftSchemaErr = err
			return
		}

		// FT.INFO returns alternating key/value array
		top, ok := res.([]interface{})
		if !ok {
			return
		}
		var attrs interface{}
		for i := 0; i+1 < len(top); i += 2 {
			k, _ := top[i].(string)
			if k == "attributes" {
				attrs = top[i+1]
				break
			}
		}
		alist, ok := attrs.([]interface{})
		if !ok {
			return
		}
		for _, a := range alist {
			entry, ok := a.([]interface{})
			if !ok {
				continue
			}
			var fieldName, fieldType string
			for j := 0; j+1 < len(entry); j += 2 {
				kk, _ := entry[j].(string)
				switch kk {
				case "attribute", "identifier":
					if fieldName == "" {
						if vv, ok := entry[j+1].(string); ok {
							fieldName = vv
						}
					}
				case "type":
					if vv, ok := entry[j+1].(string); ok {
						fieldType = strings.ToUpper(vv)
					}
				}
			}
			if fieldName != "" && fieldType != "" {
				h.ftSchema[fieldName] = fieldType
			}
		}
	})
}

func (h *PublisherHandler) fieldType(ctx context.Context, field string, fallback string) string {
	h.loadFTSchemaOnce(ctx)
	if t, ok := h.ftSchema[field]; ok && t != "" {
		return t
	}
	return fallback
}

// SearchPublisherBooks
func (h *PublisherHandler) SearchPublisherBooks(w http.ResponseWriter, r *http.Request) {
	debug := r.URL.Query().Get("debug") == "1"

	w.Header().Set("Content-Type", "application/json")
	ctx := r.Context()

	publisher := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("publisher")))
	qRaw := strings.TrimSpace(r.URL.Query().Get("q"))

	if publisher == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": false, "error": "publisher is required"})
		return
	}
	if !common.IsHexAddress(publisher) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": false, "error": "publisher format invalid"})
		return
	}

	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}

	qText := normalizeFTText(qRaw)
	qTag := normalizeFTTag(qRaw)

	if len([]rune(qText)) < 2 && len([]rune(qTag)) < 2 {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":        true,
			"publisher": publisher,
			"q":         qRaw,
			"total":     0,
			"items":     []map[string]interface{}{},
		})
		return
	}

	// TEXT expr: t1* t2*
	var textExpr string
	if qText != "" {
		toks := strings.Fields(qText)
		parts := make([]string, 0, len(toks))
		for _, t := range toks {
			parts = append(parts, t+"*")
		}
		textExpr = strings.Join(parts, " ")
	}

	// Determine field types from FT.INFO (fallbacks match your comment schema)
	pubType := h.fieldType(ctx, "publisher", "TAG")
	nameType := h.fieldType(ctx, "name", "TEXT")
	authorType := h.fieldType(ctx, "author", "TEXT")
	symbolType := h.fieldType(ctx, "symbol", "TAG")
	serialType := h.fieldType(ctx, "serial", "TAG")

	buildField := func(field string, fType string, textExpr string, tagVal string) (string, bool) {
		t := strings.ToUpper(fType)
		switch t {
		case "TAG":
			if tagVal == "" {
				return "", false
			}
			return fmt.Sprintf("(@%s:{%s*})", field, tagVal), true
		case "TEXT":
			if textExpr == "" {
				return "", false
			}
			return fmt.Sprintf("(@%s:(%s))", field, textExpr), true
		case "NUMERIC":
			if tagVal == "" {
				return "", false
			}
			if !isAllDigits(tagVal) {
				return "", false
			}
			return fmt.Sprintf("(@%s:[%s %s])", field, tagVal, tagVal), true
		default:
			if textExpr == "" {
				return "", false
			}
			return fmt.Sprintf("(@%s:(%s))", field, textExpr), true
		}
	}

	innerParts := make([]string, 0, 6)

	if textExpr != "" {
		if clause, ok := buildField("name", nameType, textExpr, qTag); ok {
			innerParts = append(innerParts, clause)
		} else {
			innerParts = append(innerParts, fmt.Sprintf("(@name:(%s))", textExpr))
		}
		if clause, ok := buildField("author", authorType, textExpr, qTag); ok {
			innerParts = append(innerParts, clause)
		} else {
			innerParts = append(innerParts, fmt.Sprintf("(@author:(%s))", textExpr))
		}
	}

	if clause, ok := buildField("symbol", symbolType, textExpr, qTag); ok {
		innerParts = append(innerParts, clause)
	}
	if clause, ok := buildField("serial", serialType, textExpr, qTag); ok {
		innerParts = append(innerParts, clause)
	}

	if len(innerParts) == 0 {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":        true,
			"publisher": publisher,
			"q":         qRaw,
			"total":     0,
			"items":     []map[string]interface{}{},
		})
		return
	}

	inner := strings.Join(innerParts, " | ")

	var pubClause string
	if strings.ToUpper(pubType) == "TAG" {
		pubClause = fmt.Sprintf("@publisher:{%s}", publisher)
	} else {
		pubClause = fmt.Sprintf("@publisher:(%s)", publisher)
	}

	query := fmt.Sprintf("%s ( %s )", pubClause, inner)

	// 只有 debug=1 才做全量查询/回传 debug 字段（避免泄漏 & 降低开销）
	var (
		allResType string
		allTotal   int64
		allErrStr  string
	)
	if debug {
		allRes, allErr := h.RDB.Do(ctx,
			"FT.SEARCH", "idx:books", "*",
			"LIMIT", 0, 1,
		).Result()
		allResType = fmt.Sprintf("%T", allRes)
		allTotal, _, _ = parseFTSearchResult(allRes)
		if allErr != nil {
			allErrStr = allErr.Error()
		}
	}

	res, err := h.RDB.Do(ctx,
		"FT.SEARCH", "idx:books", query,
		"SORTBY", "createdAt", "DESC",
		"LIMIT", offset, limit,
		"RETURN", "7", "name", "author", "symbol", "serial", "publisher", "createdAt", "txHash",
	).Result()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		out := map[string]interface{}{
			"ok":    false,
			"error": err.Error(),
			"query": query,
		}
		if debug {
			if h.ftSchemaErr != nil {
				out["schemaError"] = h.ftSchemaErr.Error()
			} else if len(h.ftSchema) > 0 {
				out["schema"] = h.ftSchema
			}
		}
		_ = json.NewEncoder(w).Encode(out)
		return
	}

	total, items, parseErr := parseFTSearchResult(res)
	if parseErr != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": false, "error": parseErr.Error()})
		return
	}

	out := map[string]interface{}{
		"ok":        true,
		"publisher": publisher,
		"q":         qRaw,
		"total":     total,
		"items":     items,
	}

	if debug {
		out["debugQuery"] = query
		out["debugQText"] = qText
		out["debugQTag"] = qTag
		out["debugTextExpr"] = textExpr
		out["debugAllTotal"] = allTotal
		out["debugAllErr"] = allErrStr
		out["debugAllResType"] = allResType
	}

	_ = json.NewEncoder(w).Encode(out)
}

func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// parseFTSearchResult parses FT.SEARCH result:
// [total, docId1, [field, value, ...], docId2, [field, value, ...], ...]
func parseFTSearchResult(res interface{}) (int64, []map[string]interface{}, error) {
	arr, ok := res.([]interface{})
	if !ok || len(arr) == 0 {
		return 0, []map[string]interface{}{}, nil
	}

	var total int64
	switch v := arr[0].(type) {
	case int64:
		total = v
	case int:
		total = int64(v)
	case string:
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			total = n
		}
	}

	items := make([]map[string]interface{}, 0)
	for i := 1; i+1 < len(arr); i += 2 {
		docID, _ := arr[i].(string)
		fields := arr[i+1]

		item := map[string]interface{}{}
		if strings.HasPrefix(docID, "vault:book:meta:") {
			item["bookAddr"] = strings.TrimPrefix(docID, "vault:book:meta:")
		} else {
			item["bookAddr"] = docID
		}

		if kv, ok := fields.([]interface{}); ok {
			for j := 0; j+1 < len(kv); j += 2 {
				k, _ := kv[j].(string)
				v := kv[j+1]
				switch vv := v.(type) {
				case []byte:
					item[k] = string(vv)
				default:
					item[k] = vv
				}
			}
		}
		items = append(items, item)
	}

	return total, items, nil
}

// isHexBytesN checks 0x-prefixed hex string with exact N bytes.
func isHexBytesN(s string, n int) bool {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "0x")
	if len(s) != n*2 {
		return false
	}
	_, err := hex.DecodeString(s)
	return err == nil
}
