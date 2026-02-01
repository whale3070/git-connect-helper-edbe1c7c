package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"
	
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

// ERC721 Transfer(address,address,uint256) 事件签名
const erc721TransferSig = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

// GET /relay/tx/{txHash}
func (h *MintHandler) GetTxResult(w http.ResponseWriter, r *http.Request) {
	txHashStr := strings.TrimPrefix(r.URL.Path, "/relay/tx/")
	txHashStr = strings.TrimSpace(txHashStr)

	txHash := common.HexToHash(txHashStr)

	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()

	receipt, err := h.Client.TransactionReceipt(ctx, txHash)
	if err != nil {
		// 交易尚未上链
		writeOK(w, map[string]any{
			"status": "PENDING",
		})
		return
	}

	// 交易已上链，但失败
	if receipt.Status == types.ReceiptStatusFailed {
		writeOK(w, map[string]any{
			"status": "FAILED",
		})
		return
	}
	
	processedKey := "tx:processed:" + strings.ToLower(txHash.Hex())

    ok, _ := h.RDB.SetNX(ctx, processedKey, 1, 24*time.Hour).Result()
    if !ok {
	    data, _ := h.RDB.HGetAll(ctx, "tx:mint:"+strings.ToLower(txHash.Hex())).Result()
		writeOK(w, map[string]any{
			"status":   "SUCCESS",
			"cached":  true,
			"reader":  data["reader"],
			"tokenId": data["token_id"],
			"contract": data["contract"],
			"txHash":  txHash.Hex(),
		})
        return
    }
	
	// 交易成功，解析 logs
	for _, lg := range receipt.Logs {

		if len(lg.Topics) != 4 {
			continue
		}

		if lg.Topics[0].Hex() != erc721TransferSig {
			continue
		}

		from := common.HexToAddress(lg.Topics[1].Hex())
		to := common.HexToAddress(lg.Topics[2].Hex())
		tokenId := lg.Topics[3].Big()

		// mint 特征：from == address(0)
		if from != (common.Address{}) {
			continue
		}

		// ===== 写入 Redis：reader -> NFT 绑定 =====
		readerKey := "reader:nft:" + strings.ToLower(to.Hex())

		_ = h.RDB.HSet(ctx, readerKey, map[string]any{
			"status":    "minted",
			"token_id":  tokenId.String(),
			"contract":  strings.ToLower(lg.Address.Hex()),
			"tx_hash":   strings.ToLower(txHash.Hex()),
			"block":     receipt.BlockNumber.Uint64(),
			"minted_at": time.Now().Unix(),
		}).Err()

		// （可选）tx -> mint 结果索引
		_ = h.RDB.HSet(ctx, "tx:mint:"+strings.ToLower(txHash.Hex()), map[string]any{
			"reader":   strings.ToLower(to.Hex()),
			"token_id": tokenId.String(),
			"contract": strings.ToLower(lg.Address.Hex()),
			"status":   "success",
		}).Err()

		writeOK(w, map[string]any{
			"status":   "SUCCESS",
			"reader":  to.Hex(),
			"tokenId": tokenId.String(),
			"contract": lg.Address.Hex(),
			"txHash":  txHash.Hex(),
		})
		return
	}

	// 理论上不会走到这里（成功但没 Transfer）
	writeOK(w, map[string]any{
		"status": "SUCCESS",
	})


}
