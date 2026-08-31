# Artifacts 平台后端（server/）

Hono + TypeScript + node-postgres 实现的 Artifacts 开放平台 API。接口与数据模型严格遵循
`docs/superpowers/specs/2026-07-20-artifacts-platform-contracts.md`（第 2、3 节）。

## 技术栈

- **Hono** + `@hono/node-server` — HTTP 框架，监听 8091
- **pg**（node-postgres）— Postgres 连接池，启动时幂等执行 `schema.sql`
- **bcryptjs** — 密码哈希；**jose** — JWT（HS256，httpOnly cookie `artifacts_token`，30 天）
- **zod** — 请求校验（错误信息全部中文）；**nanoid** — 8 位 url-safe slug
- **vitest** — 纯逻辑单测

## 本地起法

```bash
cd server
npm install
cp .env.example .env          # 按需修改 DATABASE_URL / JWT_SECRET / ADMIN_EMAIL

# 准备数据库（一次即可）：
#   createdb artifacts_platform
# 表结构无需手动导入，服务启动时自动执行 schema.sql
# （幂等：users 表已存在则只跑增量迁移，如补 access_password_hash 列）

npm run dev                    # tsx watch，http://localhost:8091
```

主站 vite dev 已配置 `/api` proxy → `http://localhost:8091`，无跨域问题。

常用命令：

```bash
npm run build   # tsc → dist/
npm start       # node dist/index.js
npm test        # vitest run（纯逻辑单测，无需数据库）
```

## API 概览

全部 JSON；错误统一 `{ "error": "中文信息" }`；出参 camelCase。详见契约文档第 3 节。

- `POST /api/auth/register` / `login` / `logout`（注册与登录限流 10 次/分/IP）
- `GET /api/me`
- `GET|POST /api/artifacts`，`GET /api/artifacts/:slug`，`PUT|DELETE /api/artifacts/:id`
- `POST /api/artifacts/:slug/unlock`（访问密码解锁，签发 24h 访问令牌；限流 10 次/分/IP）
- `GET /api/explore`，`GET /api/users/:username`
- `POST /api/artifacts/:id/report`
- `GET /api/admin/reports`，`POST /api/admin/artifacts/:id/takedown`
- `GET /api/health`（部署探活）

关键语义：

- views 仅在 **public 且未下架** 的详情命中时自增（密码作品经有效访问令牌查看同样计入）
- private 仅作者可见；已下架作品仅作者/管理员可见（其他人 404）
- PUT/DELETE 严格校验作者本人（管理员也不能改别人的作品，只能下架）
- cookie 为 host-only（不设 Domain），不会下发给 run 子域
- 管理员下架时会顺带把该作品的未处理举报标记为已处理

访问密码（契约 §3.1）：

- artifact 出参新增只读字段 `hasPassword`（由 `access_password_hash is not null` 派生），任何接口都不返回哈希或明文
- `POST /api/artifacts` / `PUT /api/artifacts/:id` 接受可选 `accessPassword`：4-64 位字符串 = 设置/更换（bcrypt 存储）；`null` = 清除；缺省 = 不变
- 设有密码的作品，非作者/管理员访问 `GET /api/artifacts/:slug` 时需请求头 `X-Access-Token` 携带有效访问令牌，否则返回 200 的锁定形态（`{ slug, title, type, visibility, hasPassword, locked, author, createdAt }`，无 code）
- `POST /api/artifacts/:slug/unlock` `{password}` → 成功 `{accessToken}`（JWT，claim `{ sub: artifactId, typ: 'artifact-access' }`，24h，同一 JWT_SECRET）；失败 401
- private 作品密码无效（仍仅作者可见）；登录 token 与访问令牌通过 `typ` claim 隔离，不可互换

## 测试说明

`npm test` 覆盖纯逻辑：zod 校验、slug 生成、JWT 签发/校验往返、滑动窗口限流器。
**DB 层未做 mock 单测**（mock 到假通过没有意义），数据库相关行为留到部署阶段做集成验证：
起真实 Postgres 后跑 `npm run dev`，用 curl / 前端联调注册→创建→详情→下架全链路。

## 生产部署要点

1. 服务器上复用现有 Postgres（langchat-pgvector 实例），先建库：
   `create database artifacts_platform;`
2. `docker compose up -d --build`（见 `docker-compose.yml` 注释；`JWT_SECRET` 必填，
   建议 `openssl rand -hex 32` 生成；`ADMIN_EMAIL` 设为站长邮箱，注册即管理员）
3. 端口仅绑定 `127.0.0.1:8091`，OpenResty 配置
   `location /api/ { proxy_pass http://127.0.0.1:8091; }`（保留 `X-Forwarded-For`，限流依赖它取真实 IP）
4. 生产 `NODE_ENV=production`：cookie 自动加 `Secure`，缺 `JWT_SECRET` 会拒绝启动

## 目录结构

```
server/
├── schema.sql            # 数据模型（契约第 2 节原文）
├── src/
│   ├── index.ts          # 入口：路由组装 + 启动
│   ├── env.ts            # 环境变量（含极简 .env 加载）
│   ├── db.ts             # pg Pool + schema 幂等初始化 + 行类型
│   ├── auth.ts           # JWT 签发/校验、cookie、鉴权中间件
│   ├── ratelimit.ts      # 内存滑动窗口限流
│   ├── validation.ts     # zod schemas（中文错误）
│   ├── slug.ts           # nanoid 8 位 url-safe slug
│   ├── serialize.ts      # snake_case → camelCase 出参
│   └── routes/
│       ├── auth.ts       # /api/auth/*、/api/me
│       ├── artifacts.ts  # /api/artifacts*、/api/explore、/api/users/:username
│       └── admin.ts      # /api/admin/*
├── test/                 # vitest 纯逻辑单测
├── Dockerfile            # node:20-alpine 多阶段
└── docker-compose.yml    # api 服务（生产用外部 Postgres）
```
