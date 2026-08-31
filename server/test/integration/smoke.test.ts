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

describe('集成冒烟：注册 → 登录态 → 创建 → 详情', () => {
  it('完整闭环可用', async () => {
    const { cookie } = await registerUser('smokeuser');

    const me = await app.request('/api/me', { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { username: string } }).user.username).toBe('smokeuser');

    const created = await app.request('/api/artifacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        title: '冒烟作品',
        type: 'html',
        code: '<!doctype html><title>t</title><p>hi</p>',
        visibility: 'public',
      }),
    });
    expect(created.status).toBe(201);
    const { artifact } = (await created.json()) as { artifact: { slug: string } };

    const detail = await app.request(`/api/artifacts/${artifact.slug}`);
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as { artifact: { title: string; code?: string } };
    expect(body.artifact.title).toBe('冒烟作品');
    expect(body.artifact.code).toContain('hi');
  });
});
