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

describe('条款版本化（契约 §3.4）', () => {
  it('未勾选同意 → 400', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.1' },
      body: JSON.stringify({ email: 'noagree@test.local', username: 'noagree', password: 'password123' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('同意');
  });

  it('注册与首次发布写入 consent_records，重复发布幂等', async () => {
    const { cookie } = await registerUser('consentuser');
    const registerRows = await pool.query(
      "select count(*)::int as n from consent_records where context = 'register'"
    );
    expect(registerRows.rows[0].n).toBe(1);

    for (let i = 0; i < 2; i++) {
      await app.request('/api/artifacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ title: `作品${i}`, type: 'html', code: '<p>x</p>', visibility: 'unlisted' }),
      });
    }
    const publishRows = await pool.query(
      "select count(*)::int as n from consent_records where context = 'publish'"
    );
    expect(publishRows.rows[0].n).toBe(1);
  });
});
