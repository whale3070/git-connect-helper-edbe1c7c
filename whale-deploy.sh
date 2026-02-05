#!/usr/bin/env bash
set -euo pipefail

# =========================
# Whale Vault Frontend Deploy
# =========================

# 1) 项目路径（你现在的真实路径）
SOURCE_DIR="/root/git-connect-helper-edbe1c7c"
DIST_DIR="$SOURCE_DIR/dist"

# 2) Nginx 站点根目录（与你 nginx.conf 的 root 保持一致）
WEB_ROOT="/var/www/whale-vault"

# 3) 是否把 public/403.html 复制到站点根（可选）
COPY_403_HTML="true"

echo "🚀 [Whale3070] 开始部署..."
echo "   - SOURCE_DIR: $SOURCE_DIR"
echo "   - DIST_DIR:   $DIST_DIR"
echo "   - WEB_ROOT:   $WEB_ROOT"

# 0. 前置检查
if [ ! -d "$SOURCE_DIR" ]; then
  echo "❌ 错误：SOURCE_DIR 不存在：$SOURCE_DIR"
  exit 1
fi

cd "$SOURCE_DIR"

# 1. 前端编译
echo "📦 正在执行前端构建..."
# 优先保证 node_modules 正确（可根据你习惯改为 npm install）
if [ -f "package-lock.json" ]; then
  npm ci
else
  npm install
fi

npm run build

# 2. 检查 dist 是否生成
if [ ! -d "$DIST_DIR" ]; then
  echo "❌ 错误：编译失败，dist 目录未生成。"
  exit 1
fi

if [ ! -f "$DIST_DIR/index.html" ]; then
  echo "❌ 错误：dist/index.html 不存在，构建可能异常。"
  exit 1
fi

# 3. 准备站点目录
echo "📁 正在准备站点目录..."
sudo mkdir -p "$WEB_ROOT"

# 4. 回滚保护：先备份当前线上版本
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="/var/www/.whale-vault-backup_$STAMP"
if [ -d "$WEB_ROOT" ] && [ "$(ls -A "$WEB_ROOT" 2>/dev/null || true)" != "" ]; then
  echo "🧯 备份当前线上文件到：$BACKUP_DIR"
  sudo mkdir -p "$BACKUP_DIR"
  sudo cp -a "$WEB_ROOT/." "$BACKUP_DIR/"
fi

# 5. 原子替换：先同步到临时目录，再整体替换
TMP_DIR="/tmp/whale-vault-deploy_$STAMP"
echo "🚚 正在同步构建产物到临时目录：$TMP_DIR"
sudo rm -rf "$TMP_DIR"
sudo mkdir -p "$TMP_DIR"
sudo cp -r "$DIST_DIR/." "$TMP_DIR/"

# 可选：把 public/403.html 放到站点根（如果你想直接 /403.html 访问）
if [ "$COPY_403_HTML" = "true" ] && [ -f "$SOURCE_DIR/public/403.html" ]; then
  echo "📄 同步 public/403.html 到站点根（/403.html）"
  sudo cp -f "$SOURCE_DIR/public/403.html" "$TMP_DIR/403.html"
fi

echo "♻️ 正在替换线上目录内容..."
sudo rm -rf "$WEB_ROOT"/*
sudo cp -r "$TMP_DIR/." "$WEB_ROOT/"

# 6. 权限
echo "🔑 正在设置权限..."
sudo chown -R www-data:www-data "$WEB_ROOT"
sudo chmod -R 755 "$WEB_ROOT"

# 7. Nginx 校验与 reload
echo "⚙️ 校验 Nginx 配置并 reload..."
sudo nginx -t
sudo systemctl reload nginx

# 8. 基础自检（可选但建议）
echo "🧪 自检：确认 index.html 可访问"
curl -s -I "http://127.0.0.1/" | head -n 1 || true

echo "✅ 部署成功！"
echo "   - 线上目录：$WEB_ROOT"
echo "   - 备份目录：${BACKUP_DIR:-无}"
echo "🎉 部署闭环完成。"
