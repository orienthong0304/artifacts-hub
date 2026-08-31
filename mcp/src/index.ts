#!/usr/bin/env node
// Artifacts 平台 MCP server —— stdio 入口（本地进程形态）。
// 推荐接入方式已是平台内嵌的 Streamable HTTP 端点（POST <你的域名>/api/mcp，
// 见 README）；本入口保留给离线/本地开发场景。
// 环境变量：ARTIFACTS_TOKEN（必填）/ ARTIFACTS_API_BASE（默认生产地址）
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveConfig } from './api.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  let config: { baseUrl: string; token: string };
  try {
    config = resolveConfig();
  } catch (e) {
    console.error(`[artifacts-mcp] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  const server = createServer(config);
  await server.connect(new StdioServerTransport());
  console.error(`[artifacts-mcp] 已启动（API：${config.baseUrl}）`);
}

main().catch((e) => {
  console.error(`[artifacts-mcp] 启动失败：${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
