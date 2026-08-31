// 单用户模式 AUTH_MODE=single（dual-track roadmap OS-2）
//
// 开源自托管版的用户模型：部署者即唯一管理者。三条性质：
// ① 空库时首个注册者自动成为管理员（不依赖 ADMIN_EMAIL——自托管者不该为当管理员多配一个变量）；
// ② 已有用户后注册端点关闭（403，文案说明这是单用户实例）；
// ③ 默认 multi 模式完全不受影响（由其余全部集成测试守住）。
//
// 注：本文件必须在 import app 之前设置 AUTH_MODE，故不复用 helpers.ts（同 prod-cookie.test.ts）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AUTH_MODE = 'single';
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgres://postgres:postgres@localhost:5433/artifacts_platform_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
// 刻意不设 ADMIN_EMAIL：single 模式的管理员身份来自「首个注册」而非邮箱匹配
process.env.ADMIN_EMAIL = '';
process.env.ALIYUN_AK_ID = '';
process.env.ALIYUN_AK_SECRET = '';
process.env.ALIYUN_GREEN_ENDPOINT = '';
process.env.ALIYUN_GREEN_SERVICE = '';
process.env.RUNNER_ORIGIN = 'https://run.artifacts.orienthong.cn';
process.env.SITES_ROOT = mkdtempSync(join(tmpdir(), 'artifacts-single-test-'));

const db = await import('../../src/db.js');
const appModule = await import('../../src/app.js');
const { pool, initSchema } = db;
const { app } = appModule;

function register(username: string) {
  return app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.9.${username.length}` },
    body: JSON.stringify({
      email: `${username}@self.host`,
      username,
      password: 'password123',
      agreeTerms: true,
    }),
  });
}

describe('AUTH_MODE=single（dual-track roadmap OS-2）', () => {
  beforeAll(async () => {
    await initSchema();
    const { rows } = await pool.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'"
    );
    if (rows.length) {
      await pool.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(', ')} cascade`);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('空库首个注册者自动成为管理员（不依赖 ADMIN_EMAIL），且配额全豁免', async () => {
    const res = await register('owner');
    expect(res.status).toBe(201);
    const { user } = (await res.json()) as {
      user: { isAdmin: boolean };
    };
    expect(user.isAdmin).toBe(true);
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
    const me = await app.request('/api/me', { headers: { cookie } });
    const { user: meUser } = (await me.json()) as { user: { quotas: Record<string, number> } };
    expect(meUser.quotas).toEqual({ customPaths: 0, sites: 0, apiTokens: 0, dailyCreates: 0 });
  });

  it('已有用户后注册关闭 → 403，文案说明单用户实例', async () => {
    const res = await register('intruder');
    expect(res.status).toBe(403);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain('单用户');
  });
});
