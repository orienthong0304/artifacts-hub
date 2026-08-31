// 平台内嵌 MCP 端点（契约 §3.13）：Streamable HTTP，滴答清单同款接入形态。
//
// 为什么内嵌而不是发 npm 包：MCP 的 stdio 形态要求用户本地 clone + 构建（或等 npm 发布），
// 而平台本身就是 HTTP 服务——这里挂一个 /api/mcp 后，任何 MCP 客户端填 URL + Bearer Token
// 即接入，零安装；自托管实例跟着 API 部署自动获得。stdio 入口（mcp/ 包）保留给本地场景。
//
//   claude mcp add --transport http artifacts https://<域名>/api/mcp \
//     --header "Authorization: Bearer ak_xxx"
//
// 架构要点：
// - 工具注册复用 artifacts-mcp/server 的 createServer——八个动词只有一份真值；
// - 工具 handler 的 fetchFn 指向 app.request（Hono 内存内自调用，零网络开销），
//   透传请求者的 Authorization → 现有鉴权/校验/限流/审核门全部照常生效，零新鉴权面。
//   getApp 用注入而非直接 import app，避免 app.ts ↔ mcp.ts 循环依赖；
// - 无状态模式：每请求新建 McpServer + transport（工具型 MCP 无会话可言，
//   滴答等远程 MCP 同为此形态），请求间零共享状态；
// - Bearer 前置校验在 MCP 协议层之外：无 token / 无效 token 一律 401，
//   客户端（Claude Code 等）据此提示用户配置 header，而不是收到一堆协议错误。
import { Hono } from 'hono';
import { StreamableHTTPTransport } from '@hono/mcp';
import { createServer } from 'artifacts-mcp/server';
import { type AuthVariables } from '../auth.js';

type AppLike = {
  request: (input: string, init?: RequestInit) => Response | Promise<Response>;
};

export function createMcpRouter(getApp: () => AppLike): Hono<{ Variables: AuthVariables }> {
  const router = new Hono<{ Variables: AuthVariables }>();

  router.all('/mcp', async (c) => {
    // attachUser 已跑过（挂在 /api/* 上）：user 存在且 authVia=bearer 才放行。
    // cookie 会话不适用于 MCP（跨域客户端无 cookie；也避免网页会话被诱导驱动 MCP）
    const user = c.get('user');
    if (!user || c.get('authVia') !== 'bearer') {
      return c.json(
        { error: '需要 API Token：请求头 Authorization: Bearer ak_...（在 /developers 页创建）' },
        401
      );
    }

    const token = c.req.header('authorization')!.replace(/^bearer\s+/i, '');
    const server = createServer({
      baseUrl: 'http://artifacts.internal/api',
      token,
      // 内存内自调用：完整 URL 交给 app.request，host 部分被忽略、按路径路由
      fetchFn: ((input: string | URL | Request, init?: RequestInit) =>
        Promise.resolve(getApp().request(String(input), init))) as typeof fetch,
    });
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    return transport.handleRequest(c);
  });

  return router;
}
