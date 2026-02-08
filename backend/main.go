package main

import (
	"context"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/oschwald/geoip2-golang"
	"github.com/redis/go-redis/v9"

	"whale-vault/relay/internal/blockchain"
	"whale-vault/relay/internal/handlers"
)

// ============================================================
// Config
// ============================================================

type Config struct {
	// base
	Port      string
	RPCURL    string
	ChainID   *big.Int
	RedisAddr string

	// contracts
	FactoryAddr      string
	NFTStatsContract string
	EndGameAddr      string // reward contract

	// stats
	NFTStatsFromBlock uint64
	NFTStatsInterval  time.Duration
	NFTStatsChunk     uint64
	NFTStatsPoll      time.Duration

	// keys
	USDTContract     string
	USDTAdminPrivKey string
	AdminAPIKey      string

	// reward signer key
	BackendPrivKey string

	// geoip
	GeoLiteCityMMDB string
}

func LoadConfig(dotenvPath string) (*Config, error) {
	_ = godotenv.Load(dotenvPath)
	if err := godotenv.Load(dotenvPath); err != nil {
		log.Println("⚠️ 未加载 .env:", err)
	} else {
		log.Println("✅ 已加载 .env")
	}

	get := func(k, def string) string {
		v := strings.TrimSpace(os.Getenv(k))
		if v == "" {
			return def
		}
		return v
	}

	rpcURL := get("RPC_URL", "")
	if rpcURL == "" {
		return nil, fmt.Errorf("RPC_URL 未设置")
	}
	chainIDStr := get("CHAIN_ID", "")
	if chainIDStr == "" {
		return nil, fmt.Errorf("CHAIN_ID 未设置")
	}
	cInt, err := strconv.ParseInt(chainIDStr, 10, 64)
	if err != nil || cInt <= 0 {
		return nil, fmt.Errorf("CHAIN_ID 无效: %s", chainIDStr)
	}

	cfg := &Config{
		Port:      get("PORT", "8080"),
		RPCURL:    rpcURL,
		ChainID:   big.NewInt(cInt),
		RedisAddr: get("REDIS_ADDR", "localhost:6379"),

		FactoryAddr:      get("FACTORY_ADDR", ""),
		NFTStatsContract: get("NFT_STATS_CONTRACT", ""),
		EndGameAddr:      get("EndGame_ADDR", ""),

		USDTContract:     get("USDT_CONTRACT", ""),
		USDTAdminPrivKey: strings.TrimPrefix(get("USDT_ADMIN_PRIVKEY", ""), "0x"),
		AdminAPIKey:      get("ADMIN_API_KEY", ""),

		BackendPrivKey: strings.TrimPrefix(get("BACKEND_PRIVATE_KEY", ""), "0x"),

		GeoLiteCityMMDB: get("GEOLITE2_CITY_MMDB", "/opt/Whale-Vault/geoip/GeoLite2-City.mmdb"),
	}

	// optional stats knobs
	if v := get("NFT_STATS_FROM_BLOCK", ""); v != "" {
		if u, e := strconv.ParseUint(v, 10, 64); e == nil {
			cfg.NFTStatsFromBlock = u
		}
	}
	if v := get("NFT_STATS_INTERVAL_SECONDS", ""); v != "" {
		if sec, e := strconv.ParseInt(v, 10, 64); e == nil && sec > 0 {
			cfg.NFTStatsInterval = time.Duration(sec) * time.Second
		}
	}
	if v := get("NFT_STATS_CHUNK", ""); v != "" {
		if u, e := strconv.ParseUint(v, 10, 64); e == nil && u > 0 {
			cfg.NFTStatsChunk = u
		}
	}
	if v := get("NFT_STATS_POLL_SECONDS", ""); v != "" {
		if sec, e := strconv.ParseInt(v, 10, 64); e == nil && sec > 0 {
			cfg.NFTStatsPoll = time.Duration(sec) * time.Second
		}
	}

	return cfg, nil
}

// ============================================================
// Globals
// ============================================================

var (
	ctx    = context.Background()
	rdb    *redis.Client
	client *ethclient.Client
)

// ============================================================
// NFT Stats (ERC-721 Transfer logs)
// ============================================================

var (
	transferSigHash = common.HexToHash("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")
	zeroTopic       = "0x0000000000000000000000000000000000000000000000000000000000000000"
	systemUser      = "0x0000000000000000000000000000000000001000"
)

type NFTStatsJob struct {
	RDB           *redis.Client
	Client        *ethclient.Client
	Contract      common.Address
	FromBlockHint uint64
	Interval      time.Duration
	ChunkSize     uint64
	Logger        *log.Logger
}

func (j *NFTStatsJob) Start(ctx context.Context) {
	if j.Interval <= 0 {
		j.Interval = 1 * time.Minute
	}
	if j.ChunkSize == 0 {
		j.ChunkSize = 50_000
	}
	j.runOnce(ctx)

	ticker := time.NewTicker(j.Interval)
	defer ticker.Stop()

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
	keyPrefix := fmt.Sprintf("vault:stats:nft:%s", contract)
	keyLast := keyPrefix + ":last_block"
	keyMinted := keyPrefix + ":minted_total"
	keyUnique := keyPrefix + ":unique_minters"
	keyReal := keyPrefix + ":unique_real_users"
	keyMintersSet := keyPrefix + ":minters:set"
	keyRealSet := keyPrefix + ":real_users:set"

	startBlock := j.FromBlockHint
	if v, err := j.RDB.Get(ctx, keyLast).Result(); err == nil && v != "" {
		if b, ok := new(big.Int).SetString(v, 10); ok {
			startBlock = b.Uint64() + 1
		}
	}

	latest, err := j.Client.BlockNumber(ctx)
	if err != nil {
		j.logf("BlockNumber error: %v", err)
		return
	}
	if startBlock > latest {
		return
	}

	var mintedInc int64
	var toBlockDone uint64

	for from := startBlock; from <= latest; {
		to := from + j.ChunkSize - 1
		if to > latest {
			to = latest
		}

		logs, err := j.fetchTransferLogs(ctx, from, to)
		if err != nil {
			j.logf("FilterLogs %d-%d error: %v", from, to, err)
			return
		}

		for _, lg := range logs {
			if len(lg.Topics) < 3 {
				continue
			}
			if strings.ToLower(lg.Topics[1].Hex()) != zeroTopic {
				continue
			}

			mintedInc++
			toAddr := strings.ToLower(topicToAddress(lg.Topics[2]))
			_ = j.RDB.SAdd(ctx, keyMintersSet, toAddr).Err()
			if toAddr != systemUser {
				_ = j.RDB.SAdd(ctx, keyRealSet, toAddr).Err()
			}
		}

		toBlockDone = to
		from = to + 1
	}

	if mintedInc > 0 {
		_ = j.RDB.IncrBy(ctx, keyMinted, mintedInc).Err()
	}

	uniqueMinters, _ := j.RDB.SCard(ctx, keyMintersSet).Result()
	uniqueReal, _ := j.RDB.SCard(ctx, keyRealSet).Result()

	_ = j.RDB.Set(ctx, keyUnique, uniqueMinters, 0).Err()
	_ = j.RDB.Set(ctx, keyReal, uniqueReal, 0).Err()
	_ = j.RDB.Set(ctx, keyLast, fmt.Sprintf("%d", toBlockDone), 0).Err()

	mintedTotal, _ := j.RDB.Get(ctx, keyMinted).Result()
	j.logf("NFTStats updated contract=%s blocks=%d..%d minted+%d (total=%s) unique=%d real=%d",
		contract, startBlock, toBlockDone, mintedInc, mintedTotal, uniqueMinters, uniqueReal,
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

func topicToAddress(topic common.Hash) string {
	b := topic.Bytes()
	return "0x" + hex.EncodeToString(b[12:])
}

func (j *NFTStatsJob) logf(format string, args ...any) {
	if j.Logger != nil {
		j.Logger.Printf(format, args...)
	} else {
		log.Printf(format, args...)
	}
}

// ============================================================
// Multi-contract Stats Manager
// ============================================================

type NFTStatsManager struct {
	RDB    *redis.Client
	Client *ethclient.Client
	Logger *log.Logger

	DefaultFromBlock uint64
	Interval         time.Duration
	ChunkSize        uint64
	PollContracts    time.Duration

	mu    sync.Mutex
	jobs  map[string]context.CancelFunc
	start sync.Once
}

func (m *NFTStatsManager) Start(ctx context.Context) {
	m.start.Do(func() {
		if m.PollContracts <= 0 {
			m.PollContracts = 30 * time.Second
		}
		if m.Interval <= 0 {
			m.Interval = 1 * time.Minute
		}
		if m.ChunkSize == 0 {
			m.ChunkSize = 50_000
		}
		if m.jobs == nil {
			m.jobs = map[string]context.CancelFunc{}
		}
	})

	m.refreshOnce(ctx)

	tk := time.NewTicker(m.PollContracts)
	defer tk.Stop()

	for {
		select {
		case <-ctx.Done():
			m.logf("NFTStatsManager stopped: %v", ctx.Err())
			m.stopAll()
			return
		case <-tk.C:
			m.refreshOnce(ctx)
		}
	}
}

func (m *NFTStatsManager) refreshOnce(ctx context.Context) {
	if m.RDB == nil || m.Client == nil {
		m.logf("NFTStatsManager missing deps: rdb/client nil")
		return
	}

	setVals, err := m.RDB.SMembers(ctx, "vault:nft:contracts").Result()
	if err != nil {
		return
	}

	uniq := map[string]struct{}{}
	for _, c := range setVals {
		c = strings.ToLower(strings.TrimSpace(c))
		if isHexAddress(c) {
			uniq[c] = struct{}{}
		}
	}

	for c := range uniq {
		m.ensureJob(ctx, c)
	}
}

func (m *NFTStatsManager) ensureJob(parent context.Context, contractLower string) {
	m.mu.Lock()
	_, exists := m.jobs[contractLower]
	m.mu.Unlock()
	if exists {
		return
	}

	fromBlock := m.DefaultFromBlock
	if v, err := m.RDB.Get(parent, fmt.Sprintf("vault:stats:nft:%s:from_block", contractLower)).Result(); err == nil && v != "" {
		if u, e := strconv.ParseUint(strings.TrimSpace(v), 10, 64); e == nil {
			fromBlock = u
		}
	}

	job := &NFTStatsJob{
		RDB:           m.RDB,
		Client:        m.Client,
		Contract:      common.HexToAddress(contractLower),
		FromBlockHint: fromBlock,
		Interval:      m.Interval,
		ChunkSize:     m.ChunkSize,
		Logger:        m.Logger,
	}

	jobCtx, cancel := context.WithCancel(parent)

	m.mu.Lock()
	if _, ok := m.jobs[contractLower]; ok {
		m.mu.Unlock()
		cancel()
		return
	}
	m.jobs[contractLower] = cancel
	m.mu.Unlock()

	go job.Start(jobCtx)
	m.logf("📊 NFTStatsJob started (auto): contract=%s fromBlock=%d interval=%s chunk=%d",
		contractLower, fromBlock, m.Interval.String(), m.ChunkSize,
	)
}

func (m *NFTStatsManager) stopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for c, cancel := range m.jobs {
		cancel()
		delete(m.jobs, c)
	}
}

func (m *NFTStatsManager) logf(format string, args ...any) {
	if m.Logger != nil {
		m.Logger.Printf(format, args...)
	} else {
		log.Printf(format, args...)
	}
}

// ============================================================
// Handlers (stats + reward)
// ============================================================

func nftStatsHandler(defaultContract string) http.HandlerFunc {
	type resp struct {
		Ok    bool   `json:"ok"`
		Error string `json:"error,omitempty"`
		Data  any    `json:"data,omitempty"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		contract := strings.TrimSpace(r.URL.Query().Get("contract"))
		if contract == "" {
			contract = strings.TrimSpace(defaultContract)
		}
		if !isHexAddress(contract) {
			writeJSON(w, http.StatusBadRequest, resp{Ok: false, Error: "invalid contract"})
			return
		}
		contract = strings.ToLower(contract)

		keyPrefix := fmt.Sprintf("vault:stats:nft:%s", contract)
		keyLast := keyPrefix + ":last_block"
		keyMinted := keyPrefix + ":minted_total"
		keyUnique := keyPrefix + ":unique_minters"
		keyReal := keyPrefix + ":unique_real_users"

		last, _ := rdb.Get(ctx, keyLast).Result()
		minted, _ := rdb.Get(ctx, keyMinted).Result()
		unique, _ := rdb.Get(ctx, keyUnique).Result()
		real, _ := rdb.Get(ctx, keyReal).Result()

		toInt := func(s string) int64 {
			s = strings.TrimSpace(s)
			if s == "" {
				return 0
			}
			v, err := strconv.ParseInt(s, 10, 64)
			if err != nil {
				return 0
			}
			return v
		}

		writeJSON(w, http.StatusOK, resp{
			Ok: true,
			Data: map[string]any{
				"contract":           contract,
				"minted_total":       toInt(minted),
				"unique_minters":     toInt(unique),
				"unique_real_users":  toInt(real),
				"last_scanned_block": toInt(last),
			},
		})
	}
}

func nftContractsHandler() http.HandlerFunc {
	type resp struct {
		Ok    bool     `json:"ok"`
		Error string   `json:"error,omitempty"`
		Data  []string `json:"data,omitempty"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		setVals, err := rdb.SMembers(ctx, "vault:nft:contracts").Result()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, resp{Ok: false, Error: err.Error()})
			return
		}
		out := make([]string, 0, len(setVals))
		for _, c := range setVals {
			c = strings.ToLower(strings.TrimSpace(c))
			if isHexAddress(c) {
				out = append(out, c)
			}
		}
		writeJSON(w, http.StatusOK, resp{Ok: true, Data: out})
	}
}

type dispenseReq struct {
	Referrer  string   `json:"referrer"`
	Recipient string   `json:"recipient"`
	Codes     []string `json:"codes"`
}

type dispenseResp struct {
	Ok           bool   `json:"ok"`
	Error        string `json:"error,omitempty"`
	TxHash       string `json:"txHash,omitempty"`
	BusinessHash string `json:"businessHash,omitempty"`
}

func rewardDispenseHandler(svc *blockchain.RewardService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		var req dispenseReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, dispenseResp{Ok: false, Error: "invalid json"})
			return
		}

		ref := strings.TrimSpace(req.Referrer)
		recv := strings.TrimSpace(req.Recipient)
		if !isHexAddress(ref) || !isHexAddress(recv) {
			writeJSON(w, http.StatusBadRequest, dispenseResp{Ok: false, Error: "invalid address"})
			return
		}
		if len(req.Codes) != 5 {
			writeJSON(w, http.StatusBadRequest, dispenseResp{Ok: false, Error: "必须提供 5 个 hashcode"})
			return
		}
		for i := range req.Codes {
			req.Codes[i] = strings.TrimSpace(req.Codes[i])
			if !isBytes32(req.Codes[i]) {
				writeJSON(w, http.StatusBadRequest, dispenseResp{Ok: false, Error: fmt.Sprintf("codes[%d] 不是 bytes32 (0x+64hex)", i)})
				return
			}
		}

		cctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
		defer cancel()

		tx, biz, err := svc.DispenseReward(cctx, ref, recv, req.Codes)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, dispenseResp{Ok: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, dispenseResp{Ok: true, TxHash: tx, BusinessHash: biz})
	}
}

// ============================================================
// main
// ============================================================

func main() {
	// ✅ 用你现在服务器真实路径；你 main2 里是 /mnt/data/.env，这里沿用（你也可改回 /root/...）
	cfg, err := LoadConfig("/root/git-connect-helper-edbe1c7c/backend/.env")

	if err != nil {
		log.Fatal(err)
	}

	// Redis
	rdb = redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Protocol: 2,
	})
	log.Println("✅ Redis 连接成功, addr =", cfg.RedisAddr)

	// Ethereum client
	client, err = ethclient.Dial(cfg.RPCURL)
	if err != nil {
		log.Fatalf("❌ RPC 连接失败: %v", err)
	}
	log.Println("✅ 以太坊客户端连接成功")
	log.Println("🔗 当前网络 ChainID:", cfg.ChainID.String())

	// ✅ GeoLite2 mmdb
	geoDB, err := geoip2.Open(cfg.GeoLiteCityMMDB)
	if err != nil {
		log.Fatalf("❌ GeoLite2 mmdb open failed: %v (path=%s)", err, cfg.GeoLiteCityMMDB)
	}
	log.Println("✅ GeoLite2 City DB loaded:", cfg.GeoLiteCityMMDB)
	defer geoDB.Close()

	// 让 handlers 包级 GeoIP 也能用（你 analytics.go 里支持 geoIPGlobal）
	handlers.SetGeoIP(geoDB)

	// Load relayers
	handlers.LoadRelayers(client, cfg.ChainID)

	// handlers DI
	relayH := &handlers.RelayHandler{RDB: rdb, Client: client, GeoIP: geoDB}
	marketH := &handlers.MarketHandler{RDB: rdb}
	factoryH := &handlers.FactoryHandler{RDB: rdb, Client: client, ChainID: cfg.ChainID}
	mintH := &handlers.MintHandler{RDB: rdb, Client: client}
	authH := &handlers.AuthHandler{RDB: rdb, Client: client}
	publisherH := &handlers.PublisherHandler{RDB: rdb, Client: client, FactoryAddr: cfg.FactoryAddr}

	// NFT stats manager
	manager := &NFTStatsManager{RDB: rdb, Client: client, Logger: log.Default()}
	manager.DefaultFromBlock = cfg.NFTStatsFromBlock
	manager.Interval = cfg.NFTStatsInterval
	manager.ChunkSize = cfg.NFTStatsChunk
	manager.PollContracts = cfg.NFTStatsPoll
	go manager.Start(ctx)
	log.Println("📊 NFTStatsManager started (multi-contract mode)")

	// Reward service（不再调用 NewRewardService）
	rewardSvc := &blockchain.RewardService{
		Client:      client,
		Redis:       rdb,
		BackendKey:  cfg.BackendPrivKey,
		ContractHex: cfg.EndGameAddr,
	}

	// routes
	r := mux.NewRouter()
	r.Use(requestLoggerMiddleware)

	// --- auth
	r.HandleFunc("/secret/get-binding", authH.GetBinding).Methods("GET", "OPTIONS")
	r.HandleFunc("/secret/verify", authH.Verify).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/admin/check-access", authH.CheckAdminAccess).Methods("GET", "OPTIONS")

	// --- relay
	r.HandleFunc("/relay/save-code", relayH.SaveCode).Methods("POST", "OPTIONS")
	r.HandleFunc("/relay/reward", relayH.Reward).Methods("POST", "OPTIONS")
	r.HandleFunc("/relay/stats", relayH.GetReferrerStats).Methods("GET", "OPTIONS")

	// --- mint
	r.HandleFunc("/relay/mint", mintH.Mint).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/v1/nft/total-minted", mintH.GetTotalMinted).Methods("GET", "OPTIONS")
	r.PathPrefix("/relay/tx/").HandlerFunc(mintH.GetTxResult).Methods("GET", "OPTIONS")

	// --- stats APIs
	r.HandleFunc("/api/v1/nft/stats", nftStatsHandler(cfg.NFTStatsContract)).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/nft/contracts", nftContractsHandler()).Methods("GET", "OPTIONS")

	// --- market
	r.HandleFunc("/api/v1/tickers", marketH.GetTickers).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/market/tickers", marketH.GetTickers).Methods("GET", "OPTIONS")

	// --- factory / publisher
	r.HandleFunc("/api/v1/precheck-code", factoryH.PrecheckCode).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/factory/verify-publisher", factoryH.VerifyPublisher).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/publisher/balance", factoryH.GetPublisherBalance).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/publisher/zip", publisherH.GenerateAndDownloadZip).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/publisher/books/search", publisherH.SearchPublisherBooks).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/factory/create", factoryH.DeployBook).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/v1/publisher/deploy-book", factoryH.DeployBook).Methods("POST", "OPTIONS")

	// --- analytics (distribution + leaderboard)
	r.HandleFunc("/api/v1/analytics/distribution", relayH.GetDistribution).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/analytics/leaderboard", relayH.GetLeaderboard).Methods("GET", "OPTIONS")

	// --- reward dispense
	r.HandleFunc("/api/v1/reward/dispense", rewardDispenseHandler(rewardSvc)).Methods("POST", "OPTIONS")

	// --- admin usdt recharge
	r.HandleFunc("/api/admin/usdt/recharge", adminRechargeUSDTHandler(cfg)).Methods("POST", "OPTIONS")

	// server
	fmt.Printf("🚀 Whale Vault 后端启动成功 (监听端口: %s)\n", cfg.Port)
	srv := &http.Server{
		Addr:    "0.0.0.0:" + cfg.Port,
		Handler: corsMiddleware(r),
	}
	log.Fatal(srv.ListenAndServe())
}

// ============================================================
// Admin USDT Recharge
// ============================================================

type rechargeUSDTReq struct {
	To     string `json:"to"`
	Amount int64  `json:"amount"`
}

type apiResp struct {
	Ok     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
	TxHash string `json:"txHash,omitempty"`
}

func adminRechargeUSDTHandler(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		if strings.TrimSpace(cfg.AdminAPIKey) != "" {
			got := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
			if subtle.ConstantTimeCompare([]byte(got), []byte(cfg.AdminAPIKey)) != 1 {
				writeJSON(w, http.StatusUnauthorized, apiResp{Ok: false, Error: "unauthorized"})
				return
			}
		}

		var req rechargeUSDTReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{Ok: false, Error: "invalid json"})
			return
		}

		to := strings.TrimSpace(req.To)
		if !isHexAddress(to) {
			writeJSON(w, http.StatusBadRequest, apiResp{Ok: false, Error: "invalid 'to' address"})
			return
		}
		if req.Amount <= 0 {
			writeJSON(w, http.StatusBadRequest, apiResp{Ok: false, Error: "amount must be > 0"})
			return
		}
		if !isHexAddress(cfg.USDTContract) {
			writeJSON(w, http.StatusBadRequest, apiResp{Ok: false, Error: "USDT_CONTRACT not set or invalid"})
			return
		}
		if cfg.USDTAdminPrivKey == "" {
			writeJSON(w, http.StatusInternalServerError, apiResp{Ok: false, Error: "USDT_ADMIN_PRIVKEY not set"})
			return
		}

		c := blockchain.NewUSDTClient(cfg.USDTContract, cfg.RPCURL, cfg.USDTAdminPrivKey)
		tx, err := c.Recharge(to, req.Amount)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiResp{Ok: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, apiResp{Ok: true, TxHash: tx})
	}
}

// ============================================================
// Helpers + Middleware
// ============================================================

func isHexAddress(s string) bool {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "0x") || len(s) != 42 {
		return false
	}
	for _, ch := range s[2:] {
		if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')) {
			return false
		}
	}
	return true
}

func isBytes32(s string) bool {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "0x") || len(s) != 66 {
		return false
	}
	for _, ch := range s[2:] {
		if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')) {
			return false
		}
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func requestLoggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Printf("🔔 [REQ] %s %s | From: %s\n", r.Method, r.URL.Path, GetClientIP(r))
		next.ServeHTTP(w, r)
	})
}

func corsMiddleware(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		h.ServeHTTP(w, r)
	})
}

func GetClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}
	ip := r.RemoteAddr
	if colonIdx := strings.LastIndex(ip, ":"); colonIdx != -1 {
		ip = ip[:colonIdx]
	}
	return ip
}

func DeriveAddressFromPrivateKey(privateKeyHex string) string {
	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(strings.TrimSpace(privateKeyHex), "0x"))
	if err != nil {
		return ""
	}
	return crypto.PubkeyToAddress(privateKey.PublicKey).Hex()
}
