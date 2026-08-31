# 渲染器：node 构建（含 vendor 打包）→ nginx 静态（全资源 CORS *）
# 构建 context = 仓库根（需要 docker/nginx/runner.conf）
FROM node:20-alpine AS build
WORKDIR /app
COPY runner/package.json runner/package-lock.json ./
RUN npm ci
COPY runner/ .
ARG VITE_MAIN_HOST
ENV VITE_MAIN_HOST=$VITE_MAIN_HOST
RUN npm run build

FROM nginx:1.27-alpine
COPY docker/nginx/runner.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
