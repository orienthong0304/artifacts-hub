# artifacts-mcp — 平台 MCP 工具定义

Artifacts 平台八个 MCP 动词（发布 / 更新 / 列表 / 读回源码 / 版本历史 / 回滚 / 临时链接 / 能力查询）的**单一真值**。

本包不是独立运行的 MCP server——它被平台 API 内嵌的 **Streamable HTTP 端点**（`server/src/routes/mcp.ts`，契约 §3.13）消费。接入平台 MCP 不需要安装本包：

```bash
claude mcp add --transport http artifacts https://你的域名/api/mcp \
  --header "Authorization: Bearer ak_你的Token"
```

Cursor / 其他支持 Streamable HTTP 的客户端：

```json
{
  "mcpServers": {
    "artifacts": {
      "type": "http",
      "url": "https://你的域名/api/mcp",
      "headers": { "Authorization": "Bearer ak_你的Token" }
    }
  }
}
```

API Token 在站内 `/developers` 页创建。

## 结构

- `src/server.ts` — `createServer(ctx)`：注册八个工具 + 白名单 resource
- `src/tools.ts` — 工具 handler（纯函数，`fetchFn` 可注入）
- `src/api.ts` — 平台 API 客户端（Bearer 鉴权、中文错误透传）
- `src/generated/whitelist.ts` — 由 `runner/vendor.config.mjs` 单点生成（仓库根 `node scripts/gen-whitelist.mjs --check` 校验一致性）

> stdio 入口已于 2026-08-31 删除：远程 MCP（URL + Bearer 即连）不再需要本地进程形态。
