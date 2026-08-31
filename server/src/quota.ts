// 配额解析（契约 §3.12）：admin 豁免 → 逐项覆盖 → 档位默认 三级
//
// 为什么收拢成单点：此前四个配额点各自散落一个常量（路径 3 / 站点 1 / Token 5 / 日发布 10），
// 前端还各留一份硬编码副本（Z2 波已记过 FREE_QUOTA 漂移债）。会员体系（plan 标签 +
// 逐项覆盖，管理员手工运营）引入后若继续散落，每调一档要改四处——这里是唯一真值，
// 前端展示由 GET /api/me 的 quotas 下发。
import { env } from './env.js';
import type { UserRow } from './db.js';

export const QUOTA_KEYS = ['customPaths', 'sites', 'apiTokens', 'dailyCreates'] as const;
export type QuotaKey = (typeof QUOTA_KEYS)[number];

/** 每用户逐项覆盖（users.quota_overrides jsonb）：值 int ≥ 0，0 = 不限；缺键回落档位 */
export type QuotaOverrides = Partial<Record<QuotaKey, number>>;

/**
 * 档位默认表（契约 §3.12）。0 = 不限。
 * free 档 2026-08-31 放宽（路径 3→10、Token 5→10、站点默认 1→3）：放宽后的上限是
 * 资源护栏与会员差异的基础，不是免费墙；dailyCreates 保持 10 —— 它是防批量灌垃圾的
 * 护栏（trusted 豁免维持），不是权益分层。
 * sites 走 env.SITE_QUOTA_PER_USER：保留既有的运营临时放量开关。
 */
export const PLAN_DEFAULTS: Record<'free' | 'member', Record<QuotaKey, number>> = {
  free: {
    customPaths: 10,
    sites: env.SITE_QUOTA_PER_USER,
    apiTokens: 10,
    dailyCreates: 10,
  },
  member: { customPaths: 0, sites: 0, apiTokens: 0, dailyCreates: 0 },
};

/** 合法覆盖值：int ≥ 0（DB 端刻意无 check 约束，应用层兜底脏值） */
function validOverride(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * 三级解析生效配额（0 = 不限）：
 * 1. admin 全豁免——此前 admin 也被四项配额挡住，属缺陷；
 * 2. quota_overrides[key]（合法时优先，0 也是有效值=不限；回落用删除键表达）；
 * 3. 档位默认（未知 plan 按 free——历史脏值不应让接口 500）。
 */
export function effectiveQuota(user: UserRow, key: QuotaKey): number {
  if (user.is_admin) return 0;
  const override = user.quota_overrides?.[key];
  if (validOverride(override)) return override;
  const plan = user.plan === 'member' ? 'member' : 'free';
  return PLAN_DEFAULTS[plan][key];
}

/** 统一判定：limit 0 = 不限；否则计数须小于上限 */
export function withinQuota(count: number, limit: number): boolean {
  return limit === 0 || count < limit;
}

/**
 * admin PUT 入参 → 存储形态：与既存 overrides 逐键合并；
 * null 删除该键（回落档位默认）；int ≥ 0 写入；其余值忽略（zod 已前置校验，此处兜底）。
 */
export function sanitizeOverrides(
  existing: QuotaOverrides,
  patch: Partial<Record<QuotaKey, number | null>>
): QuotaOverrides {
  const next: QuotaOverrides = { ...existing };
  for (const key of QUOTA_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === null) {
      delete next[key];
    } else if (validOverride(value)) {
      next[key] = value;
    }
  }
  return next;
}

/** GET /api/me 的 quotas 出参：四项生效值（0 = 不限），前端配额展示的唯一真值 */
export function quotasForUser(user: UserRow): Record<QuotaKey, number> {
  return Object.fromEntries(QUOTA_KEYS.map((key) => [key, effectiveQuota(user, key)])) as Record<
    QuotaKey,
    number
  >;
}
