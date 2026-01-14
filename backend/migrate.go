package main

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/go-redis/redis/v8"
)

var ctx = context.Background()

func main() {
	// 1. 连接 Redis
	rdb := redis.NewClient(&redis.Options{
		Addr:     "localhost:6379",
		Password: "", // 如果有密码请填写
		DB:       0,
	})

	// 2. 打开旧的 hash-code.txt 文件
	filePath := "hash-code.txt"
	file, err := os.Open(filePath)
	if err != nil {
		log.Fatalf("无法打开文件: %v", err)
	}
	defer file.Close()

	// 3. 使用 Pipeline 提高写入效率
	pipe := rdb.Pipeline()
	
	scanner := bufio.NewScanner(file)
	validCount := 0
	usedCount := 0

	fmt.Println("正在读取文件并准备迁移...")

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue // 跳过空行和注释
		}

		if strings.HasPrefix(line, "USED:") {
			// 已使用的码
			code := strings.TrimPrefix(line, "USED:")
			pipe.SAdd(ctx, "vault:codes:used", code)
			usedCount++
		} else {
			// 待使用的码
			pipe.SAdd(ctx, "vault:codes:valid", line)
			validCount++
		}

		// 每 1000 条提交一次，防止管道过大
		if (validCount+usedCount)%1000 == 0 {
			_, err := pipe.Exec(ctx)
			if err != nil {
				log.Printf("批量提交失败: %v", err)
			}
		}
	}

	// 提交剩余的数据
	_, err = pipe.Exec(ctx)
	if err != nil {
		log.Fatalf("最终提交失败: %v", err)
	}

	if err := scanner.Err(); err != nil {
		log.Fatalf("读取文件错误: %v", err)
	}

	fmt.Printf("\n✅ 迁移完成！\n")
	fmt.Printf("- 导入有效码 (Valid): %d 条\n", validCount)
	fmt.Printf("- 导入已用码 (Used): %d 条\n", usedCount)
	fmt.Printf("现在你可以放心启动 Redis 版的后端了。\n")
}
