FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# 对应脚本第2步
RUN npm run build

FROM nginx:stable-alpine
# 对应脚本第4步：将编译产物推向 Nginx 目录
COPY --from=builder /app/dist /usr/share/nginx/html
# 对应脚本第6步：注入 Nginx 配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
