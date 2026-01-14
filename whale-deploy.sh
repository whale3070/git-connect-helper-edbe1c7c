#!/bin/bash

# 1. 定义物理路径
SOURCE_DIR="/opt/Whale-Vault"
DIST_DIR="$SOURCE_DIR/dist"
WEB_ROOT="/var/www/whale-vault"

echo "🚀 [Whale3070] 开始物理存证部署流程..."

# 2. 前端编译 (包含 public 目录下的 403.html)
echo "📦 正在执行 npm build..."
cd $SOURCE_DIR
npm run build

# 3. 逻辑检查：确保 dist 目录生成成功
if [ ! -d "$DIST_DIR" ]; then
    echo "❌ 错误：编译失败，dist 目录未生成。"
    exit 1
fi

# 4. 物理迁移：排除旧文件干扰
echo "🚚 正在迁移文件至生产目录: $WEB_ROOT"
sudo rm -rf $WEB_ROOT/*
sudo cp -r $DIST_DIR/* $WEB_ROOT/

# 5. 权限确权：确保 Nginx 拥有读取权
echo "🔑 正在设置 Web 用户权限..."
sudo chown -R www-data:www-data $WEB_ROOT
sudo chmod -R 755 $WEB_ROOT

# 6. Nginx 逻辑刷新
echo "⚙️ 正在校验 Nginx 配置并重启..."
if sudo nginx -t; then
    sudo systemctl reload nginx
    echo "✅ 部署成功！403 页面与最新逻辑已上线。"
else
    echo "❌ 错误：Nginx 配置校验失败，请检查配置文件。"
    exit 1
fi

echo "🎉 部署闭环完成。去 Subscan 看看你的勋章吧！"
