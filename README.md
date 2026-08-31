# Artifacts — 自托管的 AI 作品分享站

[![CI](https://github.com/orienthong0304/artifacts-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/orienthong0304/artifacts-hub/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-coral.svg)](LICENSE)

把 AI 生成的单文件 React 组件 / HTML 页面 / 前端构建产物，变成可分享的在线链接。
自己部署，管理自己的作品私域；内建 MCP server，Claude Code / Cursor 等 AI Agent 可以直接发布作品。

- **粘贴即发布**：从 Claude / ChatGPT 复制的整段回复直接粘贴，自动剥掉 markdown 围栏与解说，渲染出预览
- **沙箱渲染**：用户代码只在无 `allow-same-origin` 的 opaque-origin iframe 中执行，拿不到站点 cookie 与 DOM
- **ZIP 站点托管**：Vite / Next 等构建产物打包上传，发布为静态站点（含 SPA fallback）
- **版本历史 / 临时链接 / 访问密码**：作品级的分享控制
- **Agent 接入**：`mcp/` 目录是完整的 MCP server（发布 / 更新 / 读回 / 版本 / 临时链接 8 个动词）

## 架构

| 子系统 | 目录 | 技术栈 |
|---|---|---|
| 主站前端 | `src/` | Vite + React 18 + shadcn/ui |
| 后端 API | `server/` | Hono + node-postgres，独立 package.json |
| 渲染器 | `runner/` | 独立 Vite 项目：@babel/standalone 浏览器端转译 + vendor 白名单 |
| MCP server | `mcp/` | @modelcontextprotocol/sdk，经 API Token 调平台 API |

## 快速开始（Docker Compose）

```bash
cp .env.example .env        # 按需修改（至少看一眼 JWT_SECRET）
docker compose up -d --build
```

起来后：

- 主站 http://localhost:8080 —— **第一个注册的账号自动成为管理员**（默认 `AUTH_MODE=single`：之后注册关闭，整个实例只属于你）
- 渲染器 http://localhost:8081（主站会自动嵌入，无需直接访问）
- API http://localhost:8091

## 部署模式

两个环境变量决定实例形态（都在 `.env` / compose 里）：

| 变量 | 取值 | 说明 |
|---|---|---|
| `AUTH_MODE` | `single`（默认） | 单用户：首个注册者即管理员，此后注册关闭 |
| | `multi` | 多用户开放注册（管理员由 `ADMIN_EMAIL` 指定） |
| `MODERATION_MODE` | `off`（默认） | 不做内容审核——自己对自己的内容负责 |
| | `cloud` | 本地敏感词表 + 阿里云内容安全机审 + 人工复核队列（多用户公开实例建议开启，需配 `ALIYUN_AK_*`） |

## 环境变量

服务端（`server/.env.example` 有完整注释版）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATABASE_URL` | — | Postgres 连接串（compose 已内置） |
| `JWT_SECRET` | — | **必配**，登录态签名密钥 |
| `AUTH_MODE` / `MODERATION_MODE` | 见上表 | 实例形态 |
| `SITES_DOMAIN_SUFFIX` | — | 子域功能的主域（见下方「子域功能」） |
| `SITE_QUOTA_PER_USER` | 3 | 每用户 ZIP 站点数（0 = 不限） |
| `SENSITIVE_WORDS_PATH` | 示例词表 | `MODERATION_MODE=cloud` 时的本地词表 |
| `OPERATOR_NAME` / `ICP_NUMBER` / `CONTACT_EMAIL` | 空 | 页脚公示；ICP 留空则整块隐藏（非中国大陆部署无需理会） |

前端构建变量（根目录 `.env.example`）：`VITE_RUNNER_ORIGIN`（渲染器地址，必配）、`VITE_SITE_ORIGIN`（分享链接域名，缺省用部署 origin）、`VITE_SITES_DOMAIN_SUFFIX`、`VITE_OPERATOR_NAME` 等公示项。

渲染器构建变量：`VITE_MAIN_HOST`（允许嵌入 runner 的主域，换域必配——否则主站的渲染指令会被 runner 的来源白名单拒绝）。

## 子域功能（可选）

用户前缀子域（`你的前缀.你的域名/自定义路径`）与 ZIP 站点子域需要：

1. 一条泛解析 DNS 记录 `*.你的域名`
2. 一张通配 TLS 证书（DNS-01 签发）
3. 反代把子域请求透传给 API（`Host` 头保留）

不配置时平台以单域模式运行：作品走 `/a/<slug>` 路径，一切功能可用，只是没有子域形态的地址。

## AI Agent 接入（MCP，零安装）

平台自带远程 MCP 服务（Streamable HTTP）——部署起来后 `/api/mcp` 就是 MCP 端点，
任何支持 MCP 的客户端填 URL + Token 即连：

```bash
claude mcp add --transport http artifacts https://你的域名/api/mcp \
  --header "Authorization: Bearer ak_xxx"
```

Cursor / 其他客户端用 JSON 配置：

```json
{
  "mcpServers": {
    "artifacts": {
      "type": "http",
      "url": "https://你的域名/api/mcp",
      "headers": { "Authorization": "Bearer ak_xxx" }
    }
  }
}
```

API Token 在站内 `/developers` 页创建。之后对 Agent 说「把这个页面发布到我的 Artifacts」即可。
（偏好本地进程的开发者仍可用 `mcp/` 子包的 stdio 形态，见其 README。）

## 开发

```bash
npm install && npm run dev            # 主站 :5173（/api 代理到 :8091）
cd runner && npm install && npm run dev   # 渲染器 :5174
cd server && npm install && npm run dev   # API :8091（需 DATABASE_URL）
```

测试：`cd server && npm test && npm run test:integration`（集成测试需要 Postgres，
`docker compose up -d test-db` 提供 localhost:5433）；`cd runner && npm test`；`cd mcp && npm test`。

## 已知限制

- `index.html` 的 preconnect / OG 标签、`public/sitemap.xml` 仍指向上游实例的域名，换域后请自行替换（不影响功能，只影响 SEO 元数据）
- `src/app/lib/guides-data.json` 的四篇使用指南是上游实例的内容，可整体替换或删除

## 贡献

欢迎 Issue 与 PR，流程与改动纪律见 [CONTRIBUTING.md](CONTRIBUTING.md)
（本仓库由私有主线定期同步发布，PR 合入方式略特殊，请先读一眼）。

## License

[MIT](LICENSE) · 起点脚手架致谢见 [NOTICE.md](NOTICE.md)
