FROM golang:1.24-alpine AS builder

# 安装必要的编译工具（有些 C 库依赖可能需要）
RUN apk add --no-cache gcc musl-dev

WORKDIR /app

# 1. 先只复制 mod 文件，利用 Docker 缓存加速 [cite: 2026-01-01]
COPY go.mod go.sum ./
RUN go mod download

# 2. 复制后端所有源码 (包括 internal 文件夹)
COPY . .

# 3. 这里的路径关键：确保 internal 文件夹在当前目录下
# 运行 tidy 确保依赖路径被正确解析
RUN go mod tidy

# 4. 执行编译
RUN go build -o whale-backend main.go

FROM alpine:latest
WORKDIR /root/
COPY --from=builder /app/whale-backend .
COPY --from=builder /app/.env .
EXPOSE 8080
CMD ["./whale-backend"]
