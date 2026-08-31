# Artifacts 平台后端 — 多阶段构建（node:20-alpine）
# 产物仅包含 dist + 生产依赖 + schema.sql

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json schema.sql sensitive-words.example.txt ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/schema.sql ./schema.sql
COPY --from=build /app/sensitive-words.example.txt ./sensitive-words.example.txt
COPY package.json ./
EXPOSE 8091
USER node
CMD ["node", "dist/index.js"]
