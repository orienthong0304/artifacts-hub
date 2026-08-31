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

describe('访问日计数（契约 §3.5）', () => {
  it('public 详情命中两次 → 当日计数 2', async () => {
    const { cookie } = await registerUser('statuser');
    const created = await app.request('/api/artifacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: '统计作品', type: 'html', code: '<p>x</p>', visibility: 'public' }),
    });
    const { artifact } = (await created.json()) as { artifact: { id: string; slug: string } };

    await app.request(`/api/artifacts/${artifact.slug}`);
    await app.request(`/api/artifacts/${artifact.slug}`);

    const daily = await pool.query<{ views: number }>(
      'select views from artifact_view_daily where artifact_id = $1 and day = current_date',
      [artifact.id]
    );
    expect(daily.rows[0]?.views).toBe(2);
  });
});
