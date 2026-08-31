// Admin 用户管理（契约 §3.12）：列表/搜索/分页 + plan/overrides/trusted 调整
//
// 这是双版本战略里 SaaS 版的运营底座：付费先不接支付渠道，站长手工收款后在这里
// 调档位与配额。核心性质：调整后配额立即生效（无缓存层，effectiveQuota 每请求现算）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app, pool, initSchema, resetDb, registerUser } from './helpers.js';

async function registerAdmin(): Promise<{ cookie: string }> {
  return registerUser('bossadmin', 'admin@test.local');
}

function putUser(cookie: string, id: string, body: Record<string, unknown>) {
  return app.request(`/api/admin/users/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

interface AdminUserRow {
  id: string;
  username: string;
  email: string;
  plan: string;
  isTrusted: boolean;
  quotaOverrides: Record<string, number>;
  stats: { artifacts: number; sites: number; customPaths: number; activeTokens: number };
}

describe('Admin 用户管理（契约 §3.12）', () => {
  let admin: string;
  let aliceId: string;

  beforeAll(async () => {
    await initSchema();
    await resetDb();
    admin = (await registerAdmin()).cookie;
    const { cookie: alice } = await registerUser('alice');
    // 造一点统计数据：1 个作品 + 1 个 token
    await app.request('/api/artifacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice },
      body: JSON.stringify({ title: '统计用', type: 'html', code: '<h1>x</h1>' }),
    });
    await app.request('/api/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice },
      body: JSON.stringify({ label: 't' }),
    });
    const row = await pool.query<{ id: string }>(`select id from users where username = 'alice'`);
    aliceId = row.rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('列表：分页 + 统计聚合；搜索命中 username', async () => {
    const res = await app.request('/api/admin/users?q=alice', { headers: { cookie: admin } });
    expect(res.status).toBe(200);
    const { items, total } = (await res.json()) as { items: AdminUserRow[]; total: number };
    expect(total).toBe(1);
    expect(items[0].username).toBe('alice');
    expect(items[0].plan).toBe('free');
    expect(items[0].stats.artifacts).toBe(1);
    expect(items[0].stats.activeTokens).toBe(1);
    expect(items[0].stats.sites).toBe(0);
  });

  it('调整 plan → member 后配额立即生效：连发 11 个 token 全部成功（free 档上限 10）', async () => {
    const { cookie: bob } = await registerUser('bob');
    const bobRow = await pool.query<{ id: string }>(`select id from users where username = 'bob'`);
    const put = await putUser(admin, bobRow.rows[0].id, { plan: 'member' });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { user: AdminUserRow }).user.plan).toBe('member');
    for (let i = 0; i < 11; i++) {
      const res = await app.request('/api/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: bob },
        body: JSON.stringify({ label: `t${i}` }),
      });
      expect(res.status, `第 ${i + 1} 个`).toBe(201);
    }
  });

  it('逐项覆盖：apiTokens=1 后第 2 个 token 400；null 删除覆盖回落档位默认', async () => {
    const { cookie: carol } = await registerUser('carol');
    const row = await pool.query<{ id: string }>(`select id from users where username = 'carol'`);
    const carolId = row.rows[0].id;
    await putUser(admin, carolId, { quotaOverrides: { apiTokens: 1 } });
    const first = await app.request('/api/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: carol },
      body: JSON.stringify({ label: 'a' }),
    });
    expect(first.status).toBe(201);
    const second = await app.request('/api/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: carol },
      body: JSON.stringify({ label: 'b' }),
    });
    expect(second.status).toBe(400);
    expect(((await second.json()) as { error: string }).error).toContain('1 个');
    // null 删除覆盖 → 回落 free 档 10，第 2 个恢复可建
    const cleared = await putUser(admin, carolId, { quotaOverrides: { apiTokens: null } });
    expect(((await cleared.json()) as { user: AdminUserRow }).user.quotaOverrides).toEqual({});
    expect(
      (
        await app.request('/api/tokens', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: carol },
          body: JSON.stringify({ label: 'c' }),
        })
      ).status
    ).toBe(201);
  });

  it('isTrusted 可调；非法 plan 400；未知用户 404', async () => {
    const put = await putUser(admin, aliceId, { isTrusted: true });
    expect(((await put.json()) as { user: AdminUserRow }).user.isTrusted).toBe(true);
    expect((await putUser(admin, aliceId, { plan: 'vip' })).status).toBe(400);
    expect(
      (await putUser(admin, '00000000-0000-0000-0000-000000000000', { plan: 'member' })).status
    ).toBe(404);
  });

  it('GET /api/me 下发 plan 与 quotas 生效值——前端配额展示的唯一真值（契约 §3.12）', async () => {
    const { cookie: dave } = await registerUser('dave');
    const me = await app.request('/api/me', { headers: { cookie: dave } });
    expect(me.status).toBe(200);
    const { user } = (await me.json()) as {
      user: { plan: string; quotas: Record<string, number> };
    };
    expect(user.plan).toBe('free');
    expect(user.quotas).toEqual({ customPaths: 10, sites: 3, apiTokens: 10, dailyCreates: 10 });
    // 调 member 后 quotas 全 0（不限）
    const row = await pool.query<{ id: string }>(`select id from users where username = 'dave'`);
    await putUser(admin, row.rows[0].id, { plan: 'member' });
    const me2 = await app.request('/api/me', { headers: { cookie: dave } });
    const { user: u2 } = (await me2.json()) as { user: { quotas: Record<string, number> } };
    expect(u2.quotas).toEqual({ customPaths: 0, sites: 0, apiTokens: 0, dailyCreates: 0 });
  });

  it('非 admin 403；Bearer 403（治理类拒 API Token，契约 §3.8）', async () => {
    const { cookie: mallory } = await registerUser('mallory');
    expect(
      (await app.request('/api/admin/users', { headers: { cookie: mallory } })).status
    ).toBe(403);
    const tokenRes = await app.request('/api/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin },
      body: JSON.stringify({ label: 'admin-token' }),
    });
    const { token } = (await tokenRes.json()) as { token: string };
    expect(
      (
        await app.request('/api/admin/users', { headers: { authorization: `Bearer ${token}` } })
      ).status
    ).toBe(403);
  });
});
