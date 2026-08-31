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

describe('新账号发布配额（10 个/24h，契约 §3.3）', () => {
  it('第 11 个创建请求返回 429', async () => {
    const { cookie } = await registerUser('quotauser');
    for (let i = 1; i <= 10; i++) {
      const res = await app.request('/api/artifacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ title: `作品${i}`, type: 'html', code: '<p>x</p>', visibility: 'unlisted' }),
      });
      expect(res.status).toBe(201);
    }
    const over = await app.request('/api/artifacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: '超额作品', type: 'html', code: '<p>x</p>', visibility: 'unlisted' }),
    });
    expect(over.status).toBe(429);
    expect(((await over.json()) as { error: string }).error).toContain('每 24 小时');
  });
});
