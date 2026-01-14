#!/bin/bash

# --- 物理路径配置 ---
APP_NAME="whale-vault-backend"
SOURCE_FILE="main.go"
LOG_FILE="backend.log"

echo "------------------------------------------"
echo "🚀 开始部署 Whale Vault 增强版..."
echo "------------------------------------------"

# 1. 检查 Go 环境
if ! command -v go &> /dev/null; then
    echo "❌ 错误: 未检测到 Go 环境，请先安装 Go。"
    exit 1
fi

# 2. 清理旧进程（如果已经在运行）
echo "🧹 正在清理旧的进程..."
PID=$(pgrep -f $APP_NAME)
if [ -z "$PID" ]; then
    echo "💡 没有发现正在运行的旧进程。"
else
    echo "终止进程 PID: $PID"
    kill -9 $PID
fi

# 3. 整理依赖 (Go Modules)
# 如果你还没有初始化 go mod，脚本会自动处理
if [ ! -f "go.mod" ]; then
    echo "📦 初始化 Go 模块..."
    go mod init whale-vault
fi

echo "下载依赖中 (go-ethereum)..."
go mod tidy

# 4. 编译二进制文件
echo "🛠️ 正在编译 $SOURCE_FILE..."
go build -o $APP_NAME $SOURCE_FILE

if [ $? -ne 0 ]; then
    echo "❌ 编译失败，请检查代码语法。"
    exit 1
fi
echo "✅ 编译成功: ./$APP_NAME"

# 5. 启动服务 (后台运行)
echo "🌐 正在后台启动服务..."
# 使用 nohup 保证退出终端后程序不停止，并将日志重定向到 backend.log
nohup ./$APP_NAME > $LOG_FILE 2>&1 &

# 6. 确认状态
sleep 2
NEW_PID=$(pgrep -f $APP_NAME)
if [ -z "$NEW_PID" ]; then
    echo "❌ 服务启动失败，请检查 $LOG_FILE"
else
    echo "🎉 服务已成功启动！"
    echo "📌 PID: $NEW_PID"
    echo "📝 日志文件: $LOG_FILE"
    echo "🔍 使用命令查看实时日志: tail -f $LOG_FILE"
fi
echo "------------------------------------------"
