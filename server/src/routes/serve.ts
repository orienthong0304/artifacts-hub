// 子域 shell 就地渲染与换票（契约 §3.10）：Host 头驱动；仅 GET/HEAD；主站 cookie 不参与
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { pool, type ArtifactWithAuthorRow } from '../db.js';
import { env } from '../env.js';
import { rateLimit } from '../ratelimit.js';
import {
  PRODUCT_NAME,
  ICP_NUMBER,
  OPERATOR_LABEL,
  CONTACT_EMAIL,
} from '../branding.js';
import { recordDailyView } from '../stats.js';
import {
  type AuthVariables,
  resolveJwtSecret,
  signSubauthCode,
  verifySubauthCode,
  signSubSession,
  verifySubSession,
  subSessionCookieNameFor,
  SUB_SESSION_TTL_SECONDS,
} from '../auth.js';

/** 子域私密查看会话 cookie（契约 §3.10；命名规则与理由见 auth.ts subSessionCookieNameFor）。
 *  **不做旧名兼容读取**：进行中的私密查看会话失效一次即可，换来杜绝平级域冒充。 */
export const SUB_SESSION_COOKIE = subSessionCookieNameFor(env.isProd);
const MAIN_ORIGIN = `https://${env.SITES_DOMAIN_SUFFIX}`;

/** Host → 用户前缀：host 形如 <prefix>.<SITES_DOMAIN_SUFFIX> 才命中；主域/多级/其它域返回 null */
export function parsePrefix(host: string | undefined): string | null {
  if (!host) return null;
  const bare = host.split(':')[0].toLowerCase();
  const suffix = `.${env.SITES_DOMAIN_SUFFIX}`;
  if (!bare.endsWith(suffix)) return null;
  const prefix = bare.slice(0, -suffix.length);
  return prefix && !prefix.includes('.') ? prefix : null;
}

type ServeContext = Context<{ Variables: AuthVariables }>;

async function findByPath(userId: string, path: string): Promise<ArtifactWithAuthorRow | null> {
  const result = await pool.query<ArtifactWithAuthorRow>(
    `select a.*, u.username as author_username, u.display_name as author_display_name,
            u.subdomain_prefix as author_subdomain_prefix
     from artifacts a join users u on u.id = a.user_id
     where a.user_id = $1 and a.custom_path = $2 and a.is_taken_down = false`,
    [userId, path]
  );
  return result.rows[0] ?? null;
}

/** 插入 HTML 文本/属性上下文前的转义（标题为用户可控） */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * JSON 内联进 <script> 的安全序列化：`<` 转义防用户 code 里的 `</script>`
 * 提前闭合 shell 脚本；U+2028/U+2029 转义防 JS 字符串字面量语法错误
 */
function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * 子域渲染 shell（契约 §3.10）：自包含极简 HTML，内嵌 runner iframe，
 * 收到 ready 后按契约 §4 协议 postMessage 一次 render（badge 由 runner 注入）。
 * 用户 code 不在子域真实 origin 执行——仅经 postMessage 进入 runner 的 opaque-origin 沙箱。
 */
/**
 * 生成合成内容的隐式标识（契约 §3.11）。
 *
 * 《人工智能生成合成内容标识办法》（2025-09-01 施行）第 4 条要求在内容的文件元数据中
 * 添加隐式标识，含内容属性、传播服务提供者信息与内容编号。标准（GB 45438-2025）定义的
 * 载体是图片/音视频的 EXIF/XMP 一类文件元数据字段；HTML 页面没有对应的二进制元数据段，
 * 故这里以 `<meta>` 承载同一组信息——刻意不伪装成标准规定的文件元数据格式，
 * 字段语义一一对应（Label / ContentPropagator / PropagateID），来源可自解释。
 *
 * ⚠️ 站长核对项：若后续按 GB 45438-2025 的字段命名做严格对齐，改这里一处即可
 * （断言在 `serve.test.ts` 的「生成合成内容标识」段）。
 *
 * `includeId=false` 用于私密分支：内容编号是一个新标识符，而私密 shell 的既定原则是
 * 除站点级标题外不多输出任何字段。标识义务由 Label 与 Propagator 两条满足。
 */
function aigcMeta(artifact: ArtifactWithAuthorRow, opts: { includeId: boolean }): string {
  if (!artifact.ai_generated) return '';
  const lines = [
    '<meta name="aigc-label" content="1">',
    `<meta name="aigc-propagator" content="${escapeHtml(OPERATOR_LABEL)}">`,
  ];
  if (opts.includeId) {
    lines.push(`<meta name="aigc-propagate-id" content="${escapeHtml(artifact.slug)}">`);
  }
  return '\n' + lines.join('\n');
}

function renderShellHtml(
  artifact: ArtifactWithAuthorRow,
  opts: { canonicalUrl?: string; isPrivate?: boolean } = {}
): string {
  const title = escapeHtml(artifact.title);
  const payload = serializeForScript({
    kind: artifact.type === 'react' ? 'react' : 'html',
    code: artifact.code,
    badge: true,
    // 生成合成内容的显著提示标识由 runner 角标承载（契约 §3.11 / §4）
    aiLabel: artifact.ai_generated,
  });
  // 私密作品：只输出站点级标题与 noindex，绝不把真实标题/描述泄露给抓取器
  // （拿到链接的人已经过了换票闸门，卡片不需要也不应该再暴露内容）
  if (opts.isPrivate) {
    return renderShellDocument({
      head: `<title>${escapeHtml(PRODUCT_NAME)}</title>
<meta name="robots" content="noindex,nofollow">${aigcMeta(artifact, { includeId: false })}`,
      payload,
      title: escapeHtml(PRODUCT_NAME),
    });
  }
  // 公开/不公开列出：补齐 OG（此前只有 title + og:title——每条发进微信的链接
  // 卡片都长成同一个站点级标题、无描述、无图，头号分享路径的点击率被系统性压低）
  const desc = artifact.description?.trim();
  const ogDesc = escapeHtml(
    desc ? (desc.length > 120 ? desc.slice(0, 119) + '…' : desc) : DEFAULT_OG_DESCRIPTION
  );
  const canonical = opts.canonicalUrl ? escapeHtml(opts.canonicalUrl) : '';
  return renderShellDocument({
    head: `<title>${title}</title>
<meta name="description" content="${ogDesc}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${escapeHtml(PRODUCT_NAME)}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${ogDesc}">
<meta property="og:image" content="${MAIN_ORIGIN}/og-cover.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">${aigcMeta(artifact, {
      includeId: true,
    })}${
      canonical ? `\n<meta property="og:url" content="${canonical}">\n<link rel="canonical" href="${canonical}">` : ''
    }`,
    payload,
    title,
  });
}

/** 站点级兜底描述：作品没写描述时用它，避免卡片只有一个标题 */
const DEFAULT_OG_DESCRIPTION = '用 Artifacts 发布的作品 — 把 AI 生成的页面变成可分享的链接';

/** shell 文档骨架：head 由调用方按公开/私密分别组装，body 与握手脚本共用 */
function renderShellDocument(opts: { head: string; payload: string; title: string }): string {
  const { head, payload, title } = opts;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
<style>html,body{margin:0;height:100%;background:#faf9f5}#af{position:fixed;inset:0;border:0;width:100%;height:100%;display:block}
#fb{position:fixed;inset:0;display:none;overflow:auto;padding:56px 24px;box-sizing:border-box;background:#faf9f5;
  font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1a1915;line-height:1.7}
#fb .in{max-width:34rem;margin:0 auto}
#fb h1{font-size:1.35rem;margin:0 0 .5rem;font-weight:600}
#fb p{color:#6b6963;font-size:.9rem;margin:.6rem 0}
#fb pre{white-space:pre-wrap;word-break:break-word;background:#fff;border:1px solid #e5e2da;border-radius:8px;
  padding:12px;font-size:.75rem;color:#6b6963;max-height:12rem;overflow:auto}
#fb a{display:inline-block;margin-right:.75rem;margin-top:1rem;padding:.5rem 1.1rem;border-radius:999px;
  font-size:.875rem;background:#1a1915;color:#faf9f5;text-decoration:none}
#fb a.ghost{background:transparent;color:#1a1915;border:1px solid #e5e2da}</style>
</head>
<body>
<iframe id="af" src="${env.RUNNER_ORIGIN}/" sandbox="allow-scripts allow-forms allow-popups allow-modals"></iframe>
<noscript><div style="padding:56px 24px;font-family:system-ui,sans-serif;color:#1a1915">
<h1 style="font-size:1.35rem">${title}</h1>
<p style="color:#6b6963">这个作品需要 JavaScript 才能渲染。请在浏览器中启用 JavaScript 后刷新。</p>
<a href="${MAIN_ORIGIN}/" style="color:#c96442">回到 Artifacts</a></div></noscript>
<div id="fb"><div class="in">
  <h1 id="fbt">渲染器加载失败</h1>
  <p id="fbm">请刷新页面重试。</p>
  <pre id="fbd" style="display:none"></pre>
  <a href="${MAIN_ORIGIN}/">回到 Artifacts</a><a class="ghost" href="${MAIN_ORIGIN}/explore">去广场看看</a>
</div></div>
<script>
(function () {
  var frame = document.getElementById('af');
  var done = false;
  function fail(title, msg, detail) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    document.getElementById('fbt').textContent = title;
    document.getElementById('fbm').textContent = msg;
    // 报错原文以 textContent 写入——绝不拼进 HTML（契约 §4.1：注入面）
    if (detail) {
      var d = document.getElementById('fbd');
      d.textContent = detail;
      d.style.display = 'block';
    }
    document.getElementById('fb').style.display = 'block';
  }
  // 收到 ready 前若 iframe 迟迟不加载（如渲染子域被 CSP frame-ancestors 拒载或网络失败），
  // 10 秒后显示兜底提示，避免用户面对纯米白屏无任何反馈
  var timer = setTimeout(function () {
    fail('渲染器加载失败', '可能是网络问题，或浏览器/网络策略拦截了渲染子域。请刷新重试，或换用其它网络。');
  }, 10000);
  // opaque origin：回消息 origin 恒为 "null"，以 event.source + __artifacts 标记校验（契约 §4）
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.__artifacts !== true) return;
    if (event.source !== frame.contentWindow) return;
    if (data.type === 'ready' && !sent) {
      sent = true;
      frame.contentWindow.postMessage({ __artifacts: true, type: 'render', payload: ${payload} }, '*');
      return;
    }
    // 渲染成功才停掉兜底计时（此前收到 ready 就 clearTimeout：渲染随后失败时
    // 访客会永久停在 runner 的空 placeholder 页上，零反馈）
    if (data.type === 'rendered') {
      done = true;
      clearTimeout(timer);
      return;
    }
    // 契约 §4.1：只有致命错误才覆盖页面；已渲染成功后的局部问题不打扰访客
    if (data.type === 'error' && data.fatal !== false) {
      fail('这个作品当前无法渲染', '作者可能需要修改一下代码。你可以稍后再试。', data.message || '');
    }
  });
  var sent = false;
})();
</script>
</body>
</html>
`;
}

/**
 * 子域响应的安全头基线（契约 §3.10）。**shell 与 404 走同一套**——404 也可被内嵌。
 *
 * 为什么必须在应用层发（而非只靠 OpenResty）：`docs/ops/wildcard-serve.md` 的
 * `location @api_serve` 只补了 HSTS 与 Referrer-Policy，没有 frame 策略。缺了它，
 * 子域 shell 可被任意站点内嵌做点击劫持，并用浮层遮住 runner 角标（回流入口）
 * 与查看页举报入口（合规必需）。
 *
 * CSP 只发 `frame-ancestors`：**绝不能加 default-src/script-src**——shell 依赖内联脚本
 * 完成 postMessage 握手，且用户作品在 runner 子域内渲染，收紧脚本策略会直接打断渲染。
 * X-Frame-Options 同时发一份，覆盖不支持 frame-ancestors 的老浏览器。
 */
function applySubdomainHeaders(c: ServeContext, cache: string): void {
  c.header('Cache-Control', cache);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Security-Policy', "frame-ancestors 'self'");
  c.header('X-Frame-Options', 'SAMEORIGIN');
}

async function serveShell(
  c: ServeContext,
  artifact: ArtifactWithAuthorRow,
  opts: { cache: string; countView: boolean; shell?: { canonicalUrl?: string; isPrivate?: boolean } }
): Promise<Response> {
  if (opts.countView) {
    try {
      await pool.query('update artifacts set views = views + 1 where id = $1', [artifact.id]);
    } catch (err) {
      console.error('[serve] views 计数失败:', err); // fail-soft，同详情接口语义
    }
    void recordDailyView(artifact.id);
  }
  applySubdomainHeaders(c, opts.cache);
  return c.html(renderShellHtml(artifact, opts.shell));
}

/**
 * 子域 404 / 403 的品牌化可诊断页（计划 W1-8）。
 *
 * 为什么值得做：分享链接打错、或作者把作品转为私密/被下架后，访客的落地页就是这里。
 * 它出现在我方备案域名的子域上，此前却是一行裸 `text/plain`——既白扔一次品牌曝光，
 * 也是访客唯一可能求助的地方（无壳查看页没有页脚，这里更没有）。
 *
 * 自包含极简 HTML，不引任何外部资源（子域上没有主站资产）。
 */
function renderNoticeHtml(opts: {
  title: string;
  reasons: string[];
  extra?: string;
}): string {
  const reasons = opts.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(opts.title)} · ${escapeHtml(PRODUCT_NAME)}</title>
<style>
:root{color-scheme:light}
html,body{margin:0;min-height:100%;background:#faf9f5;color:#1a1915;
  font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:34rem;margin:0 auto;padding:4rem 1.5rem;line-height:1.7}
h1{font-size:1.5rem;margin:0 0 .75rem;font-weight:600}
p,ul{color:#6b6963;font-size:.9rem;margin:.75rem 0}
ul{padding-left:1.25rem}
li{margin:.25rem 0}
a{color:#c96442;text-decoration:none}
a:hover{text-decoration:underline}
.actions{margin:1.75rem 0 0;display:flex;flex-wrap:wrap;gap:.75rem}
.btn{display:inline-block;padding:.5rem 1.1rem;border-radius:999px;font-size:.875rem;
  background:#1a1915;color:#faf9f5}
.btn.ghost{background:transparent;color:#1a1915;border:1px solid #e5e2da}
footer{margin-top:3rem;padding-top:1.25rem;border-top:1px solid #e5e2da;
  font-size:.75rem;color:#8a8880}
footer a{color:#8a8880}
</style>
</head>
<body>
<div class="wrap">
  <h1>${escapeHtml(opts.title)}</h1>
  <p>可能的原因：</p>
  <ul>${reasons}</ul>
  ${opts.extra ? `<p>${escapeHtml(opts.extra)}</p>` : ''}
  <div class="actions">
    <a class="btn" href="${MAIN_ORIGIN}/">回到 ${escapeHtml(PRODUCT_NAME)}</a>
    <a class="btn ghost" href="${MAIN_ORIGIN}/explore">去广场看看</a>
  </div>
  <footer>
    ${OPERATOR_LABEL ? `运营主体：${escapeHtml(OPERATOR_LABEL)}　·　` : ''}${
      CONTACT_EMAIL ? `投诉举报：<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>` : ''
    }${
      // ICP 备案是中国大陆特有公示（OS-3）：海外自托管留空即整行不渲染
      ICP_NUMBER
        ? `<br>\n    <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">${escapeHtml(ICP_NUMBER)}</a>`
        : ''
    }
  </footer>
</div>
</body>
</html>
`;
}

/** 子域 404：与 shell 同一套安全头 + 品牌化可诊断页 */
function subdomainNotFound(c: ServeContext): Response {
  applySubdomainHeaders(c, 'no-store');
  return c.html(
    renderNoticeHtml({
      title: '找不到这个页面',
      reasons: [
        '链接输入有误，或复制时被截断',
        '作者已把该作品设为私密，或删除了它',
        '该作品因违反社区规范被下架',
      ],
      extra: '如果你确认链接无误，可以联系分享给你的人再确认一次。',
    }),
    404
  );
}

async function handleServe(c: ServeContext, prefix: string, pathname: string): Promise<Response> {
  const path = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  const reg = await pool.query<{ kind: string; ref: string }>(
    'select kind, ref from subdomain_registry where name = $1',
    [prefix]
  );
  // 站点子域正常由 OpenResty 磁盘直出，落到这里说明文件缺失——与未注册同样按 404 处理
  if (!reg.rows[0] || reg.rows[0].kind !== 'user') return subdomainNotFound(c);
  const artifact = await findByPath(reg.rows[0].ref, path);
  if (!artifact) return subdomainNotFound(c);

  const viewerUrl = `${MAIN_ORIGIN}/a/${artifact.slug}`;
  // 仅带密码作品回查看页（解锁流程在查看页）；HTML/React 均由子域 shell 就地渲染（契约 §3.10）
  if (artifact.access_password_hash) {
    return c.redirect(viewerUrl, 302);
  }
  if (artifact.visibility === 'private') {
    const raw = getCookie(c, SUB_SESSION_COOKIE);
    const session = raw ? await verifySubSession(raw, resolveJwtSecret()) : null;
    if (!session || session.prefix !== prefix || session.userId !== artifact.user_id) {
      const q = new URLSearchParams({ prefix, path });
      return c.redirect(`${MAIN_ORIGIN}/api/subauth?${q}`, 302);
    }
    return serveShell(c, artifact, {
      cache: 'no-store',
      countView: false,
      shell: { isPrivate: true },
    });
  }
  return serveShell(c, artifact, {
    cache: 'public, max-age=60',
    countView: true,
    // canonical 指向子域权威地址（契约 §3.10）——抓取器与搜索引擎据此归一
    shell: { canonicalUrl: `https://${prefix}.${env.SITES_DOMAIN_SUFFIX}/${path}` },
  });
}

async function handleSubauthLanding(c: ServeContext, prefix: string): Promise<Response> {
  const parsed = await verifySubauthCode(c.req.query('code') ?? '', resolveJwtSecret());
  if (!parsed || parsed.prefix !== prefix) {
    applySubdomainHeaders(c, 'no-store');
    return c.html(
      renderNoticeHtml({
        title: '这个访问凭证已过期',
        reasons: ['私密作品的访问凭证只在短时间内有效', '你可能是从旧的浏览记录进入的'],
        extra: '请回到作品页重新打开一次。',
      }),
      403
    );
  }
  const session = await signSubSession(parsed.userId, prefix, resolveJwtSecret());
  setCookie(c, SUB_SESSION_COOKIE, session, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.isProd,
    path: '/',
    maxAge: SUB_SESSION_TTL_SECONDS,
  });
  const next = c.req.query('next') ?? '/';
  // WHATWG URL 把 `\` 视同 `/`，`/\evil.com` 会被浏览器当协议相对跳转 → 一并拒绝
  const safeNext =
    next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/';
  return c.redirect(safeNext, 302);
}

/**
 * 子域网关：Host 命中 <prefix>.<主域> 时接管请求（仅 GET/HEAD），否则直通。
 * 挂载在 app 最前——子域上不存在任何主站 API 面。
 */
export const subdomainGate: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const prefix = parsePrefix(c.req.header('host'));
  if (!prefix) return next();
  const method = c.req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return subdomainNotFound(c);
  const pathname = new URL(c.req.url).pathname;
  if (pathname === '/__subauth') return handleSubauthLanding(c, prefix);
  return handleServe(c, prefix, pathname);
};

/** 主站换票端点（挂 /api）：校验登录态与所有权后 302 回子域落票 */
export const subauthRouter = new Hono<{ Variables: AuthVariables }>();

// 限流：防 (prefix,path) 枚举探测（默认 10 次/分/IP）
subauthRouter.get('/subauth', rateLimit('subauth'), async (c) => {
  const prefix = c.req.query('prefix') ?? '';
  const path = c.req.query('path') ?? '';
  const user = c.get('user');
  // 未登录 → 302 登录页带 next 回跳（契约 §3.10）。在查库之前判定：
  // 匿名请求一律同响应，不向未登录探测者泄露 (prefix, path) 的存在性与 slug
  if (!user) {
    const next = `/api/subauth?${new URLSearchParams({ prefix, path })}`;
    return c.redirect(`${MAIN_ORIGIN}/login?next=${encodeURIComponent(next)}`, 302);
  }
  const reg = await pool.query<{ kind: string; ref: string }>(
    'select kind, ref from subdomain_registry where name = $1',
    [prefix]
  );
  const ownerId = reg.rows[0]?.kind === 'user' ? reg.rows[0].ref : null;
  // 未命中（prefix 非 user 类 / path 无作品）或非所有者 → 404，
  // 与子域 serve 端点同口径（契约 §3.10：不泄露 slug 与存在性）
  if (!ownerId || user.id !== ownerId) return c.text('页面不存在', 404);
  const artifact = await findByPath(ownerId, path);
  if (!artifact) return c.text('页面不存在', 404);
  const code = await signSubauthCode(user.id, prefix, path, resolveJwtSecret());
  const q = new URLSearchParams({ code, next: `/${path}` });
  return c.redirect(`https://${prefix}.${env.SITES_DOMAIN_SUFFIX}/__subauth?${q}`, 302);
});
