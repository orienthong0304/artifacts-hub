// 广场排序（契约 §3）：sort=latest（默认，created_at 倒序）/ hot（views 倒序，并列按 created_at 倒序）；非法值 400
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

/** 用管理员账号创建 public 作品（管理员直接 approved，可进广场） */
async function createPublicArtifact(
  cookie: string,
  title: string
): Promise<{ id: string; slug: string }> {
  const res = await app.request('/api/artifacts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      title,
      type: 'html',
      code: '<!doctype html><title>t</title><p>hi</p>',
      visibility: 'public',
    }),
  });
  expect(res.status).toBe(201);
  const { artifact } = (await res.json()) as { artifact: { id: string; slug: string } };
  return artifact;
}

/** 显式拉开 created_at，避免同毫秒插入导致排序断言不稳定 */
async function backdate(id: string, minutesAgo: number): Promise<void> {
  await pool.query(`update artifacts set created_at = now() - ($2 || ' minutes')::interval where id = $1`, [
    id,
    minutesAgo,
  ]);
}

async function exploreTitles(query = ''): Promise<string[]> {
  const res = await app.request(`/api/explore${query}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: { title: string }[] };
  return body.items.map((i) => i.title);
}

describe('GET /api/explore 排序（契约 §3）', () => {
  it('hot 按 views 倒序（并列按 created_at 倒序）；缺省与 latest 按 created_at 倒序；非法值 400', async () => {
    // ADMIN_EMAIL 账号发布即 approved（新账号 public 作品是 pending 不进广场）
    const { cookie } = await registerUser('siteadmin', 'admin@test.local');

    const older = await createPublicArtifact(cookie, '高浏览作品');
    const middle = await createPublicArtifact(cookie, '中间作品');
    const newest = await createPublicArtifact(cookie, '最新作品');
    await backdate(older.id, 2);
    await backdate(middle.id, 1);

    // 刷 2 次详情：public 命中详情即自增 views → 高浏览作品 views=2，其余 0
    for (let i = 0; i < 2; i++) {
      const detail = await app.request(`/api/artifacts/${older.slug}`);
      expect(detail.status).toBe(200);
    }

    // hot：views 倒序，首位是高浏览者；并列（0 views）按 created_at 倒序
    expect(await exploreTitles('?sort=hot')).toEqual(['高浏览作品', '最新作品', '中间作品']);

    // 缺省 = latest：created_at 倒序
    expect(await exploreTitles()).toEqual(['最新作品', '中间作品', '高浏览作品']);
    expect(await exploreTitles('?sort=latest')).toEqual(['最新作品', '中间作品', '高浏览作品']);

    // 非法值：400 + 中文错误
    const bad = await app.request('/api/explore?sort=bad');
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('排序必须是 latest 或 hot');
  });
});
