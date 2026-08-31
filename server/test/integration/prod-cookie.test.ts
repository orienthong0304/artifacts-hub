// 生产 cookie 语义（契约 §3 / §3.10；计划 W1-2）
//
// 其余集成测试都跑在 NODE_ENV != production 下，此时 COOKIE_NAME === LEGACY_COOKIE_NAME
// === 'artifacts_token'，「是否兼容读取旧名」在行为上不可区分。本文件独立把 NODE_ENV 置为
// production 后再加载 app，专门守住两条只在生产分支成立的安全性质：
//
// ① 主站不再兜底读无前缀旧名 `artifacts_token`。用户 ZIP 站点与前缀子域的 JS 跑在
//    <sub>.artifacts.orienthong.cn 真实顶层源上，可写 Domain=artifacts.orienthong.cn 的
//    平级域 cookie；若主站仍读旧名，未登录访客访问主站即被静默登入攻击者账号（会话固定）。
// ② 子域私密查看会话 cookie 带 `__Host-` 前缀且无 Domain——只对签发它的那一个子域生效。
//
// 注：本文件必须在 import app 之前设置 NODE_ENV，故不复用 helpers.ts（它在模块加载时就建连接池）。
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'production';
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgres://postgres:postgres@localhost:5433/artifacts_platform_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ALIYUN_AK_ID = '';
process.env.ALIYUN_AK_SECRET = '';
process.env.ALIYUN_GREEN_ENDPOINT = '';
process.env.ALIYUN_GREEN_SERVICE = '';
process.env.RUNNER_ORIGIN = 'https://run.artifacts.orienthong.cn';
process.env.SITES_ROOT = mkdtempSync(join(tmpdir(), 'artifacts-prodcookie-test-'));

const db = await import('../../src/db.js');
const appModule = await import('../../src/app.js');
const authModule = await import('../../src/auth.js');
const serveModule = await import('../../src/routes/serve.js');

const { pool, initSchema } = db;
const { app } = appModule;

beforeAll(async () => {
  await initSchema();
});
beforeEach(async () => {
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

let ipCounter = 0;

/** 注册并返回 set-cookie 原文与解析出的 cookie 头值 */
async function register(username: string, email = `${username}@test.local`) {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.1.0.${++ipCounter}` },
    body: JSON.stringify({ email, username, password: 'password123', agreeTerms: true }),
  });
  if (res.status !== 201) throw new Error(`注册失败: ${res.status} ${await res.text()}`);
  const setCookie = res.headers.get('set-cookie') ?? '';
  return { setCookie, cookie: setCookie.split(';')[0] };
}

describe('生产 cookie 语义（NODE_ENV=production）', () => {
  it('前置确认：确实跑在生产分支（cookie 名带 __Host- 前缀，且 Set-Cookie 含 Secure、无 Domain）', () => {
    expect(authModule.COOKIE_NAME).toBe('__Host-artifacts_token');
    expect(serveModule.SUB_SESSION_COOKIE).toBe('__Host-sub_session');
  });

  it('① 登录 Set-Cookie 用 __Host- 前缀，含 Secure/Path=/、不含 Domain', async () => {
    const { setCookie, cookie } = await register('produser');
    expect(cookie.startsWith('__Host-artifacts_token=')).toBe(true);
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('HttpOnly');
    // __Host- 前缀的浏览器强制要求：绝不能带 Domain
    expect(setCookie.toLowerCase()).not.toContain('domain=');

    // 该 cookie 本身能正常鉴权
    const me = await app.request('/api/me', { headers: { cookie } });
    expect(me.status).toBe(200);
  });

  it('② 旧名 artifacts_token 不再放行——即便携带的是他人真实有效的 JWT（会话固定防护）', async () => {
    // 攻击者拿到自己的有效登录态，把 token 取出
    const { cookie: attackerCookie } = await register('prodattacker');
    const attackerJwt = attackerCookie.split('=')[1];
    expect(attackerJwt.length).toBeGreaterThan(20);

    // 前置确认：这个 JWT 本身是有效的（用正确的前缀名可鉴权成功）
    const valid = await app.request('/api/me', {
      headers: { cookie: `__Host-artifacts_token=${attackerJwt}` },
    });
    expect(valid.status).toBe(200);
    expect(((await valid.json()) as { user: { username: string } }).user.username).toBe(
      'prodattacker'
    );

    // 关键断言：子域可写的平级域旧名 cookie 一律不被采信 → 401，而不是被登入攻击者账号
    const tossed = await app.request('/api/me', {
      headers: { cookie: `artifacts_token=${attackerJwt}` },
    });
    expect(tossed.status).toBe(401);

    // 旧名与新名同时存在时，只认新名（不因旧名在前而被劫持）
    const { cookie: victimCookie } = await register('prodvictim');
    const victimJwt = victimCookie.split('=')[1];
    const both = await app.request('/api/me', {
      headers: { cookie: `artifacts_token=${attackerJwt}; __Host-artifacts_token=${victimJwt}` },
    });
    expect(both.status).toBe(200);
    expect(((await both.json()) as { user: { username: string } }).user.username).toBe(
      'prodvictim'
    );
  });

  it('③ 登出仍清除新旧两个名字（存量旧 cookie 不会永久滞留浏览器）', async () => {
    const res = await app.request('/api/auth/logout', { method: 'POST' });
    const raw = res.headers.get('set-cookie') ?? '';
    expect(raw).toContain('__Host-artifacts_token=;');
    expect(raw).toContain('artifacts_token=;');
    expect(raw).toContain('Max-Age=0');
  });
});
