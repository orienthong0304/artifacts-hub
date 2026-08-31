// API 层 Origin 校验（契约 §3 安全注记）：拦截同 eTLD 子域会话骑乘（CSRF）。
// 用户 ZIP 站点 <sub>.artifacts.orienthong.cn 与控制面同 registrable domain，其 JS 可
// credentials:'include' 向 /api/* 发 CORS simple POST（multipart/表单类无预检），SameSite=Lax
// + host-only cookie 会被附带。csrfGuard 对 cookie 认证的状态变更请求做 Origin 白名单校验。
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

/** 合法作品创建体（内容简单，机审在测试环境为 disabled） */
const artifactBody = () =>
  JSON.stringify({
    title: 'CSRF 测试作品',
    type: 'html',
    code: '<!doctype html><title>t</title><p>hi</p>',
    visibility: 'unlisted',
  });

/** 用 cookie 创建 API Token，返回明文 */
async function createToken(cookie: string): Promise<string> {
  const res = await app.request('/api/tokens', { method: 'POST', headers: { cookie } });
  if (res.status !== 201) throw new Error(`建 token 失败: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { token: string }).token;
}

describe('CSRF：API 层 Origin 校验（契约 §3 安全注记）', () => {
  it('① cookie 认证 + 恶意子域 Origin 的 POST → 403', async () => {
    const { cookie } = await registerUser('csrf1');
    const res = await app.request('/api/artifacts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: 'https://evil.artifacts.orienthong.cn',
      },
      body: artifactBody(),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('请求来源不被允许');
  });

  it('② cookie 认证 + 白名单 Origin（生产源 / 开发源）的 POST → 201', async () => {
    const { cookie } = await registerUser('csrf2');

    const prod = await app.request('/api/artifacts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: 'https://artifacts.orienthong.cn',
      },
      body: artifactBody(),
    });
    expect(prod.status).toBe(201);

    // 测试环境非生产 → 白名单含 http://localhost:5173
    const dev = await app.request('/api/artifacts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: 'http://localhost:5173',
      },
      body: artifactBody(),
    });
    expect(dev.status).toBe(201);
  });

  it('③ cookie 认证 + 无 Origin 头 → 201（现有用例天然回归）', async () => {
    const { cookie } = await registerUser('csrf3');
    const res = await app.request('/api/artifacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: artifactBody(),
    });
    expect(res.status).toBe(201);
  });

  it('④ Bearer 认证 + 恶意子域 Origin → 放行（201，无 cookie CSRF 面）', async () => {
    const { cookie } = await registerUser('csrf4');
    const token = await createToken(cookie);
    const res = await app.request('/api/artifacts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        origin: 'https://evil.artifacts.orienthong.cn',
      },
      body: artifactBody(),
    });
    expect(res.status).toBe(201);
  });

  it('⑤ GET + 恶意子域 Origin → 不拦（安全方法）', async () => {
    const { cookie } = await registerUser('csrf5');
    const res = await app.request('/api/me', {
      headers: { cookie, origin: 'https://evil.artifacts.orienthong.cn' },
    });
    expect(res.status).toBe(200);
  });
});
