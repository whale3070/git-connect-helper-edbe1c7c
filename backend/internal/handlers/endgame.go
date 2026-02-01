package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
	"strconv"
	"github.com/redis/go-redis/v9"
)

type EndGameHandler struct {
	RDB          *redis.Client
	ContractAddr string // 自动加载 .env 中的 EndGame_ADDR
	RPCUrl       string
	PrivateKey   string
}

// executeCast 封装命令行工具 cast，执行链上交互
func (h *EndGameHandler) executeCast(args ...string) (string, error) {
	// 基础参数：send, 合约地址, 函数名... --rpc-url ... --private-key ... --legacy
	baseArgs := append([]string{"send", h.ContractAddr}, args...)
	baseArgs = append(baseArgs, "--rpc-url", h.RPCUrl, "--private-key", h.PrivateKey, "--legacy")

	cmd := exec.Command("cast", baseArgs...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("cast 失败: %v, 输出: %s", err, string(out))
	}
	return strings.TrimSpace(string(out)), nil
}

// Bet 处理押注逻辑 (读者通过中继器代付)
func (h *EndGameHandler) Bet(w http.ResponseWriter, r *http.Request) {
	userAddr := r.URL.Query().Get("user")
	bookAddr := r.URL.Query().Get("book")

	if userAddr == "" || bookAddr == "" {
		http.Error(w, "缺少必要参数: user 或 book", 400)
		return
	}

	// 1. 全量合规校验：排除所有不在金库系统内的“野合约”
	exists, err := h.RDB.SIsMember(r.Context(), "vault:all_books", bookAddr).Result()
	if err != nil {
		http.Error(w, "Redis 读取书籍库异常", 500)
		return
	}
	if !exists {
		// 你的预判：排除了错误选项，剩下的才是正版书籍
		http.Error(w, "校验失败：该书籍地址不在合规白名单中", 403)
		return
	}

	// 2. 社交裂变检查：从 Redis 获取 5 人门槛数据
	countStr, err := h.RDB.HGet(r.Context(), "referrer:stats:"+userAddr, "total_referred").Result()
	if err != nil && err != redis.Nil {
		http.Error(w, "Redis 读取用户状态异常", 500)
		return
	}
	
	count, _ := strconv.Atoi(countStr)
	if count < 5 {
		// 善良者的困局：没达到 5 人裂变无法开启博弈
		http.Error(w, fmt.Sprintf("裂变人数不足: 当前 %d/5", count), 403)
		return
	}

	// 3. 调用 2.0 合约：placeBet(address _reader, address _book)
	// 这里传递两个参数，合约内部会记录 userAddr，消耗的是 PrivateKey 对应的 Gas
	txHash, err := h.executeCast("placeBet(address,address)", userAddr, bookAddr)
	if err != nil {
		// 这里会捕捉到合约层抛出的错误（如 Betting phase ended 或 Already bet）
		http.Error(w, "链上合约拒绝执行: "+err.Error(), 500)
		return
	}

	// 返回成功信息及交易哈希，方便前端展示
	json.NewEncoder(w).Encode(map[string]string{
		"status": "bet_success",
		"tx":     txHash,
		"msg":    "预判成功！你的 10 天博弈之旅已开启。",
	})
}

// Challenge 处理挑战逻辑 (第 10 天，由挑战者支付 1 CFX)
func (h *EndGameHandler) Challenge(w http.ResponseWriter, r *http.Request) {
	bookAddr := r.URL.Query().Get("book")
	if bookAddr == "" {
		http.Error(w, "缺少 book 参数", 400)
		return
	}

	// 调用 challenge(address) 并在命令行带上 --value 1ether (即 1 CFX)
	txHash, err := h.executeCast("challenge(address)", bookAddr, "--value", "1ether")
	if err != nil {
		http.Error(w, "挑战执行失败: "+err.Error(), 500)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{
		"status": "challenge_success",
		"tx":     txHash,
	})
}

// Settle 触发一轮结束与结算
func (h *EndGameHandler) Settle(w http.ResponseWriter, r *http.Request) {
	// 没有任何参数，直接调用 claimAndRestart()
	txHash, err := h.executeCast("claimAndRestart()")
	if err != nil {
		http.Error(w, "结算执行失败: "+err.Error(), 500)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{
		"status": "settled",
		"tx":     txHash,
	})
}