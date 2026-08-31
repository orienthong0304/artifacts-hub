// 用户前缀子域与自定义路径(契约 §3.10)
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { app, pool, initSchema, resetDb, registerUser } from './helpers.js';

beforeAll(async () => {
  await initSchema();
});
beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await pool.end();
});

/** helpers.registerUser 只返回 { cookie }；这里按 username 取回 users.id */
async function userIdOf(username: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'select id from users where username = $1',
    [username]
  );
  return rows[0].id;
}

async function claimPrefix(cookie: string, prefix: string): Promise<Response> {
  return app.request('/api/me/subdomain', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ prefix }),
  });
}

describe('前缀领取 POST /api/me/subdomain(契约 §3.10)', () => {
  it('领取成功 → user.subdomainPrefix 返回;重复领取 409(不可更改)', async () => {
    const { cookie } = await registerUser('alice');
    const res = await claimPrefix(cookie, 'alice-lab');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { user: { subdomainPrefix: string } };
    expect(data.user.subdomainPrefix).toBe('alice-lab');
    expect((await claimPrefix(cookie, 'alice-two')).status).toBe(409);
  });
  it('与站点子域互斥:registry 已占用 → 409;保留字 → 400', async () => {
    const { cookie } = await registerUser('bob');
    const userId = await userIdOf('bob');
    await pool.query(
      "insert into subdomain_registry (name, kind, ref) values ('taken-name', 'site', $1)",
      [userId]
    );
    expect((await claimPrefix(cookie, 'taken-name')).status).toBe(409);
    expect((await claimPrefix(cookie, 'www')).status).toBe(400);
  });
  it('Bearer 不能领取(仅 cookie,与 token 创建同语义)', async () => {
    const { cookie } = await registerUser('carol');
    const tokenRes = await app.request('/api/tokens', { method: 'POST', headers: { cookie } });
    const { token } = (await tokenRes.json()) as { token: string };
    const res = await app.request('/api/me/subdomain', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ prefix: 'carol-x' }),
    });
    expect(res.status).toBe(403);
  });
});

/** 发布一个作品,返回 {id, slug} */
async function publishArtifact(
  cookie: string,
  over: Partial<{ type: string; visibility: string; code: string; title: string }> = {}
): Promise<{ id: string; slug: string }> {
  const res = await app.request('/api/artifacts', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      title: over.title ?? '测试作品',
      type: over.type ?? 'html',
      code: over.code ?? '<!doctype html><title>hi</title><h1>你好</h1>',
      visibility: over.visibility ?? 'unlisted',
    }),
  });
  const data = (await res.json()) as { artifact: { id: string; slug: string } };
  return data.artifact;
}

async function setPath(cookie: string, id: string, customPath: string | null): Promise<Response> {
  return app.request(`/api/artifacts/${id}/custom-path`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ customPath }),
  });
}

describe('自定义路径 PUT /api/artifacts/:id/custom-path(契约 §3.10)', () => {
  it('未领前缀 400;领取后设置成功,出参含 customPath/customUrl', async () => {
    const { cookie } = await registerUser('dave');
    const a = await publishArtifact(cookie);
    expect((await setPath(cookie, a.id, 'my-page')).status).toBe(400);
    await claimPrefix(cookie, 'dave-lab');
    const res = await setPath(cookie, a.id, 'my-page');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { artifact: { customPath: string; customUrl: string } };
    expect(data.artifact.customPath).toBe('my-page');
    expect(data.artifact.customUrl).toBe('https://dave-lab.artifacts.orienthong.cn/my-page');
  });
  it('用户内路径唯一 409;清除(null)释放后可复用;free 档配额 10(契约 §3.12)', async () => {
    const { cookie } = await registerUser('erin');
    // 置 trusted 绕过发布护栏（10/24h）——本用例考察的是路径配额，不是发布配额
    await pool.query(`update users set is_trusted = true where username = 'erin'`);
    await claimPrefix(cookie, 'erin-lab');
    const ids = [] as string[];
    for (let i = 0; i < 11; i++) ids.push((await publishArtifact(cookie)).id);
    expect((await setPath(cookie, ids[0], 'p-0')).status).toBe(200);
    expect((await setPath(cookie, ids[1], 'p-0')).status).toBe(409);
    for (let i = 1; i < 10; i++) {
      expect((await setPath(cookie, ids[i], `p-${i}`)).status).toBe(200);
    }
    const overflow = await setPath(cookie, ids[10], 'p-10');
    expect(overflow.status).toBe(403); // 第 11 个超 free 档配额
    // 文案不再出现「免费版」（契约 §3.12：上限是资源护栏与会员差异，不是免费墙）
    const { error } = (await overflow.json()) as { error: string };
    expect(error).not.toContain('免费版');
    expect(error).toContain('10');
    expect((await setPath(cookie, ids[0], null)).status).toBe(200); // 清除
    expect((await setPath(cookie, ids[10], 'p-10')).status).toBe(200); // 释放后额度恢复
  });
  it('他人作品 404', async () => {
    const { cookie } = await registerUser('frank');
    const a = await publishArtifact(cookie);
    const { cookie: other } = await registerUser('grace');
    await claimPrefix(other, 'grace-lab');
    expect((await setPath(other, a.id, 'steal')).status).toBe(404);
  });
});

describe('迁移(契约 §2)', () => {
  it('subdomain_registry 表存在且站点回填幂等', async () => {
    const reg = await pool.query("select to_regclass('public.subdomain_registry') as t");
    expect(reg.rows[0].t).toBe('subdomain_registry');
    // 模拟存量站点 → 再跑一次迁移 → registry 回填且不重复
    await registerUser('siteowner');
    const userId = await userIdOf('siteowner');
    await pool.query(
      `insert into sites (user_id, slug, subdomain, title, size_bytes, file_count)
       values ($1, 'sitesl01', 'legacy-site', '存量站', 100, 1)`,
      [userId]
    );
    await initSchema();
    await initSchema();
    const rows = await pool.query(
      "select kind, ref from subdomain_registry where name = 'legacy-site'"
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].kind).toBe('site');
  });
});
