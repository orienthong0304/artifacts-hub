// API Token 集成测试（契约 §3.8）：明文只出现一次、Bearer 鉴权、撤销即失效、上限 5、防自我繁殖
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
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

interface TokenInfo {
  id: string;
  label: string;
  lastFour: string;
  lastUsedAt?: string | null;
  createdAt: string;
}

/** 用 cookie 创建 token；label 缺省时不传请求体（契约：label 可选） */
async function createToken(cookie: string, label?: string): Promise<Response> {
  return app.request('/api/tokens', {
    method: 'POST',
    headers: {
      cookie,
      ...(label !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(label !== undefined ? { body: JSON.stringify({ label }) } : {}),
  });
}

describe('API Token（契约 §3.8）', () => {
  it('① 创建 → 明文仅此一次返回，格式 ak_+32 位 url-safe，lastFour 为末四位，库里只存 sha256', async () => {
    const { cookie } = await registerUser('dev1');
    const res = await createToken(cookie, '我的 CI Token');
    expect(res.status).toBe(201);
    const data = (await res.json()) as { token: string; tokenInfo: TokenInfo };

    expect(data.token).toMatch(/^ak_[0-9a-zA-Z_-]{32}$/);
    expect(data.tokenInfo.label).toBe('我的 CI Token');
    expect(data.tokenInfo.lastFour).toBe(data.token.slice(-4));
    expect(data.tokenInfo.id).toBeTruthy();
    expect(data.tokenInfo.createdAt).toBeTruthy();
    // tokenInfo 不夹带明文/哈希
    expect(JSON.stringify(data.tokenInfo)).not.toContain(data.token);

    // 服务端只存 sha256 哈希，绝无明文
    const row = await pool.query<{ token_hash: string; last_four: string }>(
      'select token_hash, last_four from api_tokens where id = $1',
      [data.tokenInfo.id]
    );
    const expectedHash = createHash('sha256').update(data.token).digest('hex');
    expect(row.rows[0].token_hash).toBe(expectedHash);
    expect(row.rows[0].last_four).toBe(data.token.slice(-4));

    // label 缺省 → "API Token"
    const res2 = await createToken(cookie);
    expect(res2.status).toBe(201);
    const data2 = (await res2.json()) as { token: string; tokenInfo: TokenInfo };
    expect(data2.tokenInfo.label).toBe('API Token');
  });

  it('② Bearer 调 GET /api/me 与 POST /api/artifacts 成功，作品归属正确', async () => {
    const { cookie } = await registerUser('dev2');
    const { token } = (await (await createToken(cookie)).json()) as { token: string };
    const bearer = { authorization: `Bearer ${token}` };

    const me = await app.request('/api/me', { headers: bearer });
    expect(me.status).toBe(200);
    const meData = (await me.json()) as { user: { id: string; username: string } };
    expect(meData.user.username).toBe('dev2');

    const created = await app.request('/api/artifacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...bearer },
      body: JSON.stringify({
        title: 'Agent 发布的作品',
        type: 'html',
        code: '<h1>Hello</h1>',
        visibility: 'unlisted',
      }),
    });
    expect(created.status).toBe(201);
    const { artifact } = (await created.json()) as { artifact: { id: string; slug: string } };
    expect(artifact.slug).toBeTruthy();

    // 归属正确：落库 user_id 为 Bearer 对应用户
    const owner = await pool.query<{ user_id: string }>(
      'select user_id from artifacts where id = $1',
      [artifact.id]
    );
    expect(owner.rows[0].user_id).toBe(meData.user.id);
  });

  it('③ GET /api/tokens 不含明文/哈希；Bearer 使用后 lastUsedAt 非空；按创建倒序', async () => {
    const { cookie } = await registerUser('dev3');
    const { token, tokenInfo } = (await (await createToken(cookie, '先建')).json()) as {
      token: string;
      tokenInfo: TokenInfo;
    };
    await createToken(cookie, '后建');

    // 使用前：lastUsedAt 为 null
    const before = await app.request('/api/tokens', { headers: { cookie } });
    expect(before.status).toBe(200);
    const beforeItems = ((await before.json()) as { items: TokenInfo[] }).items;
    expect(beforeItems).toHaveLength(2);
    expect(beforeItems[0].label).toBe('后建'); // created_at 倒序
    expect(beforeItems.find((t) => t.id === tokenInfo.id)?.lastUsedAt).toBeNull();

    // Bearer 用一次
    expect((await app.request('/api/me', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);

    const after = await app.request('/api/tokens', { headers: { cookie } });
    const raw = await after.text();
    // 绝不返回明文或哈希
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(createHash('sha256').update(token).digest('hex'));
    const items = (JSON.parse(raw) as { items: TokenInfo[] }).items;
    expect(items.find((t) => t.id === tokenInfo.id)?.lastUsedAt).toBeTruthy();
  });

  it('④ 撤销后 Bearer 失效（401）；已撤销的不再出现在列表；他人 token 404', async () => {
    const { cookie } = await registerUser('dev4');
    const { cookie: otherCookie } = await registerUser('other4');
    const { token, tokenInfo } = (await (await createToken(cookie)).json()) as {
      token: string;
      tokenInfo: TokenInfo;
    };

    // 撤销前 Bearer 可用
    expect((await app.request('/api/me', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);

    // 他人撤销 → 404（不泄露存在性）
    const foreign = await app.request(`/api/tokens/${tokenInfo.id}`, {
      method: 'DELETE',
      headers: { cookie: otherCookie },
    });
    expect(foreign.status).toBe(404);

    // 本人撤销 → 204
    const revoke = await app.request(`/api/tokens/${tokenInfo.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(revoke.status).toBe(204);

    // Bearer 立即失效：无 cookie 时按未登录处理
    expect((await app.request('/api/me', { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);

    // 列表不含已撤销
    const list = await app.request('/api/tokens', { headers: { cookie } });
    expect(((await list.json()) as { items: TokenInfo[] }).items).toHaveLength(0);
  });

  it('⑤ Bearer 不能创建 token（防自我繁殖）→ 403', async () => {
    const { cookie } = await registerUser('dev5');
    const { token } = (await (await createToken(cookie)).json()) as { token: string };

    const res = await app.request('/api/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ label: '繁殖尝试' }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('请在网页登录后创建 Token');
  });

  it('⑥ 每用户有效 token free 档上限 10(契约 §3.12)，超限 400；撤销后名额释放', async () => {
    const { cookie } = await registerUser('dev6');
    const infos: TokenInfo[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await createToken(cookie, `t${i}`);
      expect(res.status).toBe(201);
      infos.push(((await res.json()) as { tokenInfo: TokenInfo }).tokenInfo);
    }
    const overflow = await createToken(cookie, '超限');
    expect(overflow.status).toBe(400);
    expect(((await overflow.json()) as { error: string }).error).toBe('有效 Token 已达上限（10 个）');

    // 撤销一个后可再创建
    await app.request(`/api/tokens/${infos[0].id}`, { method: 'DELETE', headers: { cookie } });
    expect((await createToken(cookie, '补位')).status).toBe(201);
  });

  it('⑦ 无效 Bearer → 走 cookie 兜底；无 cookie 则 401', async () => {
    const { cookie } = await registerUser('dev7');
    const fake = `Bearer ak_${'x'.repeat(32)}`;

    // 无效 Bearer + 无 cookie → 401
    expect((await app.request('/api/me', { headers: { authorization: fake } })).status).toBe(401);

    // 无效 Bearer + 有效 cookie → cookie 兜底成功
    const res = await app.request('/api/me', { headers: { authorization: fake, cookie } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { username: string } }).user.username).toBe('dev7');
  });

  it('⑧ Bearer scheme 大小写不敏感：小写 bearer 调 /api/me 成功', async () => {
    const { cookie } = await registerUser('devcase');
    const { token } = (await (await createToken(cookie)).json()) as { token: string };

    const res = await app.request('/api/me', {
      headers: { authorization: `bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { username: string } }).user.username).toBe('devcase');
  });

  it('label 超 50 字 → 400；未登录访问三端点 → 401', async () => {
    const { cookie } = await registerUser('dev8');
    const long = await createToken(cookie, '啊'.repeat(51));
    expect(long.status).toBe(400);

    expect((await app.request('/api/tokens', { method: 'POST' })).status).toBe(401);
    expect((await app.request('/api/tokens')).status).toBe(401);
    expect((await app.request('/api/tokens/00000000-0000-0000-0000-000000000000', { method: 'DELETE' })).status).toBe(401);
  });
});
