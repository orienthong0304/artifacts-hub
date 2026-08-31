// 八个 MCP 工具（契约 §3.8 MCP 小节）：zod schema + handler
// handler 纯函数式（ApiContext 注入），组装请求 → 格式化人类可读中文文本（含完整 URL）
import { z } from 'zod';
import { callApi, siteOrigin, type ApiContext } from './api.js';
import {
  WHITELIST_PACKAGES,
  UI_COMPONENTS,
  PLATFORM_RULES,
  whitelistSummary,
} from './generated/whitelist.js';

/** MCP 工具返回形态（与 SDK CallToolResult 兼容的最小子集；索引签名为 SDK 类型所需） */
export interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function fail(e: unknown): ToolResult {
  const msg = e instanceof Error ? e.message : String(e);
  return { content: [{ type: 'text', text: msg }], isError: true };
}

/** API 返回的 artifact 对象（本包只消费的字段） */
interface ArtifactPayload {
  id: string;
  slug: string;
  title: string;
  type: string;
  visibility: string;
  views: number;
  reviewStatus: string;
}

const visibilityEnum = z
  .enum(['public', 'unlisted', 'private'])
  .describe('可见性：public 进广场（机审通过即上架）/ unlisted 持链接可看（推荐）/ private 仅自己');

// ---------- publish_artifact ----------

export const publishArtifactSchema = {
  title: z.string().min(1).max(120).describe('作品标题（≤120 字）'),
  type: z
    .enum(['react', 'html'])
    .describe('代码类型：html 完整 HTML 文档 / react 带 default export 的单文件 React 组件'),
  code: z.string().min(1).describe('完整单文件代码（≤500KB）'),
  description: z.string().max(1000).optional().describe('作品描述（可选，≤1000 字）'),
  visibility: visibilityEnum.optional().describe('可见性，缺省 unlisted'),
  aiGenerated: z
    .boolean()
    .optional()
    .describe(
      '生成合成内容声明（《人工智能生成合成内容标识办法》）：缺省 true，作品角标会显示「AI 生成」标识。' +
        '仅当代码确非 AI 生成或辅助生成（例如替用户搬运其手写的既有页面）时才传 false'
    ),
};

export async function publishArtifact(
  ctx: ApiContext,
  args: {
    title: string;
    type: 'react' | 'html';
    code: string;
    description?: string;
    visibility?: 'public' | 'unlisted' | 'private';
    aiGenerated?: boolean;
  }
): Promise<ToolResult> {
  try {
    const body: Record<string, unknown> = {
      title: args.title,
      type: args.type,
      code: args.code,
      visibility: args.visibility ?? 'unlisted',
    };
    if (args.description !== undefined) body.description = args.description;
    // 不传即不塞该字段——由服务端缺省（true）决定，避免本包与服务端各持一份默认值
    if (args.aiGenerated !== undefined) body.aiGenerated = args.aiGenerated;

    const data = (await callApi('/artifacts', { ...ctx, method: 'POST', body })) as {
      artifact: ArtifactPayload;
    };
    const a = data.artifact;
    const url = `${siteOrigin(ctx.baseUrl)}/a/${a.slug}`;

    const lines = [
      `作品「${a.title}」发布成功。`,
      `链接：${url}`,
      `slug：${a.slug}`,
      `id：${a.id}（更新作品时使用）`,
      `可见性：${a.visibility} · 审核状态：${a.reviewStatus}`,
    ];
    if (a.visibility === 'public' && a.reviewStatus === 'pending') {
      lines.push('已发布，内容转人工复核中，通过后进入广场；链接即时可用。');
    }
    return ok(lines.join('\n'));
  } catch (e) {
    return fail(e);
  }
}

// ---------- update_artifact ----------

export const updateArtifactSchema = {
  id: z.string().min(1).describe('作品 id（发布响应或 list_my_artifacts 返回）'),
  title: z.string().min(1).max(120).optional().describe('新标题（可选）'),
  description: z.string().max(1000).optional().describe('新描述（可选）'),
  code: z.string().min(1).optional().describe('新代码（可选；内容变更自动留版本快照，可随时回滚）'),
  visibility: visibilityEnum.optional(),
};

export async function updateArtifact(
  ctx: ApiContext,
  args: {
    id: string;
    title?: string;
    description?: string;
    code?: string;
    visibility?: 'public' | 'unlisted' | 'private';
  }
): Promise<ToolResult> {
  try {
    const body: Record<string, unknown> = {};
    for (const key of ['title', 'description', 'code', 'visibility'] as const) {
      if (args[key] !== undefined) body[key] = args[key];
    }
    // 前置校验：除 id 外至少一个字段，否则直接报错，省一次网络往返
    if (Object.keys(body).length === 0) {
      return {
        content: [
          { type: 'text', text: '至少需要提供一个待更新字段（title/description/code/visibility）' },
        ],
        isError: true,
      };
    }
    const data = (await callApi(`/artifacts/${encodeURIComponent(args.id)}`, {
      ...ctx,
      method: 'PUT',
      body,
    })) as { artifact: ArtifactPayload };
    const a = data.artifact;
    const url = `${siteOrigin(ctx.baseUrl)}/a/${a.slug}`;

    const lines = [
      `作品「${a.title}」更新成功（同链接更新，原链接即时生效）。`,
      `链接：${url}`,
      `可见性：${a.visibility} · 审核状态：${a.reviewStatus}`,
    ];
    if (a.visibility === 'public' && a.reviewStatus === 'pending') {
      lines.push('作品转人工复核中，通过后进入广场；链接即时可用。');
    }
    return ok(lines.join('\n'));
  } catch (e) {
    return fail(e);
  }
}

// ---------- list_my_artifacts ----------

export const listMyArtifactsSchema = {
  q: z.string().optional().describe('按标题/描述模糊搜索（可选）'),
  type: z.enum(['react', 'html']).optional().describe('按类型筛选（可选）'),
};

export async function listMyArtifacts(
  ctx: ApiContext,
  args: { q?: string; type?: 'react' | 'html' }
): Promise<ToolResult> {
  try {
    const params = new URLSearchParams();
    if (args.q) params.set('q', args.q);
    if (args.type) params.set('type', args.type);
    const qs = params.toString();

    const data = (await callApi(`/artifacts${qs ? `?${qs}` : ''}`, { ...ctx })) as {
      items: ArtifactPayload[];
    };
    if (!data.items.length) {
      return ok('还没有作品。用 publish_artifact 发布第一个吧。');
    }
    const origin = siteOrigin(ctx.baseUrl);
    const lines = data.items.map((a) =>
      [
        `- ${a.title}（${a.type} · ${a.visibility} · ${a.views} 次浏览）`,
        `  id：${a.id}`,
        `  链接：${origin}/a/${a.slug}`,
      ].join('\n')
    );
    return ok([`共 ${data.items.length} 个作品：`, ...lines].join('\n'));
  } catch (e) {
    return fail(e);
  }
}

// ---------- create_temp_link ----------

/** 有效期枚举（契约 §3.6）：1|6|12|24|72|168|720 小时 */
export const createTempLinkSchema = {
  artifactId: z.string().min(1).describe('作品 id'),
  expiresInHours: z
    .union([
      z.literal(1),
      z.literal(6),
      z.literal(12),
      z.literal(24),
      z.literal(72),
      z.literal(168),
      z.literal(720),
    ])
    .optional()
    .describe('有效期小时数，限 1/6/12/24/72/168/720，缺省 24'),
  note: z.string().max(200).optional().describe('备注（可选，≤200 字，仅自己可见）'),
};

export async function createTempLink(
  ctx: ApiContext,
  args: { artifactId: string; expiresInHours?: number; note?: string }
): Promise<ToolResult> {
  try {
    const body: Record<string, unknown> = { expiresInHours: args.expiresInHours ?? 24 };
    if (args.note !== undefined) body.note = args.note;

    const data = (await callApi(
      `/artifacts/${encodeURIComponent(args.artifactId)}/temp-links`,
      { ...ctx, method: 'POST', body }
    )) as { tempLink: { token: string; expiresAt: string; note: string | null } };
    const t = data.tempLink;
    const url = `${siteOrigin(ctx.baseUrl)}/t/${t.token}`;

    const lines = [
      '临时链接创建成功（豁免可见性与访问密码——私密作品持此链接也能看）。',
      `链接：${url}`,
      `到期时间：${t.expiresAt}（到期自动失效，可在网页端提前撤销）`,
    ];
    if (t.note) lines.push(`备注：${t.note}`);
    return ok(lines.join('\n'));
  } catch (e) {
    return fail(e);
  }
}

// ---------- get_artifact ----------
//
// 这个动词修掉的是 AI 工作流最实际的一个断点：list_my_artifacts 的出参不含 code，
// 于是 Agent 处理「把我上周那个数据看板改一下」时**读不回源码**，只能要求人类
// 手工粘贴回去。有了它，Agent 可以自己取回 → 改 → update_artifact，人类全程不碰代码。

export const getArtifactSchema = {
  idOrSlug: z
    .string()
    .min(1)
    .describe('作品 id（publish/list 返回）或 slug（链接 /a/ 后面那段）'),
};

/** 详情出参（比列表多 code / description / customUrl） */
interface ArtifactDetail extends ArtifactPayload {
  code?: string;
  description?: string | null;
  customUrl?: string | null;
}

export async function getArtifact(
  ctx: ApiContext,
  args: { idOrSlug: string }
): Promise<ToolResult> {
  try {
    const key = args.idOrSlug.trim();
    // 详情端点按 slug 取；传 id 时先从自己的列表里换成 slug（列表已含 id 与 slug）
    let slug = key;
    if (UUID_RE.test(key)) {
      const list = (await callApi('/artifacts', { ...ctx })) as { items: ArtifactPayload[] };
      const hit = list.items.find((a) => a.id === key);
      if (!hit) return fail(new Error(`没有找到 id 为 ${key} 的作品（它可能不属于当前 Token 账号）。`));
      slug = hit.slug;
    }
    // 详情端点是**可选鉴权**的公开接口：Token 无效时它不会 401，只会对私密作品回 404。
    // 裸传「作品不存在」会让用户以为作品没了，实际可能只是 Token 错了——补一句可操作的分流提示。
    let data: { artifact: ArtifactDetail };
    try {
      data = (await callApi(`/artifacts/${encodeURIComponent(slug)}`, { ...ctx })) as {
        artifact: ArtifactDetail;
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/不存在|404/.test(msg)) {
        return fail(
          new Error(
            `没有找到「${key}」。可能是：① id/slug 写错了；② 它是私密作品而当前 API Token ` +
              '不属于作者账号（详情端点对无权访问者一律回「不存在」，不区分两者）。' +
              '可先用 list_my_artifacts 确认本 Token 账号下有哪些作品。'
          )
        );
      }
      throw e;
    }
    const a = data.artifact;
    if (typeof a.code !== 'string') {
      return fail(
        new Error('该作品设有访问密码或不可读，无法取回源码。请在网页端处理，或改用没有密码的作品。')
      );
    }
    const origin = siteOrigin(ctx.baseUrl);
    return ok(
      [
        `${a.title}（${a.type} · ${a.visibility}）`,
        `id：${a.id}`,
        `链接：${a.customUrl || `${origin}/a/${a.slug}`}`,
        a.description ? `描述：${a.description}` : null,
        '',
        '--- 源码开始 ---',
        a.code,
        '--- 源码结束 ---',
        '',
        `改完后用 update_artifact（id: ${a.id}）提交，链接不变、自动留版本快照。`,
      ]
        .filter((l) => l !== null)
        .join('\n')
    );
  } catch (e) {
    return fail(e);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- list_versions / restore_version ----------

export const listVersionsSchema = {
  id: z.string().min(1).describe('作品 id'),
};

interface VersionPayload {
  version: number;
  title: string;
  createdAt: string;
}

export async function listVersions(ctx: ApiContext, args: { id: string }): Promise<ToolResult> {
  try {
    const data = (await callApi(`/artifacts/${encodeURIComponent(args.id)}/versions`, {
      ...ctx,
    })) as { items: VersionPayload[] };
    if (!data.items.length) return ok('该作品还没有历史版本。');
    const lines = data.items.map(
      (v) => `- v${v.version}　${v.title}　（${new Date(v.createdAt).toLocaleString('zh-CN')}）`
    );
    return ok(
      [`共 ${data.items.length} 个版本（新→旧）：`, ...lines, '', '用 restore_version 恢复到指定版本。'].join('\n')
    );
  } catch (e) {
    return fail(e);
  }
}

export const restoreVersionSchema = {
  id: z.string().min(1).describe('作品 id'),
  version: z.number().int().positive().describe('要恢复到的版本号（用 list_versions 查看）'),
};

export async function restoreVersion(
  ctx: ApiContext,
  args: { id: string; version: number }
): Promise<ToolResult> {
  try {
    const data = (await callApi(
      `/artifacts/${encodeURIComponent(args.id)}/versions/${args.version}/restore`,
      { ...ctx, method: 'POST' }
    )) as { artifact: ArtifactPayload };
    const origin = siteOrigin(ctx.baseUrl);
    return ok(
      [
        `已恢复到 v${args.version}：${data.artifact.title}`,
        `链接：${origin}/a/${data.artifact.slug}`,
        '恢复前的内容已另存为新版本，可再回滚。',
      ].join('\n')
    );
  } catch (e) {
    return fail(e);
  }
}

// ---------- get_platform_capabilities ----------
//
// 让 Agent 在**动笔之前**就知道能用什么，而不是写完发布再撞一次 IMPORT_NOT_ALLOWED。
// 数据来自 scripts/gen-whitelist.mjs 的生成物（真值 runner/vendor.config.mjs），不手抄。

export const getPlatformCapabilitiesSchema = {};

export function platformCapabilitiesText(): string {
  const pkgs = WHITELIST_PACKAGES.filter((p) => !p.subpath);
  return [
    'Artifacts 平台能力与约束',
    '',
    '## 作品类型',
    '- react：单文件 React 组件（TSX/JSX），必须 export default 根组件',
    '- html：完整 HTML 文档',
    '',
    '## 硬约束',
    ...PLATFORM_RULES.map((r) => `- ${r}`),
    '',
    `## 可用依赖（${pkgs.length} 个包）`,
    ...pkgs.map((p) => `- ${p.name}${p.version ? `@${p.version}` : ''}`),
    '',
    `## shadcn/ui 组件（${UI_COMPONENTS.length} 个，导入 @/components/ui/<name>）`,
    UI_COMPONENTS.join('、'),
    '',
    '还可导入 @/lib/utils 的 cn()。react 的子路径（react-dom/client、react/jsx-runtime）同样可用。',
  ].join('\n');
}

export async function getPlatformCapabilities(): Promise<ToolResult> {
  return ok(platformCapabilitiesText());
}
