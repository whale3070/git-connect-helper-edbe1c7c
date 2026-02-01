package blockchain

import (
	"context"
	"fmt"
	"math/big"
	"sort"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/redis/go-redis/v9"
)

// RewardService 封装区块链客户端、Redis以及后台私钥
type RewardService struct {
	Client      *ethclient.Client
	Redis       *redis.Client
	BackendKey  string
	ContractHex string
}

// dispense 发放奖励
func (s *RewardService) DispenseReward(
	ctx context.Context,
	referrerAddr string,
	recipientAddr string,
	codes []string,
) (string, string, error) {

	// ---------- 1. 基础校验 ----------
	if len(codes) != 5 {
		return "", "", fmt.Errorf("必须提供 5 个 hashcode")
	}

	referrer := common.HexToAddress(referrerAddr)
	recipient := common.HexToAddress(recipientAddr)

	// recipient 防二刷
	if s.Redis.Exists(ctx, "reward:recipient:"+recipient.Hex()).Val() == 1 {
		return "", "", fmt.Errorf("该地址已领取过奖励")
	}

	// ---------- 2. 生成 businessHash ----------
	businessHash := generateBusinessHashCode(codes)
	businessHex := businessHash.Hex()

	// businessHash 防重放
	if s.Redis.Exists(ctx, "reward:business:"+businessHex).Val() == 1 {
		return "", "", fmt.Errorf("该组 hashcode 已被使用")
	}

	// ---------- 3. 构造交易 ----------
	privateKeyECDSA, err := crypto.HexToECDSA(s.BackendKey)
	if err != nil {
		return "", "", err
	}

	fromAddr := crypto.PubkeyToAddress(privateKeyECDSA.PublicKey)
	contractAddr := common.HexToAddress(s.ContractHex)

	// 构造调用 dispenseTokens(address,bytes32) 的 data
	methodID := crypto.Keccak256([]byte("dispenseTokens(address,bytes32)"))[:4]
	data := append(methodID, common.LeftPadBytes(recipient.Bytes(), 32)...)
	data = append(data, businessHash.Bytes()...)

	nonce, err := s.Client.PendingNonceAt(ctx, fromAddr)
	if err != nil {
		return "", "", err
	}

	gasPrice, err := s.Client.SuggestGasPrice(ctx)
	if err != nil {
		return "", "", err
	}

	chainID, err := s.Client.ChainID(ctx)
	if err != nil {
		return "", "", err
	}

	tx := types.NewTx(&types.LegacyTx{
		Nonce:    nonce,
		To:       &contractAddr,
		Value:    big.NewInt(0),
		Gas:      150000,
		GasPrice: gasPrice,
		Data:     data,
	})

	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(chainID), privateKeyECDSA)
	if err != nil {
		return "", "", err
	}

	if err := s.Client.SendTransaction(ctx, signedTx); err != nil {
		return "", "", err
	}

	// ---------- 4. Redis 记账（事务） ----------
	pipe := s.Redis.TxPipeline()

	pipe.HSet(ctx, "reward:business:"+businessHex, map[string]interface{}{
		"referrer":  referrer.Hex(),
		"recipient": recipient.Hex(),
		"timestamp": time.Now().Unix(),
	})

	pipe.SAdd(ctx, "reward:referrer:"+referrer.Hex()+":hashes", businessHex)
	pipe.Incr(ctx, "reward:referrer:"+referrer.Hex()+":count")
	pipe.Set(ctx, "reward:recipient:"+recipient.Hex(), 1, 0)

	if _, err := pipe.Exec(ctx); err != nil {
		return "", "", err
	}

	return signedTx.Hash().Hex(), businessHex, nil
}

// ---------- hash 逻辑 ----------
func generateBusinessHashCode(codes []string) common.Hash {
	var hashes []common.Hash
	for _, c := range codes {
		hashes = append(hashes, common.HexToHash(c))
	}

	sort.Slice(hashes, func(i, j int) bool {
		return hashes[i].Hex() < hashes[j].Hex()
	})

	var combined []byte
	for _, h := range hashes {
		combined = append(combined, h.Bytes()...)
	}

	return crypto.Keccak256Hash(combined)
}
