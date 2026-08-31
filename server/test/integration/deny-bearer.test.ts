// Bearer 越权收口（契约 §3.8 / 计划 W1-3）
//
// 背景：attachUser 对任一未撤销 ak_ token 直接挂完整 user 身份，且 requireAdmin 原先只判
// user.is_admin、不看 authVia。后果是管理员账号的 API Token 一旦泄露，持有者可下架任意作品、
// 通过审核（并把作者置为永久 trusted）——一枚长期有效的明文串足以操纵平台内容治理决定。
// 本文件断言：API Token 只能用于「发布用」动词，治理类与不可逆动词一律 403。
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

/** 用 cookie 建一个 API Token，返回明文 */
async function mintToken(cookie: string): Promise<string> {
  const res = await app.request('/api/tokens', { method: 'POST', headers: { cookie } });
  if (res.status !== 201) throw new Error(`建 token 失败: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { token: string }).token;
}

/** 建一个作品，返回 {id, slug} */
async function createArtifact(cookie: string, title = '测试作品'): Promise<{ id: string; slug: string }> {
  const res = await app.request('/api/artifacts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ title, type: 'html', code: '<h1>hi</h1>', visibility: 'unlisted' }),
  });
  if (res.status !== 201) throw new Error(`建作品失败: ${res.status} ${await res.text()}`);
  const { artifact } = (await res.json()) as { artifact: { id: string; slug: string } };
  return artifact;
}

describe('Bearer 越权收口（契约 §3.8）', () => {
  it('① 管理员的 Bearer token 打不开管理后台：读列表与下架均 403', async () => {
    const { cookie: adminCookie } = await registerUser('bearadmin', 'admin@test.local');
    const token = await mintToken(adminCookie);
    const bearer = { authorization: `Bearer ${token}` };

    // 前提确认：这个账号确实是管理员，且 cookie 走得通——否则 403 可能只是「不是 admin」
    const viaCookie = await app.request('/api/admin/pending', { headers: { cookie: adminCookie } });
    expect(viaCookie.status).toBe(200);

    // 读类：pending 队列与举报列表
    expect((await app.request('/api/admin/pending', { headers: bearer })).status).toBe(403);
    expect((await app.request('/api/admin/reports', { headers: bearer })).status).toBe(403);

    // 写类：下架任意作品
    const { cookie: victimCookie } = await registerUser('bearvictim');
    const victim = await createArtifact(victimCookie, '受害者作品');
    const takedown = await app.request(`/api/admin/artifacts/${victim.id}/takedown`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bearer },
      body: JSON.stringify({ takenDown: true }),
    });
    expect(takedown.status).toBe(403);

    // 且确实没生效：作品仍未下架
    const row = await pool.query<{ is_taken_down: boolean }>(
      'select is_taken_down from artifacts where id = $1',
      [victim.id]
    );
    expect(row.rows[0].is_taken_down).toBe(false);
  });

  it('② 审核动词也拒 Bearer：review 不能经 token 通过（否则可顺带把作者置为永久 trusted）', async () => {
    const { cookie: adminCookie } = await registerUser('bearadmin2', 'admin@test.local');
    const token = await mintToken(adminCookie);
    const { cookie: authorCookie } = await registerUser('bearauthor');
    const target = await createArtifact(authorCookie, '待审作品');

    const res = await app.request(`/api/admin/artifacts/${target.id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'approve' }),
    });
    expect(res.status).toBe(403);

    // 作者未被置为 trusted
    const author = await pool.query<{ is_trusted: boolean }>(
      'select is_trusted from users where username = $1',
      ['bearauthor']
    );
    expect(author.rows[0].is_trusted).toBe(false);
  });

  it('③ 删除作品拒 Bearer（不可逆），同一请求走 cookie 成功', async () => {
    const { cookie } = await registerUser('beardel');
    const token = await mintToken(cookie);
    const own = await createArtifact(cookie, '自己的作品');

    const viaBearer = await app.request(`/api/artifacts/${own.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(viaBearer.status).toBe(403);

    // 仍在库里
    expect(
      (await pool.query('select 1 from artifacts where id = $1', [own.id])).rowCount
    ).toBe(1);

    // cookie 认证同一请求成功
    const viaCookie = await app.request(`/api/artifacts/${own.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(viaCookie.status).toBe(204);
    expect(
      (await pool.query('select 1 from artifacts where id = $1', [own.id])).rowCount
    ).toBe(0);
  });

  it('④ 批量改可见性拒 Bearer，cookie 成功', async () => {
    const { cookie } = await registerUser('bearbatch');
    const token = await mintToken(cookie);
    const a = await createArtifact(cookie, '批量目标');

    const viaBearer = await app.request('/api/artifacts/batch-visibility', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ ids: [a.id], visibility: 'private' }),
    });
    expect(viaBearer.status).toBe(403);

    const viaCookie = await app.request('/api/artifacts/batch-visibility', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ ids: [a.id], visibility: 'private' }),
    });
    expect(viaCookie.status).toBe(200);
  });

  it('⑤ 删除站点与领取子域前缀拒 Bearer', async () => {
    const { cookie } = await registerUser('bearsite');
    const token = await mintToken(cookie);
    const bearer = { authorization: `Bearer ${token}` };

    // 站点删除：即便 id 不存在也应先被鉴权拒掉（403 而非 404），证明闸门在归属校验之前
    const delSite = await app.request('/api/sites/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
      headers: bearer,
    });
    expect(delSite.status).toBe(403);

    const claim = await app.request('/api/me/subdomain', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bearer },
      body: JSON.stringify({ prefix: 'bearsite' }),
    });
    expect(claim.status).toBe(403);
  });

  it('⑥ 不误伤发布链路：Bearer 仍可 create / update / 读列表（MCP 的核心动词）', async () => {
    const { cookie } = await registerUser('bearpub');
    const token = await mintToken(cookie);
    const bearer = { authorization: `Bearer ${token}` };

    const created = await app.request('/api/artifacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bearer },
      body: JSON.stringify({
        title: 'Agent 发布',
        type: 'html',
        code: '<h1>v1</h1>',
        visibility: 'unlisted',
      }),
    });
    expect(created.status).toBe(201);
    const { artifact } = (await created.json()) as { artifact: { id: string } };

    const updated = await app.request(`/api/artifacts/${artifact.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...bearer },
      body: JSON.stringify({ code: '<h1>v2</h1>' }),
    });
    expect(updated.status).toBe(200);

    expect((await app.request('/api/artifacts', { headers: bearer })).status).toBe(200);
    expect((await app.request('/api/tokens', { headers: bearer })).status).toBe(200);
  });
});
