// 版本历史集成测试（契约 §3.7）：自动快照 / 列表 / 详情 / 恢复 / 裁剪 / 闸门不可绕
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

/** PUT/restore 每次用不同伪造 IP，绕开更新限流（20 次/分/IP；限流器随模块常驻，跨用例累计） */
let ipCounter = 0;
function nextIp(): string {
  return `10.1.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
}

interface ArtifactOut {
  id: string;
  slug: string;
  title: string;
  code?: string;
  reviewStatus: string;
  visibility: string;
}

interface VersionListItem {
  id: string;
  version: number;
  title: string;
  createdAt: string;
  code?: string;
}

async function createArtifact(
  cookie: string,
  overrides: Record<string, unknown> = {}
): Promise<ArtifactOut> {
  const res = await app.request('/api/artifacts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      title: '初版标题',
      type: 'html',
      code: '<p>v1</p>',
      visibility: 'unlisted',
      ...overrides,
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { artifact: ArtifactOut }).artifact;
}

async function putArtifact(
  cookie: string,
  id: string,
  patch: Record<string, unknown>
): Promise<Response> {
  return app.request(`/api/artifacts/${id}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      cookie,
      'x-forwarded-for': nextIp(),
    },
    body: JSON.stringify(patch),
  });
}

async function listVersions(cookie: string, id: string): Promise<VersionListItem[]> {
  const res = await app.request(`/api/artifacts/${id}/versions`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: VersionListItem[] }).items;
}

async function restoreVersion(cookie: string, id: string, version: number): Promise<Response> {
  return app.request(`/api/artifacts/${id}/versions/${version}/restore`, {
    method: 'POST',
    headers: { cookie, 'x-forwarded-for': nextIp() },
  });
}

describe('版本历史（契约 §3.7）', () => {
  it('① 创建成功自动记 v1', async () => {
    const { cookie } = await registerUser('ver1');
    const a = await createArtifact(cookie);

    const items = await listVersions(cookie, a.id);
    expect(items).toHaveLength(1);
    expect(items[0].version).toBe(1);
    expect(items[0].title).toBe('初版标题');
    expect(items[0].id).toBeTruthy();
    expect(items[0].createdAt).toBeTruthy();
  });

  it('② 两次 PUT 改 code → v3；列表倒序且不含 code', async () => {
    const { cookie } = await registerUser('ver2');
    const a = await createArtifact(cookie);

    expect((await putArtifact(cookie, a.id, { code: '<p>v2</p>' })).status).toBe(200);
    expect(
      (await putArtifact(cookie, a.id, { code: '<p>v3</p>', title: '第三版' })).status
    ).toBe(200);

    const items = await listVersions(cookie, a.id);
    expect(items.map((i) => i.version)).toEqual([3, 2, 1]);
    expect(items[0].title).toBe('第三版');
    for (const item of items) {
      expect(item).not.toHaveProperty('code');
    }

    // 版本详情含快照的完整内容（更新后的内容）
    const detail = await app.request(`/api/artifacts/${a.id}/versions/2`, {
      headers: { cookie },
    });
    expect(detail.status).toBe(200);
    const { version } = (await detail.json()) as {
      version: { version: number; title: string; description: string | null; code: string };
    };
    expect(version.version).toBe(2);
    expect(version.code).toBe('<p>v2</p>');
  });

  it('③ 仅改 visibility / accessPassword 不记版本', async () => {
    const { cookie } = await registerUser('ver3');
    const a = await createArtifact(cookie);

    expect((await putArtifact(cookie, a.id, { visibility: 'private' })).status).toBe(200);
    expect((await putArtifact(cookie, a.id, { accessPassword: 'pass1234' })).status).toBe(200);

    const items = await listVersions(cookie, a.id);
    expect(items).toHaveLength(1);
    expect(items[0].version).toBe(1);
  });

  it('④ restore v1 → 作品 code 回到 v1 内容且新增 v4 快照', async () => {
    const { cookie } = await registerUser('ver4');
    const a = await createArtifact(cookie);
    await putArtifact(cookie, a.id, { code: '<p>v2</p>' });
    await putArtifact(cookie, a.id, { code: '<p>v3</p>', title: '第三版' });

    const res = await restoreVersion(cookie, a.id, 1);
    expect(res.status).toBe(200);
    const { artifact } = (await res.json()) as { artifact: ArtifactOut };
    expect(artifact.code).toBe('<p>v1</p>');
    expect(artifact.title).toBe('初版标题');

    // 恢复本身也是一次内容变更 → 新增 v4，内容与 v1 相同
    const items = await listVersions(cookie, a.id);
    expect(items.map((i) => i.version)).toEqual([4, 3, 2, 1]);
    const v4 = await app.request(`/api/artifacts/${a.id}/versions/4`, { headers: { cookie } });
    const { version } = (await v4.json()) as { version: { code: string; title: string } };
    expect(version.code).toBe('<p>v1</p>');
    expect(version.title).toBe('初版标题');
  });

  it('⑤ restore 照走审核门：非 trusted 作者 public 作品恢复后重判 pending；管理员保持 approved', async () => {
    // 普通用户：public 作品被人为置 approved（模拟 stale 状态），restore 后重判回 pending
    const { cookie } = await registerUser('ver5');
    const a = await createArtifact(cookie, { visibility: 'public' });
    expect(a.reviewStatus).toBe('pending');
    await pool.query(`update artifacts set review_status = 'approved' where id = $1`, [a.id]);

    const res = await restoreVersion(cookie, a.id, 1);
    expect(res.status).toBe(200);
    const { artifact } = (await res.json()) as { artifact: ArtifactOut };
    expect(artifact.reviewStatus).toBe('pending');

    // 管理员：restore 豁免审核门，保持 approved
    const { cookie: adminCookie } = await registerUser('veradmin', 'admin@test.local');
    const b = await createArtifact(adminCookie, { visibility: 'public', title: '管理员作品' });
    expect(b.reviewStatus).toBe('approved');
    await putArtifact(adminCookie, b.id, { code: '<p>v2</p>' });

    const adminRes = await restoreVersion(adminCookie, b.id, 1);
    expect(adminRes.status).toBe(200);
    const adminBody = (await adminRes.json()) as { artifact: ArtifactOut };
    expect(adminBody.artifact.reviewStatus).toBe('approved');
    expect(adminBody.artifact.code).toBe('<p>v1</p>');
  });

  it('⑥ 非作者一律 403；未登录 401', async () => {
    const { cookie } = await registerUser('ver6owner');
    const { cookie: otherCookie } = await registerUser('ver6other');
    const a = await createArtifact(cookie);

    const list = await app.request(`/api/artifacts/${a.id}/versions`, {
      headers: { cookie: otherCookie },
    });
    expect(list.status).toBe(403);

    const detail = await app.request(`/api/artifacts/${a.id}/versions/1`, {
      headers: { cookie: otherCookie },
    });
    expect(detail.status).toBe(403);

    const restore = await restoreVersion(otherCookie, a.id, 1);
    expect(restore.status).toBe(403);

    const anon = await app.request(`/api/artifacts/${a.id}/versions`);
    expect(anon.status).toBe(401);
  });

  it('⑦ 不存在的版本 404「版本不存在」；不存在的作品 404「作品不存在」', async () => {
    const { cookie } = await registerUser('ver7');
    const a = await createArtifact(cookie);

    const missing = await app.request(`/api/artifacts/${a.id}/versions/99`, {
      headers: { cookie },
    });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toBe('版本不存在');

    const restoreMissing = await restoreVersion(cookie, a.id, 99);
    expect(restoreMissing.status).toBe(404);
    expect(((await restoreMissing.json()) as { error: string }).error).toBe('版本不存在');

    const ghost = await app.request(
      '/api/artifacts/00000000-0000-0000-0000-000000000000/versions',
      { headers: { cookie } }
    );
    expect(ghost.status).toBe(404);
    expect(((await ghost.json()) as { error: string }).error).toBe('作品不存在');
  });

  it('⑨ 零改动全量 PUT（值与现状完全相同）不记新版本', async () => {
    const { cookie } = await registerUser('ver9');
    const a = await createArtifact(cookie);
    // 创建后仅有 v1
    expect(await listVersions(cookie, a.id)).toHaveLength(1);

    // 发一次与现状完全相同的全量 PUT（title/description/code/visibility 值都不变）
    const res = await putArtifact(cookie, a.id, {
      title: '初版标题',
      description: null,
      code: '<p>v1</p>',
      visibility: 'unlisted',
    });
    expect(res.status).toBe(200);

    // 值无变化 → 版本数不增，仍为 v1
    const items = await listVersions(cookie, a.id);
    expect(items).toHaveLength(1);
    expect(items[0].version).toBe(1);
  });

  it('⑧ 超 20 版裁剪最旧：21 次 PUT 后剩 20 版（v3–v22）', async () => {
    const { cookie } = await registerUser('ver8');
    const a = await createArtifact(cookie);

    for (let i = 2; i <= 22; i++) {
      const res = await putArtifact(cookie, a.id, { code: `<p>v${i}</p>` });
      expect(res.status).toBe(200);
    }

    const items = await listVersions(cookie, a.id);
    expect(items).toHaveLength(20);
    expect(items[0].version).toBe(22);
    expect(items[items.length - 1].version).toBe(3);

    // 最旧的 v1/v2 已被物理删除
    const { rows } = await pool.query<{ count: string }>(
      'select count(*) as count from artifact_versions where artifact_id = $1 and version <= 2',
      [a.id]
    );
    expect(Number.parseInt(rows[0].count, 10)).toBe(0);
  });
});
