// 平台 HTTP API 客户端（契约 §3.8 MCP 小节）：纯函数式，baseUrl / token / fetch 均可注入便于测试
/** 默认 API base（生产环境） */
export const DEFAULT_API_BASE = 'https://artifacts.orienthong.cn/api';

/** API 调用上下文：由环境变量解析（resolveConfig），测试时直接构造 */
export interface ApiContext {
  baseUrl: string;
  token: string;
  fetchFn?: typeof fetch;
}

/**
 * 从环境变量解析配置。
 * ARTIFACTS_TOKEN 必填，缺失抛中文错误（index.ts 捕获后 stderr 报错退出）；
 * ARTIFACTS_API_BASE 缺省为生产地址。
 */
export function resolveConfig(
  env: Record<string, string | undefined> = process.env
): { baseUrl: string; token: string } {
  const token = env.ARTIFACTS_TOKEN?.trim();
  if (!token) {
    throw new Error(
      '缺少环境变量 ARTIFACTS_TOKEN。请先在 https://artifacts.orienthong.cn/developers 创建 API Token，' +
        '并通过环境变量传入（例如 claude mcp add artifacts --env ARTIFACTS_TOKEN=ak_xxx -- artifacts-mcp）。'
    );
  }
  return { baseUrl: env.ARTIFACTS_API_BASE?.trim() || DEFAULT_API_BASE, token };
}

/** 由 API base 派生站点 origin（去掉尾部 /api），用于拼作品 / 临时链接 URL */
export function siteOrigin(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/api$/, '');
}

/**
 * 统一 API 调用：拼 Bearer 头、发 JSON、非 2xx 抛 Error（中文 error 字段透传，
 * 401 附加检查 ARTIFACTS_TOKEN 提示），网络失败给可操作提示。
 */
export async function callApi(
  path: string,
  opts: ApiContext & { method?: string; body?: unknown }
): Promise<unknown> {
  const { baseUrl, token, method = 'GET', body } = opts;
  const fetchFn = opts.fetchFn ?? fetch;
  const url = baseUrl.replace(/\/+$/, '') + path;

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `无法连接 Artifacts API（${url}）：${msg}。请检查网络连接与 ARTIFACTS_API_BASE 配置。`
    );
  }

  if (!res.ok) {
    let apiError: string | undefined;
    try {
      const data = (await res.json()) as { error?: unknown };
      if (typeof data?.error === 'string' && data.error) apiError = data.error;
    } catch {
      // 响应不是 JSON（如网关错误页），走状态码提示
    }
    if (res.status === 401) {
      throw new Error(
        `${apiError ?? '鉴权失败'}（HTTP 401：请检查 ARTIFACTS_TOKEN 是否有效或已被撤销）`
      );
    }
    throw new Error(apiError ?? `请求失败（HTTP ${res.status}）`);
  }

  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}
