// 临时链接集成测试（契约 §3.6）：豁免可见性/密码、惰性过期、撤销、上限、下架治理优先
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

interface TempLink {
  id: string;
  token: string;
  expiresAt: string;
  note: string | null;
  expired: boolean;
  createdAt: string;
}

/** 建一个 private + 访问密码 的作品（临时链接豁免二者的核心场景） */
async function createPrivateArtifact(cookie: string, title = '私密作品'): Promise<{ id: string; slug: string }> {
  const res = await app.request('/api/artifacts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      title,
      type: 'html',
      code: '<p>secret</p>',
      visibility: 'private',
      accessPassword: 'pass1234',
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { artifact: { id: string; slug: string } }).artifact;
}

async function createTempLink(
  cookie: string,
  artifactId: string,
  body: Record<string, unknown> = { expiresInHours: 24 }
): Promise<Response> {
  return app.request(`/api/artifacts/${artifactId}/temp-links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

/** 每次公开访问用不同伪造 IP，绕开 /api/t/:token 的 30 次/分/IP 限流 */
let tokenIpCounter = 0;
async function resolveToken(token: string): Promise<Response> {
  return app.request(`/api/t/${token}`, {
    headers: { 'x-forwarded-for': `10.9.0.${++tokenIpCounter}` },
  });
}

describe('临时链接（契约 §3.6）', () => {
  it('作者创建 → 公开 /api/t/:token 能看 private+带密码作品的 code（计 views 与日计数）', async () => {
    const { cookie } = await registerUser('author1');
    const artifact = await createPrivateArtifact(cookie);

    const created = await createTempLink(cookie, artifact.id, {
      expiresInHours: 24,
      note: '给客户预览',
    });
    expect(created.status).toBe(201);
    const { tempLink } = (await created.json()) as { tempLink: TempLink };
    expect(tempLink.token).toMatch(/^[0-9a-zA-Z_-]{16}$/);
    expect(tempLink.note).toBe('给客户预览');
    expect(tempLink.expired).toBe(false);

    // 匿名访问：豁免 visibility 与访问密码，返回完整详情（含 code）+ tempLink.expiresAt
    const res = await resolveToken(tempLink.token);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      artifact: { code?: string; title: string; views: number; locked?: boolean };
      tempLink: { expiresAt: string };
    };
    expect(data.artifact.code).toBe('<p>secret</p>');
    expect(data.artifact.locked).toBeUndefined();
    expect(data.artifact.views).toBe(1);
    expect(data.tempLink.expiresAt).toBe(tempLink.expiresAt);

    // 日计数已落表
    const daily = await pool.query<{ views: number }>(
      'select views from artifact_view_daily where artifact_id = $1 and day = current_date',
      [artifact.id]
    );
    expect(daily.rows[0]?.views).toBe(1);
  });

  it('过期链接 404「链接已过期或不存在」；列表仍返回并标 expired: true', async () => {
    const { cookie } = await registerUser('author2');
    const artifact = await createPrivateArtifact(cookie);
    const created = await createTempLink(cookie, artifact.id, { expiresInHours: 1 });
    const { tempLink } = (await created.json()) as { tempLink: TempLink };

    // 惰性过期：直接把 expires_at 改到过去
    await pool.query('update temporary_links set expires_at = now() - interval \'1 hour\' where id = $1', [
      tempLink.id,
    ]);

    const res = await resolveToken(tempLink.token);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('链接已过期或不存在');

    // 作者列表：未撤销的全部返回（含已过期，expired: true），按 created_at 倒序
    const list = await app.request(`/api/artifacts/${artifact.id}/temp-links`, {
      headers: { cookie },
    });
    expect(list.status).toBe(200);
    const { items } = (await list.json()) as { items: TempLink[] };
    expect(items).toHaveLength(1);
    expect(items[0].expired).toBe(true);
  });

  it('撤销后 404；撤销的链接不再出现在列表', async () => {
    const { cookie } = await registerUser('author3');
    const artifact = await createPrivateArtifact(cookie);
    const created = await createTempLink(cookie, artifact.id);
    const { tempLink } = (await created.json()) as { tempLink: TempLink };

    // 撤销前可访问
    expect((await resolveToken(tempLink.token)).status).toBe(200);

    const revoke = await app.request(`/api/temp-links/${tempLink.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(revoke.status).toBe(204);

    expect((await resolveToken(tempLink.token)).status).toBe(404);

    const list = await app.request(`/api/artifacts/${artifact.id}/temp-links`, {
      headers: { cookie },
    });
    expect(((await list.json()) as { items: TempLink[] }).items).toHaveLength(0);
  });

  it('非作者创建/列表/撤销 → 403', async () => {
    const { cookie: authorCookie } = await registerUser('author4');
    const { cookie: otherCookie } = await registerUser('other4');
    const artifact = await createPrivateArtifact(authorCookie);

    const created = await createTempLink(otherCookie, artifact.id);
    expect(created.status).toBe(403);

    const list = await app.request(`/api/artifacts/${artifact.id}/temp-links`, {
      headers: { cookie: otherCookie },
    });
    expect(list.status).toBe(403);

    const own = await createTempLink(authorCookie, artifact.id);
    const { tempLink } = (await own.json()) as { tempLink: TempLink };
    const revoke = await app.request(`/api/temp-links/${tempLink.id}`, {
      method: 'DELETE',
      headers: { cookie: otherCookie },
    });
    expect(revoke.status).toBe(403);
  });

  it('每作品有效链接上限 20，超限 400；过期/撤销的不占名额', async () => {
    const { cookie } = await registerUser('author5');
    const artifact = await createPrivateArtifact(cookie);

    for (let i = 0; i < 20; i++) {
      expect((await createTempLink(cookie, artifact.id)).status).toBe(201);
    }
    const overflow = await createTempLink(cookie, artifact.id);
    expect(overflow.status).toBe(400);
    expect(((await overflow.json()) as { error: string }).error).toBe(
      '该作品的有效临时链接已达上限（20 个）'
    );

    // 把一条置为过期后，名额释放
    await pool.query(
      `update temporary_links set expires_at = now() - interval '1 hour'
       where id = (select id from temporary_links where artifact_id = $1 limit 1)`,
      [artifact.id]
    );
    expect((await createTempLink(cookie, artifact.id)).status).toBe(201);
  });

  it('已下架作品的临时链接一律 404（治理优先）', async () => {
    const { cookie } = await registerUser('author6');
    const { cookie: adminCookie } = await registerUser('admin6', 'admin@test.local');
    const artifact = await createPrivateArtifact(cookie);
    const created = await createTempLink(cookie, artifact.id);
    const { tempLink } = (await created.json()) as { tempLink: TempLink };

    const takedown = await app.request(`/api/admin/artifacts/${artifact.id}/takedown`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ takenDown: true }),
    });
    expect(takedown.status).toBe(200);

    const res = await resolveToken(tempLink.token);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('链接已过期或不存在');
  });

  it('有效期非法 → 400「有效期不合法」；备注超 200 字 → 400', async () => {
    const { cookie } = await registerUser('author7');
    const artifact = await createPrivateArtifact(cookie);

    const bad = await createTempLink(cookie, artifact.id, { expiresInHours: 48 });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('有效期不合法');

    const longNote = await createTempLink(cookie, artifact.id, {
      expiresInHours: 24,
      note: '啊'.repeat(201),
    });
    expect(longNote.status).toBe(400);
  });
});
