# 使用 Node 进行 Vite 打包
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# 执行 vite build
RUN npm run build

# 使用 Nginx 托管静态页面
FROM nginx:stable-alpine
# Vite 默认打包输出到 dist 目录
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
