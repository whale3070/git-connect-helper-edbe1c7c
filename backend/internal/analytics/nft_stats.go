package analytics

import (
	"context"
	"encoding/hex"
	"fmt"
	"log"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/redis/go-redis/v9"
)

type NFTStatsJob struct {
	RDB           *redis.Client
	Client        *ethclient.Client
	Contract      common.Address
	FromBlockHint uint64        // 合约部署区块（或你愿意从某个区块开始）
	Interval      time.Duration // 例如 30s / 1m / 5m
	Logger        *log.Logger
}

var (
	// ERC721 Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
	transferSigHash = common.HexToHash("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")

	zeroTopic = "0x0000000000000000000000000000000000000000000000000000000000000000"
	// 你要过滤的系统地址：0x000...1000
	systemUser = "0x0000000000000000000000000000000000001000"
)

// Start 启动定时任务（阻塞或放 goroutine 都行）
func (j *NFTStatsJob) Start(ctx context.Context) {
	if j.Interval <= 0 {
		j.Interval = 1 * time.Minute
	}
	ticker := time.NewTicker(j.Interval)
	defer ticker.Stop()

	// 启动时先跑一遍
	j.runOnce(ctx)

	for {
		select {
		case <-ctx.Done():
			j.logf("NFTStatsJob stopped: %v", ctx.Err())
			return
		case <-ticker.C:
			j.runOnce(ctx)
		}
	}
}

func (j *NFTStatsJob) runOnce(ctx context.Context) {
	if j.RDB == nil || j.Client == nil {
		j.logf("NFTStatsJob missing deps: rdb/client nil")
		return
	}

	contract := strings.ToLower(j.Contract.Hex())
	keyLast := fmt.Sprintf("vault:stats:nft:%s:last_block", contract)
	keyMinted := fmt.Sprintf("vault:stats:nft:%s:minted_total", contract)
	keyUnique := fmt.Sprintf("vault:stats:nft:%s:unique_minters", contract)
	keyReal := fmt.Sprintf("vault:stats:nft:%s:unique_real_users", contract)
	keyMintersSet := fmt.Sprintf("vault:stats:nft:%s:minters:set", contract)
	keyRealSet := fmt.Sprintf("vault:stats:nft:%s:real_users:set", contract)

	// 读 last scanned block
	startBlock := j.FromBlockHint
	if v, err := j.RDB.Get(ctx, keyLast).Result(); err == nil && v != "" {
		if b, ok := new(big.Int).SetString(v, 10); ok {
			startBlock = b.Uint64() + 1 // 从下一块继续
		}
	}

	latest, err := j.Client.BlockNumber(ctx)
	if err != nil {
		j.logf("BlockNumber error: %v", err)
		return
	}
	if startBlock > latest {
		// 没有新块
		return
	}

	// 为了避免单次范围太大导致 RPC 超时，分段扫
	const chunk uint64 = 50_000 // 你可以按链的响应调大/调小（例如 10k/50k/100k）
	var (
		mintedInc   int64
		mintersInc  int64 // 不直接用，最终以 Redis SCARD 为准
		realInc     int64 // 不直接用
		toBlockDone uint64
	)

	for from := startBlock; from <= latest; {
		to := from + chunk - 1
		if to > latest {
			to = latest
		}

		logs, err := j.fetchTransferLogs(ctx, from, to)
		if err != nil {
			j.logf("FilterLogs %d-%d error: %v", from, to, err)
			return
		}

		// 处理日志：只统计 mint（from==0）
		for _, lg := range logs {
			if len(lg.Topics) < 3 {
				continue
			}
			// topics[1]=from, topics[2]=to
			fromTopic := lg.Topics[1].Hex()
			if strings.ToLower(fromTopic) != zeroTopic {
				continue
			}

			mintedInc++

			toAddr := topicToAddress(lg.Topics[2])
			toAddr = strings.ToLower(toAddr)

			// SADD 去重集合
			// 注意：SADD 返回 1 表示新加进集合，0 表示已存在
			added, _ := j.RDB.SAdd(ctx, keyMintersSet, toAddr).Result()
			if added == 1 {
				mintersInc++
			}

			if toAddr != systemUser {
				added2, _ := j.RDB.SAdd(ctx, keyRealSet, toAddr).Result()
				if added2 == 1 {
					realInc++
				}
			}
		}

		toBlockDone = to
		from = to + 1
	}

	// minted_total 走 INCRBY（累加）
	if mintedInc > 0 {
		_ = j.RDB.IncrBy(ctx, keyMinted, mintedInc).Err()
	}

	// unique_* 以 SCARD 为准，避免并发/重启导致不一致
	uniqueMinters, _ := j.RDB.SCard(ctx, keyMintersSet).Result()
	uniqueReal, _ := j.RDB.SCard(ctx, keyRealSet).Result()
	_ = j.RDB.Set(ctx, keyUnique, uniqueMinters, 0).Err()
	_ = j.RDB.Set(ctx, keyReal, uniqueReal, 0).Err()

	// 更新 last scanned block
	_ = j.RDB.Set(ctx, keyLast, fmt.Sprintf("%d", toBlockDone), 0).Err()

	j.logf("NFTStats updated contract=%s blocks=%d..%d minted+%d (total=%s) unique=%d real=%d",
		contract, startBlock, toBlockDone, mintedInc,
		getOr(j.RDB.Get(ctx, keyMinted).Result()),
		uniqueMinters, uniqueReal,
	)
}

func (j *NFTStatsJob) fetchTransferLogs(ctx context.Context, from, to uint64) ([]types.Log, error) {
	q := ethereum.FilterQuery{
		FromBlock: big.NewInt(int64(from)),
		ToBlock:   big.NewInt(int64(to)),
		Addresses: []common.Address{j.Contract},
		Topics:    [][]common.Hash{{transferSigHash}},
	}
	return j.Client.FilterLogs(ctx, q)
}

// topicToAddress: 32字节 topic 的后 20 字节是 address
func topicToAddress(topic common.Hash) string {
	b := topic.Bytes() // 32 bytes
	return "0x" + hex.EncodeToString(b[12:]) // last 20 bytes
}

func (j *NFTStatsJob) logf(format string, args ...any) {
	if j.Logger != nil {
		j.Logger.Printf(format, args...)
	} else {
		log.Printf(format, args...)
	}
}

func getOr(v string, err error) string {
	if err != nil {
		return "?"
	}
	return v
}
