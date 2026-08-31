# artifacts-mcp

Artifacts 开放平台的 MCP server：让 Claude Code / Cursor / Cline 等 AI Agent 在对话里直接发布、更新作品，并生成限时分享链接。stdio transport，仅依赖平台公开 HTTP API（Bearer Token 鉴权）。

## 前置：创建 API Token

登录 [https://artifacts.orienthong.cn/developers](https://artifacts.orienthong.cn/developers) 创建 Token（`ak_` 开头，明文只显示一次）。Token 等同你的账号权限，请像密码一样保管，勿写入代码或提交到仓库。

## 安装（本地构建）

```bash
git clone <本仓库>
cd artifact/mcp
npm install && npm run build
```

构建产物为 `mcp/dist/index.js`（可执行入口，bin 名 `artifacts-mcp`）。

### Claude Code

```bash
claude mcp add artifacts --env ARTIFACTS_TOKEN=你的Token -- node /绝对路径/artifact/mcp/dist/index.js
```

### Claude Desktop / Cursor / Cline（JSON 配置）

```json
{
  "mcpServers": {
    "artifacts": {
      "command": "node",
      "args": ["/绝对路径/artifact/mcp/dist/index.js"],
      "env": {
        "ARTIFACTS_TOKEN": "ak_你的Token"
      }
    }
  }
}
```

Claude Desktop 配置文件位置：macOS `~/Library/Application Support/Claude/claude_desktop_config.json`；Cursor 为项目 `.cursor/mcp.json` 或全局 `~/.cursor/mcp.json`；Cline 在扩展的 MCP Servers 设置里粘贴同款 JSON。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `ARTIFACTS_TOKEN` | ✓ | 平台 API Token（`ak_` 开头）。缺失时启动即报错退出 |
| `ARTIFACTS_API_BASE` | - | API 地址，默认 `https://artifacts.orienthong.cn/api`（本地开发可指向 `http://localhost:8091/api`） |

## 工具

| 工具 | 参数 | 说明 |
|---|---|---|
| `publish_artifact` | `title`, `type`(`react`\|`html`), `code`, `description?`, `visibility?`(缺省 `unlisted`) | 发布单文件作品，返回访问链接 `/a/{slug}`。`public` 且待审核时链接即时可用，审核通过后进广场 |
| `update_artifact` | `id`, `title?`, `description?`, `code?`, `visibility?` | 同链接更新：slug 不变，原链接即时呈现新内容；内容变更自动留版本快照 |
| `list_my_artifacts` | `q?`, `type?` | 列出账号下全部作品（id / slug / 标题 / 类型 / 可见性 / 浏览量 / 链接） |
| `create_temp_link` | `artifactId`, `expiresInHours?`(1/6/12/24/72/168/720，缺省 24), `note?` | 生成限时访问链接 `/t/{token}`：豁免可见性与访问密码，到期自动失效，不影响原链接 |

对话示例：「把这个页面发布到 Artifacts，标题叫贪吃蛇」「更新刚才那个作品的代码」「给我的私密作品生成一个 24 小时的临时链接发给客户」。

## 开发

```bash
npm run dev    # tsx 直跑 src/index.ts
npm run build  # tsc → dist/
npm test       # vitest 单测（注入 fake fetch，不打真实网络）
```

## npm 发布指引（站长执行）

包已按发布形态配置（`bin` 指向 `dist/index.js`，`files` 仅含 `dist` 与 README）：

```bash
cd mcp
npm run build && npm test
npm publish --access public
```

发布后用户即可免克隆直用：

```bash
claude mcp add artifacts --env ARTIFACTS_TOKEN=你的Token -- npx -y artifacts-mcp
```
