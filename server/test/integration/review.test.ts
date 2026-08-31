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

async function createArtifact(cookie: string, title: string): Promise<{ id: string; slug: string; reviewStatus: string }> {
  const res = await app.request('/api/artifacts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ title, type: 'html', code: '<p>hi</p>', visibility: 'public' }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { artifact: { id: string; slug: string; reviewStatus: string } }).artifact;
}

async function exploreTitles(): Promise<string[]> {
  const res = await app.request('/api/explore');
  const { items } = (await res.json()) as { items: Array<{ title: string }> };
  return items.map((i) => i.title);
}

describe('广场审核门（契约 §3.3）', () => {
  it('新账号 public 作品 pending：不进广场但持链接可看；approve 后进广场且作者转 trusted', async () => {
    const { cookie: userCookie } = await registerUser('newbie');
    const { cookie: adminCookie } = await registerUser('admin1', 'admin@test.local');

    const a = await createArtifact(userCookie, '待审作品');
    expect(a.reviewStatus).toBe('pending');
    expect(await exploreTitles()).not.toContain('待审作品');

    // 持链接可正常访问（等同 unlisted 语义）
    const detail = await app.request(`/api/artifacts/${a.slug}`);
    expect(detail.status).toBe(200);

    // 管理员待审列表可见
    const pending = await app.request('/api/admin/pending', { headers: { cookie: adminCookie } });
    expect(pending.status).toBe(200);
    expect(((await pending.json()) as { items: unknown[] }).items).toHaveLength(1);

    // approve → 进广场 + 作者 trusted → 下一个作品直接 approved
    const approve = await app.request(`/api/admin/artifacts/${a.id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ action: 'approve' }),
    });
    expect(approve.status).toBe(200);
    expect(await exploreTitles()).toContain('待审作品');

    const b = await createArtifact(userCookie, '信任后作品');
    expect(b.reviewStatus).toBe('approved');
  });

  it('管理员发布直接 approved；reject 下架作品', async () => {
    const { cookie: adminCookie } = await registerUser('admin2', 'admin@test.local');
    const a = await createArtifact(adminCookie, '管理员作品');
    expect(a.reviewStatus).toBe('approved');

    const { cookie: userCookie } = await registerUser('newbie2');
    const bad = await createArtifact(userCookie, '违规作品');
    const reject = await app.request(`/api/admin/artifacts/${bad.id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ action: 'reject' }),
    });
    expect(reject.status).toBe(200);
    const detail = await app.request(`/api/artifacts/${bad.slug}`);
    expect(detail.status).toBe(404); // 已下架，对匿名访客视同不存在
  });

  it('unlisted/private 不需要审核', async () => {
    const { cookie } = await registerUser('newbie3');
    const res = await app.request('/api/artifacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: '不公开作品', type: 'html', code: '<p>x</p>', visibility: 'unlisted' }),
    });
    const { artifact } = (await res.json()) as { artifact: { reviewStatus: string } };
    expect(artifact.reviewStatus).toBe('approved');
  });

  it('trusted 作者的 stale pending 作品：PUT 编辑后自动转 approved（Task 5 遗留修复）', async () => {
    const { cookie } = await registerUser('trusted1');
    const a = await createArtifact(cookie, '早期待审作品');
    expect(a.reviewStatus).toBe('pending');

    // 模拟：作者随后被转正 trusted，但旧作品仍卡在 pending
    await pool.query('update users set is_trusted = true where username = $1', ['trusted1']);

    const res = await app.request(`/api/artifacts/${a.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: '编辑后的作品' }),
    });
    expect(res.status).toBe(200);
    const { artifact } = (await res.json()) as { artifact: { reviewStatus: string } };
    expect(artifact.reviewStatus).toBe('approved');
    expect(await exploreTitles()).toContain('编辑后的作品');
  });

  it('batch-visibility 不能绕过审核门：unlisted→public 批量改后仍 pending', async () => {
    const { cookie } = await registerUser('batchuser');
    const res = await app.request('/api/artifacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: '旁路作品', type: 'html', code: '<p>x</p>', visibility: 'unlisted' }),
    });
    const { artifact } = (await res.json()) as { artifact: { id: string } };

    const batch = await app.request('/api/artifacts/batch-visibility', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ ids: [artifact.id], visibility: 'public' }),
    });
    expect(batch.status).toBe(200);

    // 响应回传服务端真值（W1-5）：前端必须据此覆盖，不能乐观更新成「已公开」——
    // 否则 UI 显示公开而作品实际被 explore 与 /u/:username 排除，用户看不到任何解释
    const batchBody = (await batch.json()) as {
      updated: number;
      items: { id: string; visibility: string; reviewStatus: string }[];
    };
    expect(batchBody.updated).toBe(1);
    expect(batchBody.items).toHaveLength(1);
    expect(batchBody.items[0].id).toBe(artifact.id);
    expect(batchBody.items[0].visibility).toBe('public');
    expect(batchBody.items[0].reviewStatus).toBe('pending');

    const row = await pool.query<{ review_status: string }>(
      'select review_status from artifacts where id = $1',
      [artifact.id]
    );
    expect(row.rows[0].review_status).toBe('pending');

    const explore = await app.request('/api/explore');
    const { items } = (await explore.json()) as { items: Array<{ title: string }> };
    expect(items.map((i) => i.title)).not.toContain('旁路作品');
  });

  it('批量不执行机审：trusted 作者的 pending-public 作品经 batch-visibility(public) 后仍 pending', async () => {
    const { cookie } = await registerUser('batchtrusted');
    const a = await createArtifact(cookie, '待审洗白作品');
    expect(a.reviewStatus).toBe('pending');

    // 作者随后被转正 trusted，但该作品仍是 pending（可能因 medium 强制转人工）
    await pool.query('update users set is_trusted = true where username = $1', ['batchtrusted']);

    const batch = await app.request('/api/artifacts/batch-visibility', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ ids: [a.id], visibility: 'public' }),
    });
    expect(batch.status).toBe(200);

    const row = await pool.query<{ review_status: string }>(
      'select review_status from artifacts where id = $1',
      [a.id]
    );
    expect(row.rows[0].review_status).toBe('pending');
    expect(await exploreTitles()).not.toContain('待审洗白作品');
  });

  it('pending 作品 batch 到 unlisted → approved（出广场即免审）', async () => {
    const { cookie } = await registerUser('batchout');
    const a = await createArtifact(cookie, '退出广场作品');
    expect(a.reviewStatus).toBe('pending');

    const batch = await app.request('/api/artifacts/batch-visibility', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ ids: [a.id], visibility: 'unlisted' }),
    });
    expect(batch.status).toBe(200);

    const row = await pool.query<{ review_status: string }>(
      'select review_status from artifacts where id = $1',
      [a.id]
    );
    expect(row.rows[0].review_status).toBe('approved');
  });

  it('管理员豁免：admin 的 pending 作品经 batch-visibility(public) 直接 approved', async () => {
    const { cookie: adminCookie } = await registerUser('admin3', 'admin@test.local');
    const a = await createArtifact(adminCookie, '管理员批量作品');
    // 人为置 pending（如存量迁移遗留），验证管理员批量可直接转 approved
    await pool.query(`update artifacts set review_status = 'pending' where id = $1`, [a.id]);

    const batch = await app.request('/api/artifacts/batch-visibility', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ ids: [a.id], visibility: 'public' }),
    });
    expect(batch.status).toBe(200);

    const row = await pool.query<{ review_status: string }>(
      'select review_status from artifacts where id = $1',
      [a.id]
    );
    expect(row.rows[0].review_status).toBe('approved');
  });
});
