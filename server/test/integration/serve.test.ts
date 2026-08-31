// 子域 shell 就地渲染与换票(契约 §3.10):Host 头驱动,app.request 全程可测
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { app, pool, initSchema, resetDb, registerUser } from './helpers.js';
import { CONTACT_EMAIL, ICP_NUMBER, OPERATOR_LABEL } from '../../src/branding.js';

const HOST = { host: 'hank-lab.artifacts.orienthong.cn' };
const RUNNER = 'https://run.artifacts.orienthong.cn';

beforeAll(async () => {
  await initSchema();
});
beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await pool.end();
});

/** 复用 subdomain.test.ts 的辅助:领取前缀 + 发布 + 设路径 */
async function setup(
  visibility: string,
  type = 'html',
  code?: string,
  extra: Record<string, unknown> = {}
) {
  const { cookie } = await registerUser('hank');
  await app.request('/api/me/subdomain', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ prefix: 'hank-lab' }),
  });
  const pub = await app.request('/api/artifacts', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      title: '直出测试',
      type,
      code:
        code ??
        (type === 'html' ? '<!doctype html><h1>直出内容</h1>' : 'export default () => <h1>hi</h1>'),
      visibility,
      ...extra,
    }),
  });
  const { artifact } = (await pub.json()) as { artifact: { id: string; slug: string } };
  await app.request(`/api/artifacts/${artifact.id}/custom-path`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ customPath: 'page' }),
  });
  return { cookie, artifact };
}

/** shell 共性断言:runner iframe(opaque sandbox)+ badge:true(契约 §3.10/§4) */
function expectShell(body: string) {
  expect(body).toContain(`src="${RUNNER}/"`);
  expect(body).toContain('sandbox="allow-scripts allow-forms allow-popups allow-modals"');
  expect(body).not.toContain('allow-same-origin');
  expect(body).toContain('"badge":true');
  expect(body).toContain('__artifacts');
}

/**
 * 子域响应安全头共性断言（计划 W1-4）：shell 与 404 同一套。
 * frame 策略防点击劫持——被内嵌后可用浮层遮住 runner 角标与举报入口。
 * 同时守住「CSP 只发 frame-ancestors」：加 default-src/script-src 会打断 shell 握手与作品渲染。
 */
function expectSubdomainHeaders(res: Response) {
  const csp = res.headers.get('content-security-policy') ?? '';
  expect(csp).toContain("frame-ancestors 'self'");
  expect(csp).not.toMatch(/(^|;)\s*(default-src|script-src)/i);
  expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
}

describe('子域 shell 渲染(契约 §3.10)', () => {
  it('HTML·unlisted → 200 shell(runner iframe+转义内联 code+badge)+ views 计数 + max-age=60', async () => {
    const { artifact } = await setup('unlisted');
    const res = await app.request('/page', { headers: HOST });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    const body = await res.text();
    expectShell(body);
    expect(body).toContain('"kind":"html"');
    // code 以 JSON 内联且 < 已转义(u003c),不再直出原始 HTML
    expect(body).toContain('直出内容');
    expect(body).toContain('u003ch1>');
    expect(body).not.toContain('<h1>直出内容');
    // 标题进 <title>(HTML 转义后)
    expect(body).toContain('<title>直出测试</title>');
    const v = await pool.query('select views from artifacts where id = $1', [artifact.id]);
    expect(v.rows[0].views).toBe(1);
  });
  it('React → 200 shell(kind react,不再 302);路径未命中/前缀未注册 → 404', async () => {
    const { artifact } = await setup('unlisted', 'react');
    const res = await app.request('/page', { headers: HOST });
    expect(res.status).toBe(200);
    const body = await res.text();
    expectShell(body);
    expect(body).toContain('"kind":"react"');
    const v = await pool.query('select views from artifacts where id = $1', [artifact.id]);
    expect(v.rows[0].views).toBe(1);
    expect((await app.request('/nope', { headers: HOST })).status).toBe(404);
    expect(
      (await app.request('/page', { headers: { host: 'ghost.artifacts.orienthong.cn' } })).status
    ).toBe(404);
  });
  it('主域请求不受影响(gate 直通)', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
  });
  it('私密 HTML:无会话 302 换票 → 全流程后 200 shell(no-store,不计数)', async () => {
    const { cookie, artifact } = await setup('private');
    // ① 子域裸访问 → 302 到主站换票
    const r1 = await app.request('/page', { headers: HOST });
    expect(r1.status).toBe(302);
    const subauthUrl = new URL(r1.headers.get('location')!);
    expect(subauthUrl.pathname).toBe('/api/subauth');
    // ② 主站换票(带登录 cookie)→ 302 回子域 __subauth
    const r2 = await app.request(`${subauthUrl.pathname}${subauthUrl.search}`, {
      headers: { cookie },
    });
    expect(r2.status).toBe(302);
    const landing = new URL(r2.headers.get('location')!);
    expect(landing.hostname).toBe('hank-lab.artifacts.orienthong.cn');
    expect(landing.pathname).toBe('/__subauth');
    // ③ 子域落票 → set-cookie sub_session + 302 /page
    const r3 = await app.request(`${landing.pathname}${landing.search}`, { headers: HOST });
    expect(r3.status).toBe(302);
    expect(r3.headers.get('location')).toBe('/page');
    const setCookie = r3.headers.get('set-cookie')!;
    expect(setCookie).toContain('sub_session=');
    expect(setCookie.toLowerCase()).toContain('httponly');
    const subSession = setCookie.split(';')[0];
    // ④ 带会话访问 → 200 shell,no-store,不计数
    const r4 = await app.request('/page', { headers: { ...HOST, cookie: subSession } });
    expect(r4.status).toBe(200);
    expect(r4.headers.get('cache-control')).toBe('no-store');
    expectShell(await r4.text());
    const v = await pool.query('select views from artifacts where id = $1', [artifact.id]);
    expect(v.rows[0].views).toBe(0);
  });
  it('换票兜底:未登录 → 302 登录页带 next;非所有者/未命中 → 404(不泄露);伪 code → 403', async () => {
    const { cookie } = await setup('private');
    // 未登录 → 302 主站登录页,next 为原换票地址(urlencode 回跳)
    const anon = await app.request('/api/subauth?prefix=hank-lab&path=page');
    expect(anon.status).toBe(302);
    const loginUrl = new URL(anon.headers.get('location')!);
    expect(loginUrl.hostname).toBe('artifacts.orienthong.cn');
    expect(loginUrl.pathname).toBe('/login');
    expect(loginUrl.searchParams.get('next')).toBe('/api/subauth?prefix=hank-lab&path=page');
    // 非所有者 → 404,与 serve 端点同口径,不泄露 slug 与存在性
    const { cookie: other } = await registerUser('ivan');
    const stranger = await app.request('/api/subauth?prefix=hank-lab&path=page', {
      headers: { cookie: other },
    });
    expect(stranger.status).toBe(404);
    // 所有者但路径无作品 → 404
    const miss = await app.request('/api/subauth?prefix=hank-lab&path=nope', {
      headers: { cookie },
    });
    expect(miss.status).toBe(404);
    // 伪 code 落票 → 403
    const bad = await app.request('/__subauth?code=bad&next=/page', { headers: HOST });
    expect(bad.status).toBe(403);
  });
  it('code 跨前缀无效:第一用户的有效 code 打其它前缀落票 → 403', async () => {
    const { cookie } = await setup('private');
    // hank 走换票流程拿到真实 landing URL(含绑定 hank-lab 的有效 code)
    const r1 = await app.request('/page', { headers: HOST });
    const subauthUrl = new URL(r1.headers.get('location')!);
    const r2 = await app.request(`${subauthUrl.pathname}${subauthUrl.search}`, {
      headers: { cookie },
    });
    const landing = new URL(r2.headers.get('location')!);
    // 第二用户领取 ivan-lab,用 hank 的 code 打 ivan-lab 的 __subauth → 403
    const { cookie: other } = await registerUser('ivan');
    await app.request('/api/me/subdomain', {
      method: 'POST',
      headers: { cookie: other, 'content-type': 'application/json' },
      body: JSON.stringify({ prefix: 'ivan-lab' }),
    });
    const res = await app.request(`${landing.pathname}${landing.search}`, {
      headers: { host: 'ivan-lab.artifacts.orienthong.cn' },
    });
    expect(res.status).toBe(403);
  });
  it('子域零主站 API 面:POST 任意路径 → 404', async () => {
    await setup('unlisted');
    const res = await app.request('/api/artifacts', { method: 'POST', headers: HOST });
    expect(res.status).toBe(404);
    const res2 = await app.request('/page', { method: 'POST', headers: HOST });
    expect(res2.status).toBe(404);
  });
  it('落票消毒:next=/\\evil.com(协议相对)→ Location 回退 /', async () => {
    const { cookie } = await setup('private');
    // 走全流程拿到真实 landing URL(含有效 code)
    const r1 = await app.request('/page', { headers: HOST });
    const subauthUrl = new URL(r1.headers.get('location')!);
    const r2 = await app.request(`${subauthUrl.pathname}${subauthUrl.search}`, {
      headers: { cookie },
    });
    const landing = new URL(r2.headers.get('location')!);
    // 把 next 换成恶意的协议相对值,复用有效 code
    landing.searchParams.set('next', '/\\evil.com');
    const r3 = await app.request(`${landing.pathname}${landing.search}`, { headers: HOST });
    expect(r3.status).toBe(302);
    expect(r3.headers.get('location')).toBe('/');
  });
  it('HTML·public → 200 shell(与 unlisted 同分支)', async () => {
    await setup('public');
    const res = await app.request('/page', { headers: HOST });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    const body = await res.text();
    expectShell(body);
    expect(body).toContain('直出内容');
  });
  it('已设 custom_path 的作品被下架后 → 子域访问 404(不泄露)', async () => {
    const { artifact } = await setup('unlisted');
    expect((await app.request('/page', { headers: HOST })).status).toBe(200);
    await pool.query('update artifacts set is_taken_down = true where id = $1', [artifact.id]);
    const res = await app.request('/page', { headers: HOST });
    expect(res.status).toBe(404);
  });
  it('带访问密码的 HTML → 302 查看页(解锁在查看页,V1 不做子域解锁)', async () => {
    const { cookie, artifact } = await setup('unlisted');
    await app.request(`/api/artifacts/${artifact.id}`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ accessPassword: 'pass1234' }),
    });
    const res = await app.request('/page', { headers: HOST });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain(`/a/${artifact.slug}`);
  });
  it('安全:子域响应带 frame 策略——shell / 404 / 非 GET / 伪 code 落票 四类同一套头（W1-4）', async () => {
    const { artifact } = await setup('unlisted');

    // ① shell 本体
    const shell = await app.request('/page', { headers: HOST });
    expect(shell.status).toBe(200);
    expectSubdomainHeaders(shell);

    // ② 路径未命中 404（404 页同样可被内嵌，用于遮挡举报入口）
    const miss = await app.request('/no-such-path', { headers: HOST });
    expect(miss.status).toBe(404);
    expectSubdomainHeaders(miss);

    // ③ 前缀未注册 404
    const unknown = await app.request('/', {
      headers: { host: 'no-such-prefix.artifacts.orienthong.cn' },
    });
    expect(unknown.status).toBe(404);
    expectSubdomainHeaders(unknown);

    // ④ 非 GET/HEAD → 404（子域零主站 API 面）
    const posted = await app.request('/page', { method: 'POST', headers: HOST });
    expect(posted.status).toBe(404);
    expectSubdomainHeaders(posted);

    // ⑤ 伪 code 落票 403
    const badCode = await app.request('/__subauth?code=forged', { headers: HOST });
    expect(badCode.status).toBe(403);
    expectSubdomainHeaders(badCode);

    // 顺带确认 ① 没被 no-store 污染（缓存策略与安全头互不干扰）
    expect(shell.headers.get('cache-control')).toBe('public, max-age=60');
    expect(miss.headers.get('cache-control')).toBe('no-store');
    void artifact;
  });

  it('OG 补齐:公开作品 shell 含 og:description/image/site_name/type/twitter:card 与 canonical（W1-4）', async () => {
    await setup('unlisted');
    const res = await app.request('/page', { headers: HOST });
    expect(res.status).toBe(200);
    const body = await res.text();
    for (const tag of ['og:description', 'og:image', 'og:site_name', 'og:type', 'twitter:card']) {
      expect(body, tag).toContain(tag);
    }
    // canonical 指向子域权威地址
    expect(body).toContain('rel="canonical"');
    expect(body).toContain('hank-lab.artifacts.orienthong.cn/page');
    // 无描述时用站点级兜底，卡片不会只剩一个标题
    expect(body).toContain('把 AI 生成的页面变成可分享的链接');
    // noscript 回退：不跑 JS 的抓取器也能读到标题
    expect(body).toContain('<noscript>');
    // 渲染失败兜底：shell 现在处理 error 且只在 fatal 时覆盖页面
    expect(body).toContain("data.type === 'error'");
    expect(body).toContain('data.fatal !== false');
    // rendered 才停掉超时计时（此前收到 ready 就 clear，渲染随后失败即永久空白）
    expect(body).toContain("data.type === 'rendered'");
  });

  it('私密作品 shell 只输出站点级标题 + noindex,不泄露真实标题与描述（W1-4）', async () => {
    const { cookie } = await setup('private');
    // 走完换票拿到会话
    const r1 = await app.request('/page', { headers: HOST });
    const subauthUrl = new URL(r1.headers.get('location')!);
    const r2 = await app.request(`${subauthUrl.pathname}${subauthUrl.search}`, { headers: { cookie } });
    const landing = new URL(r2.headers.get('location')!);
    const r3 = await app.request(`${landing.pathname}${landing.search}`, { headers: HOST });
    const subSession = r3.headers.get('set-cookie')!.split(';')[0];

    const res = await app.request('/page', { headers: { ...HOST, cookie: subSession } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('noindex');
    // 真实标题与 OG 描述都不得出现
    expect(body).not.toContain('直出测试');
    expect(body).not.toContain('og:description');
    expect(body).not.toContain('rel="canonical"');
  });

  it('404 品牌化:含主体/备案号/回主站入口/举报邮箱,且四类 404 页面完全一致（不泄露存在性,W1-8）', async () => {
    await setup('unlisted');

    const bodies: string[] = [];
    for (const [label, res] of [
      ['路径未命中', await app.request('/no-such-path', { headers: HOST })],
      ['前缀未注册', await app.request('/', { headers: { host: 'no-such-prefix.artifacts.orienthong.cn' } })],
      ['非 GET', await app.request('/page', { method: 'POST', headers: HOST })],
    ] as const) {
      expect(res.status, label).toBe(404);
      expect(res.headers.get('content-type'), label).toContain('text/html');
      const body = await res.text();
      // 品牌与公示要素
      expect(body, label).toContain('Artifacts');
      if (ICP_NUMBER) expect(body, label).toContain(ICP_NUMBER);
      // 公示邮箱断言引 branding 常量：开源导出版默认值为空，此时 404 页不渲染邮箱段
      if (CONTACT_EMAIL) expect(body, label).toContain(CONTACT_EMAIL);
      expect(body, label).toContain('/explore');
      // 不索引（404 页不该进搜索引擎）
      expect(body, label).toContain('noindex');
      // 不泄露任何具体信息：不得出现 slug / 标题 / 前缀
      expect(body, label).not.toContain('直出测试');
      expect(body, label).not.toContain('hank-lab');
      bodies.push(body);
    }
    // 三类 404 的响应体逐字节相同——否则可据差异反推「前缀存在但路径不存在」
    expect(bodies[1]).toBe(bodies[0]);
    expect(bodies[2]).toBe(bodies[0]);
  });

  it('安全:code 含 </script> 注入串 → 仅以转义形式内联,不闭合 shell script', async () => {
    const evil = '<!doctype html><h1>ok</h1></script><script>alert(1)</script>';
    await setup('unlisted', 'html', evil);
    const res = await app.request('/page', { headers: HOST });
    expect(res.status).toBe(200);
    const body = await res.text();
    // 裸的 </script><script>alert 绝不出现(否则提前闭合 shell 的 script 标签)
    expect(body).not.toContain('</script><script>alert');
    // 注入串以 JSON+u003c 转义形式存在于内联 payload 中
    expect(body).toContain('u003c/script>');
    expect(body).toContain('alert(1)');
    expectShell(body);
  });
});

describe('生成合成内容标识（契约 §3.11）', () => {
  it('公开作品 shell 带隐式标识元数据——传播平台义务，标识须随内容一起传播', async () => {
    await setup('public');
    const res = await app.request('/page', { headers: HOST });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<meta name="aigc-label" content="1">');
    if (OPERATOR_LABEL) {
      expect(body).toContain(`<meta name="aigc-propagator" content="${OPERATOR_LABEL}">`);
    }
    expect(body).toMatch(/<meta name="aigc-propagate-id" content="[A-Za-z0-9_-]{8}">/);
  });

  it('render payload 带 aiLabel → runner 角标据此承载标识（契约 §4）', async () => {
    await setup('public');
    const body = await (await app.request('/page', { headers: HOST })).text();
    expect(body).toContain('"aiLabel":true');
  });

  it('作者声明为非 AI 生成 → 不带标识（标识只能加给声明为生成内容的作品）', async () => {
    await setup('public', 'html', undefined, { aiGenerated: false });
    const body = await (await app.request('/page', { headers: HOST })).text();
    expect(body).not.toContain('aigc-label');
    expect(body).not.toContain('aigc-propagate-id');
    expect(body).toContain('"aiLabel":false');
  });

  it('私密作品带标识但不输出内容编号——编号是新标识符，私密分支坚持不多泄露一个字段', async () => {
    const { cookie } = await setup('private');
    // 私密子域需走完整换票（同「私密 HTML:无会话 302 换票」用例）后才能拿到 shell
    const r1 = await app.request('/page', { headers: HOST });
    const subauthUrl = new URL(r1.headers.get('location')!);
    const r2 = await app.request(`${subauthUrl.pathname}${subauthUrl.search}`, {
      headers: { cookie },
    });
    const landing = new URL(r2.headers.get('location')!);
    const r3 = await app.request(`${landing.pathname}${landing.search}`, { headers: HOST });
    const subSession = r3.headers.get('set-cookie')!.split(';')[0];
    const res = await app.request('/page', { headers: { ...HOST, cookie: subSession } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<meta name="aigc-label" content="1">');
    expect(body).not.toContain('aigc-propagate-id');
  });
});
