// 云端机审处置策略单测（契约 §3.3）
import { describe, it, expect } from 'vitest';
import {
  verdictFromRiskLevels,
  resolveReviewStatus,
  selectModerationFields,
  violatesPolicy,
} from '../src/moderation.js';
import { env } from '../src/env.js';

describe('verdictFromRiskLevels', () => {
  it('high 优先 → reject', () => {
    expect(verdictFromRiskLevels(['none', 'high', 'low'])).toBe('reject');
  });
  it('medium → review', () => {
    expect(verdictFromRiskLevels(['low', 'medium'])).toBe('review');
  });
  it('low/none/空 → pass', () => {
    expect(verdictFromRiskLevels(['none', 'low'])).toBe('pass');
    expect(verdictFromRiskLevels([])).toBe('pass');
  });
});

describe('resolveReviewStatus', () => {
  const base = { visibility: 'public', isAdmin: false, isTrusted: false, cloud: 'pass' as const };
  it('非 public / 管理员 一律 approved', () => {
    expect(resolveReviewStatus({ ...base, visibility: 'unlisted' })).toBe('approved');
    expect(resolveReviewStatus({ ...base, isAdmin: true })).toBe('approved');
  });
  it('cloud review/unavailable → pending（trusted 也不豁免）', () => {
    expect(resolveReviewStatus({ ...base, isTrusted: true, cloud: 'review' })).toBe('pending');
    expect(resolveReviewStatus({ ...base, isTrusted: true, cloud: 'unavailable' })).toBe('pending');
  });
  it('cloud pass → approved（机审通过即上广场，不看 trusted；2026-07-27 修订）', () => {
    expect(resolveReviewStatus(base)).toBe('approved');
    expect(resolveReviewStatus({ ...base, isTrusted: true })).toBe('approved');
  });
  it('cloud disabled（未配置 AK）→ 无机审依据，回退 trusted 闸门', () => {
    expect(resolveReviewStatus({ ...base, cloud: 'disabled' })).toBe('pending');
    expect(resolveReviewStatus({ ...base, isTrusted: true, cloud: 'disabled' })).toBe('approved');
  });
});

describe('selectModerationFields（PUT 云审字段选择，契约 §3.3）', () => {
  const current = {
    review_status: 'approved',
    visibility: 'public',
    title: '旧标题',
    description: '旧描述',
    code: '<p>旧代码</p>',
  };

  it('pending 作品：合并后全量重审（局部 PUT 补齐库中现值，空 PUT 也全量）', () => {
    const pending = { ...current, review_status: 'pending' };
    expect(selectModerationFields(pending, { title: '新标题' })).toEqual({
      fields: ['新标题', '旧描述', '<p>旧代码</p>'],
      full: true,
    });
    // 空内容 PUT（如仅改 visibility）同样全量重审，不能借空 PUT 洗白
    expect(selectModerationFields(pending, {})).toEqual({
      fields: ['旧标题', '旧描述', '<p>旧代码</p>'],
      full: true,
    });
    // description=null 表示清除：合并结果取 null 而非库中旧值
    expect(selectModerationFields(pending, { description: null })).toEqual({
      fields: ['旧标题', null, '<p>旧代码</p>'],
      full: true,
    });
  });

  it('非 pending 且内容变更：仅送审变更字段', () => {
    expect(selectModerationFields(current, { title: '新标题' })).toEqual({
      fields: ['新标题', undefined, undefined],
      full: false,
    });
  });

  it('非 pending 且内容未变更（仅密码/降可见性）：无需云审返回 null', () => {
    expect(selectModerationFields(current, {})).toBeNull();
    // public → public（visibility 带上但没变）同样不触发补审
    expect(selectModerationFields(current, { visibility: 'public' })).toBeNull();
    // 降可见性（public → unlisted）不上广场，无需云审
    expect(selectModerationFields(current, { visibility: 'unlisted' })).toBeNull();
  });

  it('转 public：合并后全量补审，内容未变也不能免审上广场（契约 §3.3 转公开补审）', () => {
    const unlisted = { ...current, visibility: 'unlisted' };
    expect(selectModerationFields(unlisted, { visibility: 'public' })).toEqual({
      fields: ['旧标题', '旧描述', '<p>旧代码</p>'],
      full: true,
    });
    // 转 public + 局部内容变更：同样全量——未变字段可能藏着保存时判为 medium 的内容
    expect(selectModerationFields(unlisted, { visibility: 'public', title: '新标题' })).toEqual({
      fields: ['新标题', '旧描述', '<p>旧代码</p>'],
      full: true,
    });
  });
});

describe('MODERATION_MODE=off（开源单用户模式，dual-track roadmap OS-2）', () => {
  // env 属性为进程内可写对象——用例内切换并复原，避免污染同文件其余用例
  function withOff<T>(fn: () => T): T {
    const prev = env.MODERATION_MODE;
    (env as { MODERATION_MODE: string }).MODERATION_MODE = 'off';
    try {
      return fn();
    } finally {
      (env as { MODERATION_MODE: string }).MODERATION_MODE = prev;
    }
  }

  it('off 时 resolveReviewStatus 一律 approved——单用户实例没有「转人工」的人', () => {
    withOff(() => {
      expect(
        resolveReviewStatus({ visibility: 'public', isAdmin: false, isTrusted: false, cloud: 'disabled' })
      ).toBe('approved');
      expect(
        resolveReviewStatus({ visibility: 'public', isAdmin: false, isTrusted: false, cloud: 'unavailable' })
      ).toBe('approved');
    });
  });

  it('off 时 violatesPolicy 恒 false——自己对自己的内容负责，词表不拦', () => {
    withOff(() => {
      expect(violatesPolicy(['测试违禁词'])).toBe(false);
    });
  });

  it('默认 cloud 模式行为不变（SaaS 现行为回归守卫）', () => {
    expect(env.MODERATION_MODE).toBe('cloud');
    expect(
      resolveReviewStatus({ visibility: 'public', isAdmin: false, isTrusted: false, cloud: 'disabled' })
    ).toBe('pending');
    expect(violatesPolicy(['测试违禁词'])).toBe(true);
  });
});
