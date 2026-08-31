// 平台内嵌 MCP 端点（契约 §3.13）：Streamable HTTP，滴答清单同款接入形态
//
// 为什么是 HTTP 而不是 npm 包：MCP 的 stdio 形态要求用户本地 clone+构建（或等 npm 发布），
// 而平台本身就是 HTTP 服务——挂一个 /api/mcp 端点后，任何 MCP 客户端填 URL + Bearer Token
// 即接入，零安装，自托管实例自动获得。工具注册与 stdio 入口共用 artifacts-mcp/server 的
// createServer（八个动词只有一份真值）；工具内部经 app.request 内存内自调用平台 API，
// 透传请求者的 Authorization → 现有鉴权/校验/限流/审核门全部生效，零新鉴权面。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app, pool, initSchema, resetDb, registerUser } from './helpers.js';

const MCP_ACCEPT = 'application/json, text/event-stream';

/** JSON-RPC over Streamable HTTP：响应可能是 JSON 或 SSE，统一解析出首个 JSON-RPC 消息 */
async function rpc(
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<{ status: number; message: Record<string, unknown> | null }> {
  const res = await app.request('/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: MCP_ACCEPT, ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let message: Record<string, unknown> | null = null;
  if (text.trim().startsWith('{')) {
    message = JSON.parse(text);
  } else {
    // SSE：取第一条 data: 行
    const line = text.split('\n').find((l) => l.startsWith('data:'));
    if (line) message = JSON.parse(line.slice(5));
  }
  return { status: res.status, message };
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'integration-test', version: '0.0.0' },
  },
};

describe('MCP Streamable HTTP 端点（契约 §3.13）', () => {
  let bearer: string;

  beforeAll(async () => {
    await initSchema();
    await resetDb();
    const { cookie } = await registerUser('mcpuser');
    const res = await app.request('/api/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ label: 'mcp-http' }),
    });
    const { token } = (await res.json()) as { token: string };
    bearer = `Bearer ${token}`;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('无 Authorization → 401（客户端据此提示配置 header）', async () => {
    const { status } = await rpc(INITIALIZE);
    expect(status).toBe(401);
  });

  it('无效 token → 401，不进入 MCP 协议层', async () => {
    const { status } = await rpc(INITIALIZE, { authorization: `Bearer ak_${'x'.repeat(32)}` });
    expect(status).toBe(401);
  });

  it('initialize → 返回 server 名与协议版本', async () => {
    const { status, message } = await rpc(INITIALIZE, { authorization: bearer });
    expect(status).toBe(200);
    const result = message?.result as { serverInfo: { name: string } };
    expect(result.serverInfo.name).toBe('artifacts-mcp');
  });

  it('tools/list → 八个动词齐全', async () => {
    const { message } = await rpc(
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { authorization: bearer }
    );
    const tools = (message?.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    for (const name of [
      'publish_artifact',
      'update_artifact',
      'list_my_artifacts',
      'get_artifact',
      'list_versions',
      'restore_version',
      'create_temp_link',
      'get_platform_capabilities',
    ]) {
      expect(tools, name).toContain(name);
    }
  });

  it('tools/call publish_artifact → 真实落库，作品归属 token 主人', async () => {
    const { message } = await rpc(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'publish_artifact',
          arguments: { title: 'HTTP MCP 发布', type: 'html', code: '<h1>经 /api/mcp 发布</h1>' },
        },
      },
      { authorization: bearer }
    );
    const result = message?.result as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('发布成功');

    const row = await pool.query<{ title: string }>(
      `select a.title from artifacts a join users u on u.id = a.user_id where u.username = 'mcpuser'`
    );
    expect(row.rows.map((r) => r.title)).toContain('HTTP MCP 发布');
  });
});
