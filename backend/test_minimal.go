// test_minimal.go
package main

import (
	"context"
	"fmt"
	"log"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

func main() {
	// 配置
	privateKey := "56e42b3674b7ea354677867d4045163f78bf7d16962199d22f6cf1a0df8ec52f"
	contractAddr := "0xe250ae653190f2edf3ac79fd9bdf2687a90cde84" // 原始子合约
	readerAddr := "0xE6bD248EA72EfF14D14f249D31BE12B6ca6f6e5C"
	rpcURL := "https://evmtestnet.confluxrpc.com"
	
	log.Printf("🧪 开始最小化测试...")
	log.Printf("📋 配置:")
	log.Printf("  私钥: %s...%s", privateKey[:10], privateKey[len(privateKey)-10:])
	log.Printf("  合约地址: %s", contractAddr)
	log.Printf("  读者地址: %s", readerAddr)
	log.Printf("  RPC: %s", rpcURL)
	
	// 连接到节点
	client, err := ethclient.Dial(rpcURL)
	if err != nil {
		log.Fatalf("❌ 连接失败: %v", err)
	}
	defer client.Close()
	
	// 解析私钥
	privateKeyECDSA, err := crypto.HexToECDSA(privateKey)
	if err != nil {
		log.Fatalf("❌ 私钥解析失败: %v", err)
	}
	
	publicKey := privateKeyECDSA.Public()
	publicKeyECDSA, ok := publicKey.(*crypto.PublicKey)
	if !ok {
		log.Fatal("❌ 公钥转换失败")
	}
	
	fromAddress := crypto.PubkeyToAddress(*publicKeyECDSA)
	log.Printf("📨 发送者地址: %s", fromAddress.Hex())
	
	// 获取nonce
	ctx := context.Background()
	nonce, err := client.PendingNonceAt(ctx, fromAddress)
	if err != nil {
		log.Fatalf("❌ 获取nonce失败: %v", err)
	}
	log.Printf("#️⃣ Nonce: %d", nonce)
	
	// 构建交易数据
	// mintToReader(address) 函数签名: 0x48e3658d
	methodID := common.FromHex("48e3658d")
	addrPadded := common.LeftPadBytes(common.HexToAddress(readerAddr).Bytes(), 32)
	inputData := append(methodID, addrPadded...)
	
	log.Printf("📦 交易数据: 0x%x", inputData)
	log.Printf("📦 函数调用: mintToReader(%s)", readerAddr)
	
	// 估算Gas
	gasPrice, err := client.SuggestGasPrice(ctx)
	if err != nil {
		gasPrice = big.NewInt(20000000000) // 20 Gwei 默认值
		log.Printf("⚠️ 使用默认Gas价格: %d wei", gasPrice)
	} else {
		log.Printf("⛽ 建议Gas价格: %d wei", gasPrice)
	}
	
	// 增加10%保证优先打包
	gasPrice = new(big.Int).Mul(gasPrice, big.NewInt(11))
	gasPrice = new(big.Int).Div(gasPrice, big.NewInt(10))
	log.Printf("⛽ 实际Gas价格: %d wei", gasPrice)
	
	// 估算Gas Limit
	contractAddress := common.HexToAddress(contractAddr)
	msg := ethereum.CallMsg{
		From:     fromAddress,
		To:       &contractAddress,
		Data:     inputData,
		GasPrice: gasPrice,
	}
	
	gasLimit := uint64(500000) // 默认值
	estimatedGas, err := client.EstimateGas(ctx, msg)
	if err != nil {
		log.Printf("⚠️ Gas估算失败: %v，使用默认值 %d", err, gasLimit)
	} else {
		gasLimit = estimatedGas * 12 / 10 // 增加20%缓冲
		log.Printf("📊 估算Gas: %d (实际使用: %d)", estimatedGas, gasLimit)
	}
	
	// 构建交易
	txData := &types.LegacyTx{
		Nonce:    nonce,
		To:       &contractAddress,
		Value:    big.NewInt(0),
		Gas:      gasLimit,
		GasPrice: gasPrice,
		Data:     inputData,
	}
	
	tx := types.NewTx(txData)
	
	// 获取ChainID
	chainID, err := client.NetworkID(ctx)
	if err != nil {
		log.Fatalf("❌ 获取ChainID失败: %v", err)
	}
	log.Printf("🌐 ChainID: %s", chainID)
	
	// 签名交易
	signedTx, err := types.SignTx(tx, types.NewEIP155Signer(chainID), privateKeyECDSA)
	if err != nil {
		log.Fatalf("❌ 签名失败: %v", err)
	}
	
	// 发送交易
	log.Printf("📤 发送交易...")
	startTime := time.Now()
	err = client.SendTransaction(ctx, signedTx)
	if err != nil {
		log.Fatalf("❌ 发送失败: %v", err)
	}
	
	txHash := signedTx.Hash().Hex()
	log.Printf("✅ 交易已发送!")
	log.Printf("🔗 交易哈希: %s", txHash)
	log.Printf("⏱️ 发送耗时: %v", time.Since(startTime))
	
	// 等待确认
	log.Printf("⏳ 等待交易确认...")
	for i := 0; i < 30; i++ {
		receipt, err := client.TransactionReceipt(ctx, signedTx.Hash())
		if err == nil && receipt != nil {
			log.Printf("📄 交易已确认!")
			log.Printf("   区块: %d", receipt.BlockNumber)
			log.Printf("   Gas使用: %d", receipt.GasUsed)
			log.Printf("   状态: %d (1=成功)", receipt.Status)
			
			if receipt.Status == 1 {
				log.Println("🎉 铸造成功!")
				
				// 检查NFT余额
				checkNFTBalance(client, contractAddr, readerAddr)
			} else {
				log.Println("❌ 交易执行失败")
			}
			return
		}
		
		fmt.Printf(".")
		time.Sleep(2 * time.Second)
	}
	
	log.Printf("⚠️ 交易确认超时，请稍后检查")
	log.Printf("🔍 检查交易: %s", txHash)
}

func checkNFTBalance(client *ethclient.Client, contractAddr, readerAddr string) {
	ctx := context.Background()
	
	// 尝试调用balanceOf
	data := common.FromHex("0x70a08231") // balanceOf(address) 函数签名
	data = append(data, common.LeftPadBytes(common.HexToAddress(readerAddr).Bytes(), 32)...)
	
	contractAddress := common.HexToAddress(contractAddr)
	readerAddress := common.HexToAddress(readerAddr)
	
	msg := ethereum.CallMsg{
		To:   &contractAddress,
		Data: data,
	}
	
	result, err := client.CallContract(ctx, msg, nil)
	if err != nil {
		log.Printf("⚠️ 查询余额失败: %v", err)
		return
	}
	
	balance := new(big.Int).SetBytes(result)
	log.Printf("📊 读者NFT余额: %s", balance.String())
	
	// 也可以直接使用预定义的ABI编码
	log.Printf("👤 读者地址: %s", readerAddress.Hex())
}
