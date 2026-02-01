package main

import (
	"context"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"

	"whale-vault/relay/internal/blockchain"
	"whale-vault/relay/internal/handlers"
)

// ========================================
// 
// ========================================
var (
	ctx     = context.Background()
	rdb     *redis.Client
	client  *ethclient.Client
	chainID *big.Int
)

func main() {
	// ========================================
	// 1. 
	// ========================================
	godotenv.Load()

	// ?Redis
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}
	rdb = redis.NewClient(&redis.Options{
		Addr: redisAddr,
	})
	log.Println("?Redis ")

	// ?	var err error
	client, err = ethclient.Dial(os.Getenv("RPC_URL"))
	if err != nil {
		log.Fatalf("?RPC : %v", err)
	}
	log.Println("?")

	//  Chain ID
	cidStr := os.Getenv("CHAIN_ID")
	cInt, _ := strconv.ParseInt(cidStr, 10, 64)
	chainID = big.NewInt(cInt)

	// ========================================
	// 2. ?	// ========================================
	handlers.LoadRelayers(client, chainID)

	// ========================================
	// 3. ?RewardService
	// ========================================
	rewardSvc := &blockchain.RewardService{
		Client:      client,
		Redis:       rdb,
		BackendKey:  os.Getenv("BACKEND_PRIVATE_KEY"), // ?		ContractHex: os.Getenv("CONTRACT_ADDRESS"),    // 
	}

	// ========================================
	// 4.  ()
	// ========================================
	relayH := &handlers.RelayHandler{
		RDB:       rdb,
		Client:    client,
		RewardSvc: rewardSvc, // ? RewardService
	}

	marketH := &handlers.MarketHandler{
		RDB: rdb,
	}

	factoryH := &handlers.FactoryHandler{
		RDB:     rdb,
		Client:  client,
		ChainID: chainID,
	}

	mintH := &handlers.MintHandler{
		RDB:    rdb,
		Client: client,
	}

	authH := &handlers.AuthHandler{
		RDB:    rdb,
		Client: client,
	}
	// ========================================
	// ?PublisherHandler
	// ========================================
	publisherH := &handlers.PublisherHandler{
		RDB: rdb,
		Client: client,
		FactoryAddr: os.Getenv("FACTORY_CONTRACT"), // 
	}
	// ========================================
	// 5. 
	// ========================================
	r := mux.NewRouter()
	r.Use(requestLoggerMiddleware)

	// 
	r.HandleFunc("/secret/get-binding", authH.GetBinding).Methods("GET", "OPTIONS")
	r.HandleFunc("/secret/verify", authH.Verify).Methods("GET", "OPTIONS")

	// Relay 
	r.HandleFunc("/relay/save-code", relayH.SaveCode).Methods("POST", "OPTIONS")
	r.HandleFunc("/relay/reward", relayH.Reward).Methods("POST", "OPTIONS")
	r.HandleFunc("/relay/stats", relayH.GetReferrerStats).Methods("GET", "OPTIONS")

	// NFT ?	r.HandleFunc("/relay/mint", mintH.Mint).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/v1/nft/total-minted", mintH.GetTotalMinted).Methods("GET", "OPTIONS")

	// 
	r.HandleFunc("/api/v1/tickers", marketH.GetTickers).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/market/tickers", marketH.GetTickers).Methods("GET", "OPTIONS")

	// 
	r.HandleFunc("/api/v1/precheck-code", factoryH.PrecheckCode).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/factory/verify-publisher", factoryH.VerifyPublisher).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/factory/create", factoryH.CreateBook).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/v1/factory/deploy-book", factoryH.DeployBook).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/v1/publisher/balance", factoryH.GetPublisherBalance).Methods("GET", "OPTIONS")

	// 
	r.HandleFunc("/api/v1/analytics/distribution", relayH.GetDistribution).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/v1/reader/location", mintH.GetReaderLocation).Methods("GET", "OPTIONS")

	// ?	r.HandleFunc("/api/admin/check-access", authH.CheckAdminAccess).Methods("GET", "OPTIONS")
    r.HandleFunc("/api/v1/publisher/deploy-book", publisherH.CreateBook).Methods("POST", "OPTIONS") //?	// ========================================
	// 6. 
	// ========================================
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	fmt.Printf(" Whale Vault  (: %s)\n", port)

	srv := &http.Server{
		Addr:    "0.0.0.0:" + port,
		Handler: corsMiddleware(r),
	}
	log.Fatal(srv.ListenAndServe())
}

// ========================================
// ?// ========================================

func requestLoggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Printf(" [REQ] %s %s | From: %s\n", r.Method, r.URL.Path, r.RemoteAddr)
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

// ========================================
// 
// ========================================

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
	privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(privateKeyHex, "0x"))
	if err != nil {
		return ""
	}
	return crypto.PubkeyToAddress(privateKey.PublicKey).Hex()
}

