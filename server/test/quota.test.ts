// 配额解析（契约 §3.12）：admin 豁免 → 逐项覆盖 → 档位默认 三级
//
// 为什么集中成一个纯函数：此前四个配额点各自散落一个常量（3/1/5/10），前端还各留一份
// 硬编码副本（Z2 波已记过 FREE_QUOTA 漂移债）。会员体系引入后若继续散落，每加一档就要
// 改四处——收拢为 effectiveQuota 单点，前端配额展示也由 /api/me 下发真值。
import { describe, it, expect } from 'vitest';
import { effectiveQuota, withinQuota, PLAN_DEFAULTS, sanitizeOverrides } from '../src/quota.js';
import type { UserRow } from '../src/db.js';

function fakeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'u1',
    email: 'u@test.local',
    username: 'u',
    password_hash: 'x',
    display_name: null,
    bio: null,
    is_admin: false,
    is_trusted: false,
    subdomain_prefix: null,
    plan: 'free',
    quota_overrides: {},
    created_at: new Date(),
    ...overrides,
  } as UserRow;
}

describe('effectiveQuota（契约 §3.12 三级解析）', () => {
  it('free 档默认值：路径 10 / Token 10 / 日发布 10；sites 走 env（测试环境默认 3）', () => {
    const u = fakeUser();
    expect(effectiveQuota(u, 'customPaths')).toBe(10);
    expect(effectiveQuota(u, 'apiTokens')).toBe(10);
    expect(effectiveQuota(u, 'dailyCreates')).toBe(10);
    expect(effectiveQuota(u, 'sites')).toBe(3);
  });

  it('member 档全部 0 = 不限', () => {
    const u = fakeUser({ plan: 'member' });
    for (const key of ['customPaths', 'sites', 'apiTokens', 'dailyCreates'] as const) {
      expect(effectiveQuota(u, key)).toBe(0);
    }
  });

  it('admin 全豁免——优先于档位与覆盖（此前 admin 也被配额挡住，属缺陷）', () => {
    const u = fakeUser({ is_admin: true, plan: 'free', quota_overrides: { customPaths: 1 } });
    expect(effectiveQuota(u, 'customPaths')).toBe(0);
  });

  it('逐项覆盖优先于档位默认；未覆盖的项回落档位', () => {
    const u = fakeUser({ quota_overrides: { customPaths: 50 } });
    expect(effectiveQuota(u, 'customPaths')).toBe(50);
    expect(effectiveQuota(u, 'apiTokens')).toBe(10);
  });

  it('覆盖值 0 表示该项不限（不是「回落默认」——回落用删除键表达）', () => {
    const u = fakeUser({ quota_overrides: { sites: 0 } });
    expect(effectiveQuota(u, 'sites')).toBe(0);
  });

  it('非法覆盖值（负数/非整数/字符串）忽略，回落档位默认——DB 无 check 约束，应用层兜底', () => {
    const u = fakeUser({
      quota_overrides: { customPaths: -1, sites: 1.5, apiTokens: '99' } as never,
    });
    expect(effectiveQuota(u, 'customPaths')).toBe(10);
    expect(effectiveQuota(u, 'sites')).toBe(3);
    expect(effectiveQuota(u, 'apiTokens')).toBe(10);
  });

  it('未知 plan 按 free 处理——历史数据或手工 SQL 写入的脏值不应让接口 500', () => {
    const u = fakeUser({ plan: 'vip' as never });
    expect(effectiveQuota(u, 'customPaths')).toBe(PLAN_DEFAULTS.free.customPaths);
  });
});

describe('withinQuota', () => {
  it('0 = 不限，任意计数都放行', () => {
    expect(withinQuota(999999, 0)).toBe(true);
  });
  it('计数达到上限即拒绝（10 中的第 11 个）', () => {
    expect(withinQuota(9, 10)).toBe(true);
    expect(withinQuota(10, 10)).toBe(false);
  });
});

describe('sanitizeOverrides（admin PUT 入参 → 存储形态）', () => {
  it('null 删除该键（回落档位默认）；int≥0 写入；与既存合并', () => {
    expect(
      sanitizeOverrides({ customPaths: 5, sites: 2 }, { customPaths: null, apiTokens: 30 })
    ).toEqual({ sites: 2, apiTokens: 30 });
  });
});
