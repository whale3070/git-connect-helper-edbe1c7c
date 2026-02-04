package blockchain

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/big"
	"os/exec"
	"strings"
)

type USDTClient struct {
	Contract string // MockUSDT 合约地址
	RPC      string // RPC URL
	PrivKey  string // 私钥
	Decimals int64  // 6
}

// NewUSDTClient 构造函数
func NewUSDTClient(contract, rpc, privKey string) *USDTClient {
	return &USDTClient{
		Contract: contract,
		RPC:      rpc,
		PrivKey:  privKey,
		Decimals: 6,
	}
}

type castSendJSON struct {
	TransactionHash string `json:"transactionHash"`
	TransactionHash2 string `json:"transaction_hash"`
}

// Recharge 给出版社充值 USDT（人类单位，比如 10000）
// ⚠️ amountHuman 是“人类单位”，会按 decimals 转为最小单位
func (c *USDTClient) Recharge(to string, amountHuman int64) (string, error) {
	to = strings.TrimSpace(to)
	if !strings.HasPrefix(to, "0x") || len(to) != 42 {
		return "", fmt.Errorf("invalid to address: %s", to)
	}

	// amountRaw = amountHuman * 10^decimals （用 big.Int 防溢出）
	amountRaw := big.NewInt(amountHuman)
	mul := new(big.Int).Exp(big.NewInt(10), big.NewInt(c.Decimals), nil)
	amountRaw.Mul(amountRaw, mul)

	cmd := exec.Command(
		"cast",
		"send",
		c.Contract,
		"transfer(address,uint256)",
		to,
		amountRaw.String(),
		"--rpc-url", c.RPC,
		"--private-key", c.PrivKey,
		"--json",
	)

	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		// stderr 里通常有 revert / insufficient balance 等关键字
		return "", fmt.Errorf("cast send failed: %s", strings.TrimSpace(stderr.String()))
	}

	raw := strings.TrimSpace(out.String())
	if raw == "" {
		return "", fmt.Errorf("cast send returned empty output")
	}

	// 优先 JSON 解析
	var j castSendJSON
	if err := json.Unmarshal([]byte(raw), &j); err == nil {
		tx := strings.TrimSpace(j.TransactionHash)
		if tx == "" {
			tx = strings.TrimSpace(j.TransactionHash2)
		}
		if isHexTxHash(tx) {
			return tx, nil
		}
		return "", fmt.Errorf("cast json parsed but txHash invalid: %s", raw)
	}

	// 兜底：兼容少数版本输出里直接出现 0x...hash
	// 找到第一个 0x + 64 hex
	fields := strings.Fields(raw)
	for _, f := range fields {
		if isHexTxHash(f) {
			return f, nil
		}
	}

	return "", fmt.Errorf("cannot parse txHash from cast output: %s", raw)
}

func isHexTxHash(v string) bool {
	s := strings.TrimSpace(v)
	if !strings.HasPrefix(s, "0x") || len(s) != 66 {
		return false
	}
	for _, ch := range s[2:] {
		if (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F') {
			continue
		}
		return false
	}
	return true
}
