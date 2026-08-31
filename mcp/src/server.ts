// Artifacts MCP server 工具注册（契约 §3.8 MCP 小节）：与 transport 解耦。
// stdio 入口（index.ts，本地进程）与平台内嵌的 Streamable HTTP 端点（server/src/routes/mcp.ts）
// 共用这一份注册——八个动词只有一份真值。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiContext } from './api.js';
import {
  publishArtifact,
  publishArtifactSchema,
  updateArtifact,
  updateArtifactSchema,
  listMyArtifacts,
  listMyArtifactsSchema,
  createTempLink,
  createTempLinkSchema,
  getArtifact,
  getArtifactSchema,
  listVersions,
  listVersionsSchema,
  restoreVersion,
  restoreVersionSchema,
  getPlatformCapabilities,
  getPlatformCapabilitiesSchema,
  platformCapabilitiesText,
} from './tools.js';
import { whitelistSummary } from './generated/whitelist.js';

/** 注册八个工具 + 白名单 resource（导出便于集成验证脚本复用） */
export function createServer(ctx: ApiContext): McpServer {
  const server = new McpServer({ name: 'artifacts-mcp', version: '0.2.0' });

  server.registerTool(
    'publish_artifact',
    {
      title: '发布作品到 Artifacts 平台',
      description:
        '把单文件 HTML 文档或 React 组件发布为可分享的在线页面，返回访问链接。' +
        '可见性缺省 unlisted（持链接可看，不进广场）。' +
        // 白名单摘要内嵌进描述：Agent 在生成代码之前就知道能用什么，
        // 而不是写完发布再撞一次 IMPORT_NOT_ALLOWED（完整清单见 get_platform_capabilities）
        `\n\nreact 类型必须 export default 根组件，且只能用平台白名单内的依赖：${whitelistSummary()}。` +
        '不支持相对路径 import（单文件模型）。完整约束用 get_platform_capabilities 查询。',
      inputSchema: publishArtifactSchema,
    },
    (args) => publishArtifact(ctx, args)
  );

  server.registerTool(
    'update_artifact',
    {
      title: '更新已发布的作品（同链接生效）',
      description:
        '按作品 id 更新 title / description / code / visibility；slug 不变，原链接即时呈现新内容。' +
        '每次内容变更自动留版本快照，可在网页端回滚。',
      inputSchema: updateArtifactSchema,
    },
    (args) => updateArtifact(ctx, args)
  );

  server.registerTool(
    'list_my_artifacts',
    {
      title: '列出我的作品',
      description: '列出当前 Token 账号下的全部作品（含 private），可按关键词与类型筛选。',
      inputSchema: listMyArtifactsSchema,
    },
    (args) => listMyArtifacts(ctx, args)
  );

  server.registerTool(
    'create_temp_link',
    {
      title: '生成限时访问链接',
      description:
        '为作品生成限时临时链接（阅后即焚分享）：豁免可见性与访问密码，到期自动失效，' +
        '不影响原链接。适合把私密作品限时给某人看。',
      inputSchema: createTempLinkSchema,
    },
    (args) => createTempLink(ctx, args)
  );

  server.registerTool(
    'get_artifact',
    {
      title: '读回作品源码',
      description:
        '按 id 或 slug 取回作品的完整源码与元信息，用于「把我那个作品改一下」这类请求——' +
        '先读回来，改完再用 update_artifact 提交，全程无需人类手工粘贴代码。',
      inputSchema: getArtifactSchema,
    },
    (args) => getArtifact(ctx, args)
  );

  server.registerTool(
    'list_versions',
    {
      title: '列出作品的历史版本',
      description: '列出某个作品的版本快照（新→旧）。每次内容变更自动留快照，最多保留最近 20 版。',
      inputSchema: listVersionsSchema,
    },
    (args) => listVersions(ctx, args)
  );

  server.registerTool(
    'restore_version',
    {
      title: '恢复作品到指定版本',
      description:
        '把作品内容恢复到某个历史版本，链接不变。' +
        '⚠️ 这是破坏性操作（当前内容会被覆盖，但会先另存为新版本可再回滚）——执行前请向用户确认。',
      inputSchema: restoreVersionSchema,
    },
    (args) => restoreVersion(ctx, args)
  );

  server.registerTool(
    'get_platform_capabilities',
    {
      title: '查询平台能力与依赖白名单',
      description:
        '返回可用的作品类型、依赖白名单（含版本）、shadcn/ui 组件清单与全部硬约束。' +
        '**生成代码之前先调它**，可以避免用了平台不支持的库再返工。',
      inputSchema: getPlatformCapabilitiesSchema,
    },
    () => getPlatformCapabilities()
  );

  // 同一份能力清单也暴露为 resource，便于客户端直接挂进上下文
  server.registerResource(
    'runtime-whitelist',
    'artifacts://runtime/whitelist',
    {
      title: 'Artifacts 运行时白名单与约束',
      description: '可用依赖（含版本）、shadcn/ui 组件、单文件与 export default 规则、沙箱限制。',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: platformCapabilitiesText() }],
    })
  );

  return server;
}

