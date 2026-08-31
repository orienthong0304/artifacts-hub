/**
 * 类型化 API 客户端（契约第 3 节）
 * 所有请求携带 cookie（JWT httpOnly cookie：artifacts_token）
 */
import { API_BASE } from '@/app/config';

// ===== 领域类型 =====

export type ArtifactType = 'react' | 'html';
export type Visibility = 'public' | 'unlisted' | 'private';

export interface User {
  id: string;
  /** 仅本人可见 */
  email?: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  isAdmin: boolean;
  /** 已领取的子域前缀（契约 §3.10）：null=未领取，一次性不可更改 */
  subdomainPrefix: string | null;
  /** 档位标签（契约 §3.12）：仅 GET /api/me 返回 */
  plan?: 'free' | 'member' | string;
  /** 配额生效值（契约 §3.12，0 = 不限）：仅 GET /api/me 返回——前端配额展示的唯一真值 */
  quotas?: { customPaths: number; sites: number; apiTokens: number; dailyCreates: number };
  createdAt: string;
}

export interface ArtifactAuthor {
  username: string;
  displayName: string | null;
}

export interface Artifact {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  type: ArtifactType;
  visibility: Visibility;
  views: number;
  /** 列表接口不含 code，详情接口含 */
  code?: string;
  /** 是否设置了访问密码（契约 §3.1；任何接口都不返回哈希或明文） */
  hasPassword: boolean;
  /** 详情接口的锁定形态：需要访问密码才能查看（此时无 code/description/views） */
  locked?: boolean;
  /** 审核状态（契约 §3.3）：pending 的 public 作品不进广场，持链接可看 */
  reviewStatus: 'approved' | 'pending';
  /** 生成合成内容声明（契约 §3.11）：true = 需显著标识；缺省 true */
  aiGenerated: boolean;
  isTakenDown: boolean;
  /** 自定义路径（契约 §3.10）：null=未设置 */
  customPath: string | null;
  /** 子域完整地址：https://<前缀>.artifacts.orienthong.cn/<路径>；未设路径或作者未领前缀为 null */
  customUrl: string | null;
  createdAt: string;
  updatedAt: string;
  author: ArtifactAuthor;
}

export interface ExploreResult {
  items: Artifact[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Report {
  id: string;
  reason: string;
  createdAt: string;
  reporter: { username: string } | null;
  /** 举报对应的 artifact 摘要 */
  artifact?: Artifact;
}

/** API 错误：统一 { error: "人类可读中文信息" } */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

// ===== 基础请求封装 =====

/** 统一解析响应：204 → undefined；非 2xx → ApiError（取 {error} 中文文案） */
async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // 非 JSON 响应（如网关错误）
  }

  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ||
      `请求失败（HTTP ${res.status}）`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

async function request<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...init } = options;
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });
  return parseResponse<T>(res);
}

/** multipart 请求：body 用 FormData，不设 Content-Type（浏览器自动附带 boundary） */
async function requestForm<T>(
  path: string,
  method: 'POST' | 'PUT',
  form: FormData,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    body: form,
  });
  return parseResponse<T>(res);
}

// ===== 访问令牌（契约 §3.1：按 slug 存 sessionStorage，关标签页即失效） =====

const ACCESS_TOKEN_PREFIX = 'artifact-access:';

export function getAccessToken(slug: string): string | null {
  try {
    return sessionStorage.getItem(`${ACCESS_TOKEN_PREFIX}${slug}`);
  } catch {
    // 无痕模式等场景 sessionStorage 可能不可用
    return null;
  }
}

export function setAccessToken(slug: string, token: string): void {
  try {
    sessionStorage.setItem(`${ACCESS_TOKEN_PREFIX}${slug}`, token);
  } catch {
    // 存储不可用时静默失败（仅影响本次会话内免密）
  }
}

// ===== 认证 =====

export const authApi = {
  register(input: { email: string; password: string; username: string; agreeTerms: boolean }) {
    return request<{ user: User }>('/auth/register', { method: 'POST', json: input });
  },
  login(input: { email: string; password: string }) {
    return request<{ user: User }>('/auth/login', { method: 'POST', json: input });
  },
  logout() {
    return request<void>('/auth/logout', { method: 'POST' });
  },
  me() {
    return request<{ user: User }>('/me');
  },
};

// ===== 当前用户设置（契约 §3.10） =====

export const meApi = {
  /** 领取子域前缀（一次性，不可更改；仅 cookie 会话可调） */
  claimSubdomain(prefix: string) {
    return request<{ user: User }>('/me/subdomain', {
      method: 'POST',
      json: { prefix },
    });
  },
};

// ===== Artifact =====

export interface CreateArtifactInput {
  title: string;
  description?: string;
  type: ArtifactType;
  code: string;
  visibility: Visibility;
  /** 生成合成内容声明（契约 §3.11）；缺省 true */
  aiGenerated?: boolean;
  /** 可选访问密码（4-64 位）；缺省 = 不设 */
  accessPassword?: string;
}

export type UpdateArtifactInput = Partial<
  Pick<CreateArtifactInput, 'title' | 'description' | 'code' | 'visibility' | 'aiGenerated'>
> & {
  /** 字符串（4-64 位）= 设置/更换密码；null = 清除密码；缺省 = 不变 */
  accessPassword?: string | null;
};

export const artifactApi = {
  /** 我的全部（含 private），按 updated_at 倒序 */
  listMine(params: { q?: string; type?: ArtifactType } = {}) {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.type) qs.set('type', params.type);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ items: Artifact[] }>(`/artifacts${suffix}`);
  },
  create(input: CreateArtifactInput) {
    return request<{ artifact: Artifact }>('/artifacts', { method: 'POST', json: input });
  },
  /** 详情（含 code）；private 仅作者，public 访问自增 views；有密码时自动携带访问令牌 */
  get(slug: string) {
    const token = getAccessToken(slug);
    return request<{ artifact: Artifact }>(`/artifacts/${encodeURIComponent(slug)}`, {
      ...(token ? { headers: { 'X-Access-Token': token } } : {}),
    });
  },
  /** 用访问密码换取 24h 访问令牌（契约 §3.1） */
  unlock(slug: string, password: string) {
    return request<{ accessToken: string }>(
      `/artifacts/${encodeURIComponent(slug)}/unlock`,
      { method: 'POST', json: { password } },
    );
  },
  update(id: string, input: UpdateArtifactInput) {
    return request<{ artifact: Artifact }>(`/artifacts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      json: input,
    });
  },
  /** 设置/清除自定义路径（契约 §3.10）：传 null 清除；未领前缀 400、配额超限 403、重复 409 */
  setCustomPath(id: string, customPath: string | null) {
    return request<{ artifact: Artifact }>(
      `/artifacts/${encodeURIComponent(id)}/custom-path`,
      { method: 'PUT', json: { customPath } },
    );
  },
  /** 批量改可见性；返回实际更新数量（非本人作品会被后端跳过） */
  /**
   * 批量改可见性。返回 items 为受影响作品的服务端真值——**必须用它覆盖本地状态**，
   * 不要做乐观更新：pending 作品改 public 时服务端会保留 pending（先审后展，契约 §3.3），
   * 乐观更新会让 UI 显示「公开」而作品实际不在广场。
   */
  batchVisibility(ids: string[], visibility: Visibility) {
    return request<{ updated: number; items: Artifact[] }>('/artifacts/batch-visibility', {
      method: 'POST',
      json: { ids, visibility },
    });
  },
  remove(id: string) {
    return request<void>(`/artifacts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  /** 广场：仅 public 且未下架；sort 缺省 = latest（created_at 倒序），hot = views 倒序 */
  explore(
    params: {
      q?: string;
      type?: ArtifactType;
      page?: number;
      pageSize?: number;
      sort?: 'latest' | 'hot';
    } = {}
  ) {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.type) qs.set('type', params.type);
    if (params.sort) qs.set('sort', params.sort);
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<ExploreResult>(`/explore${suffix}`);
  },
  report(id: string, reason: string) {
    return request<void>(`/artifacts/${encodeURIComponent(id)}/report`, {
      method: 'POST',
      json: { reason },
    });
  },
};

// ===== 版本历史（契约 §3.7） =====

export interface ArtifactVersion {
  id: string;
  version: number;
  title: string;
  /** 仅单版本详情接口返回 */
  description?: string | null;
  /** 仅单版本详情接口返回；列表不含 code */
  code?: string;
  createdAt: string;
}

export const versionApi = {
  /** 版本列表（仅作者）：按 version 倒序，不含 code；每作品最多保留 20 版 */
  list(artifactId: string) {
    return request<{ items: ArtifactVersion[] }>(
      `/artifacts/${encodeURIComponent(artifactId)}/versions`,
    );
  },
  /** 单版本详情（仅作者，含完整快照内容） */
  get(artifactId: string, version: number) {
    return request<{ version: ArtifactVersion }>(
      `/artifacts/${encodeURIComponent(artifactId)}/versions/${version}`,
    );
  },
  /** 一键恢复（仅作者）：照走全部审核闸门；当前内容会先存为新版本，可再恢复回来 */
  restore(artifactId: string, version: number) {
    return request<{ artifact: Artifact }>(
      `/artifacts/${encodeURIComponent(artifactId)}/versions/${version}/restore`,
      { method: 'POST' },
    );
  },
};

// ===== 临时链接（契约 §3.6） =====

/** 临时链接有效期档位（小时） */
export type TempLinkExpiresInHours = 1 | 6 | 12 | 24 | 72 | 168 | 720;

export interface TempLink {
  id: string;
  token: string;
  expiresAt: string;
  note: string | null;
  /** 是否已过期（列表含已过期条目；惰性过期，公开端点访问即 404） */
  expired: boolean;
  createdAt: string;
}

export const tempLinkApi = {
  /** 创建临时链接（仅作者）；每作品有效链接上限 20 */
  create(
    artifactId: string,
    input: { expiresInHours: TempLinkExpiresInHours; note?: string },
  ) {
    return request<{ tempLink: TempLink }>(
      `/artifacts/${encodeURIComponent(artifactId)}/temp-links`,
      { method: 'POST', json: input },
    );
  },
  /** 未撤销的全部临时链接（含已过期），按创建时间倒序（仅作者） */
  list(artifactId: string) {
    return request<{ items: TempLink[] }>(
      `/artifacts/${encodeURIComponent(artifactId)}/temp-links`,
    );
  },
  /** 撤销（仅作者，按 temp link id）：撤销后立即失效 */
  revoke(id: string) {
    return request<void>(`/temp-links/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  /** 公开访问：有效返回与详情一致的 artifact（含 code，豁免可见性与密码）；否则 404 */
  resolve(token: string) {
    return request<{ artifact: Artifact; tempLink: { expiresAt: string } }>(
      `/t/${encodeURIComponent(token)}`,
    );
  },
};

// ===== API Token（契约 §3.8） =====

/** Token 元信息：绝不含明文或哈希（明文只在创建响应出现一次） */
export interface ApiTokenInfo {
  id: string;
  label: string;
  /** 明文末四位（展示用 ak_…xxxx） */
  lastFour: string;
  /** 最近一次 Bearer 命中时间；从未使用为 null */
  lastUsedAt: string | null;
  createdAt: string;
}

export const tokenApi = {
  /** 创建（仅 cookie 会话可调）：响应中的 token 明文仅此一次，请立即保存 */
  create(label?: string) {
    return request<{ token: string; tokenInfo: ApiTokenInfo }>('/tokens', {
      method: 'POST',
      json: label ? { label } : {},
    });
  },
  /** 有效（未撤销）Token 列表，按创建时间倒序 */
  list() {
    return request<{ items: ApiTokenInfo[] }>('/tokens');
  },
  /** 撤销：置 revoked_at，对应 Bearer 立即失效 */
  revoke(id: string) {
    return request<void>(`/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};

// ===== ZIP 站点托管（契约 §3.9） =====

export interface Site {
  id: string;
  slug: string;
  /** 自定义子域前缀（创建后不可改） */
  subdomain: string;
  title: string;
  /** 公开访问地址：https://<subdomain>.artifacts.orienthong.cn/ */
  url: string;
  sizeBytes: number;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

export const siteApi = {
  /** 本人全部站点，updated_at 倒序 */
  list() {
    return request<{ items: Site[] }>('/sites');
  },
  /**
   * 上传 ZIP 发布站点；subdomain 为自定义子域前缀（3-30 位小写字母/数字/连字符）。
   * 前缀非法/保留字 400、重复 409、配额超限 400、限流 429、审核不可用 503（均中文文案）
   */
  create(file: File, title: string, subdomain: string) {
    const form = new FormData();
    form.set('file', file);
    form.set('title', title);
    form.set('subdomain', subdomain);
    return requestForm<{ site: Site }>('/sites', 'POST', form);
  },
  /** 重新上传 ZIP 原子替换站点内容（链接不变）；title 缺省 = 不改 */
  update(id: string, file: File, title?: string) {
    const form = new FormData();
    form.set('file', file);
    if (title !== undefined) form.set('title', title);
    return requestForm<{ site: Site }>(`/sites/${encodeURIComponent(id)}`, 'PUT', form);
  },
  remove(id: string) {
    return request<void>(`/sites/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};

// ===== 用户 =====

export const userApi = {
  /** 用户公开主页：仅 public 且未下架的作品 */
  get(username: string) {
    return request<{ user: User; artifacts: Artifact[] }>(
      `/users/${encodeURIComponent(username)}`,
    );
  },
};

// ===== 管理员 =====

export const adminApi = {
  /** 未处理举报列表（含 artifact 摘要） */
  reports() {
    return request<{ items: Report[] }>('/admin/reports');
  },
  takedown(artifactId: string, takenDown: boolean) {
    return request<{ artifact: Artifact }>(
      `/admin/artifacts/${encodeURIComponent(artifactId)}/takedown`,
      { method: 'POST', json: { takenDown } },
    );
  },
  /** 待审核作品列表（public + pending + 未下架） */
  pending() {
    return request<{ items: Artifact[] }>('/admin/pending');
  },
  /** 审核：approve 过审并信任作者；reject 下架 */
  review(artifactId: string, action: 'approve' | 'reject') {
    return request<{ artifact: Artifact }>(
      `/admin/artifacts/${encodeURIComponent(artifactId)}/review`,
      { method: 'POST', json: { action } },
    );
  },
  /** 用户列表（契约 §3.12）：分页 + username/email 模糊搜索 */
  users(params: { q?: string; page?: number; pageSize?: number } = {}) {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ items: AdminUser[]; total: number; page: number; pageSize: number }>(
      `/admin/users${suffix}`,
    );
  },
  /** 调整用户（契约 §3.12）：plan / trusted / 逐项配额覆盖（null 删除该项回落档位默认） */
  updateUser(
    id: string,
    patch: {
      plan?: 'free' | 'member';
      isTrusted?: boolean;
      quotaOverrides?: Partial<Record<QuotaKey, number | null>>;
    },
  ) {
    return request<{ user: AdminUser }>(`/admin/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      json: patch,
    });
  },
};

/** 配额项键（契约 §3.12） */
export type QuotaKey = 'customPaths' | 'sites' | 'apiTokens' | 'dailyCreates';

/** Admin 用户行（契约 §3.12） */
export interface AdminUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  plan: 'free' | 'member' | string;
  isTrusted: boolean;
  quotaOverrides: Partial<Record<QuotaKey, number>>;
  stats: { artifacts: number; sites: number; customPaths: number; activeTokens: number };
  createdAt: string;
}
