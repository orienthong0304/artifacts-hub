// DB 行（snake_case）→ API 出参（camelCase）转换（契约文档第 3 节）
import type { UserRow, ArtifactWithAuthorRow } from './db.js';
import { quotasForUser } from './quota.js';
import { env } from './env.js';

/**
 * user 对象（对外）：email 仅本人可见。
 * includeQuotas（契约 §3.12，GET /api/me）：带 plan 与四项配额生效值（0 = 不限）——
 * 前端一切配额展示以此为真值，不得再保留硬编码副本（Z2 波 FREE_QUOTA 漂移教训）。
 */
export function serializeUser(
  row: UserRow,
  opts: { includeEmail?: boolean; includeQuotas?: boolean } = {}
): Record<string, unknown> {
  return {
    id: row.id,
    ...(opts.includeEmail ? { email: row.email } : {}),
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    isAdmin: row.is_admin,
    subdomainPrefix: row.subdomain_prefix ?? null,
    ...(opts.includeQuotas ? { plan: row.plan ?? 'free', quotas: quotasForUser(row) } : {}),
    createdAt: row.created_at.toISOString(),
  };
}

/** artifact 对象：列表接口不含 code，详情接口含；hasPassword 由哈希是否存在派生，绝不输出哈希 */
export function serializeArtifact(
  row: ArtifactWithAuthorRow,
  opts: { includeCode?: boolean } = {}
): Record<string, unknown> {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    type: row.type,
    visibility: row.visibility,
    views: row.views,
    ...(opts.includeCode ? { code: row.code } : {}),
    hasPassword: row.access_password_hash != null,
    reviewStatus: row.review_status,
    aiGenerated: row.ai_generated,
    isTakenDown: row.is_taken_down,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    customPath: row.custom_path ?? null,
    customUrl:
      row.custom_path && row.author_subdomain_prefix
        ? `https://${row.author_subdomain_prefix}.${env.SITES_DOMAIN_SUFFIX}/${row.custom_path}`
        : null,
    author: {
      username: row.author_username,
      displayName: row.author_display_name,
    },
  };
}

/**
 * 锁定形态（契约 §3.1）：设有访问密码且请求者无权限时的详情出参。
 * 只暴露基础元信息，不含 code / description / views，更不含哈希。
 */
export function serializeLockedArtifact(row: ArtifactWithAuthorRow): Record<string, unknown> {
  return {
    slug: row.slug,
    title: row.title,
    type: row.type,
    visibility: row.visibility,
    hasPassword: true,
    locked: true,
    author: {
      username: row.author_username,
      displayName: row.author_display_name,
    },
    createdAt: row.created_at.toISOString(),
  };
}
