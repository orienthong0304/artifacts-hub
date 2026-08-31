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

describe('敏感词闸门（默认示例词表含「测试违禁词」）', () => {
  it('标题命中 → 400 且不入库', async () => {
    const { cookie } = await registerUser('moduser');
    const res = await app.request('/api/artifacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        title: '包含测试违禁词的标题',
        type: 'html',
        code: '<p>ok</p>',
        visibility: 'public',
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('违禁内容');
    const count = await pool.query('select count(*)::int as n from artifacts');
    expect(count.rows[0].n).toBe(0);
  });

  it('干净内容正常创建', async () => {
    const { cookie } = await registerUser('moduser2');
    const res = await app.request('/api/artifacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: '干净标题', type: 'html', code: '<p>ok</p>', visibility: 'public' }),
    });
    expect(res.status).toBe(201);
  });
});
