#!/usr/bin/env node
/**
 * 构建期预渲染 /guides 与 /guides/:slug 为静态 HTML（react-snap 思路，零新依赖）。
 *
 * 目的：让无 JS 的爬虫也能读到指南全文（SEO）。生产 OpenResty 的
 *   try_files $uri $uri/ /index.html
 * 会在 dist/guides/<slug>/index.html 存在时优先命中它，而不是走 SPA fallback。
 *
 * 做法：以 dist/index.html（vite 产物）为模板，逐页改写
 *   <title> / <meta description> / <link canonical>，并把静态正文 markup
 *   注入空的 <div id="root"> —— SPA JS 加载后 React mount 会整段替换它，
 *   因此对真实用户零副作用，对爬虫则是完整可读的正文。
 *
 * 内容源与运行时同一份：src/app/lib/guides-data.json（避免双写漂移）。
 * 用法：node scripts/prerender-guides.mjs   （由根 package.json 的 build 末尾调用）
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const TEMPLATE_PATH = resolve(DIST, 'index.html');
const DATA_PATH = resolve(ROOT, 'src/app/lib/guides-data.json');

const SITE = process.env.SITE_ORIGIN || 'https://artifacts.orienthong.cn';
const PRODUCT = 'Artifacts';
// 与 src/app/pages/guides.tsx 索引页副标语保持一致
const GUIDES_INTRO =
  '保姆级教程：把 Claude / DeepSeek / 豆包 / ChatGPT 生成的网页代码，变成国内直连、微信可打开的在线链接。零部署经验也能照着做。';

/** HTML 转义（文本与属性双上下文均安全） */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 替换或注入一个 <meta property="og:*"> 标签。
 * 模板本就带该 og 标签 → 原地改写（避免分享预览沿用首页值）；
 * 模板没有 → 注入到 </head> 前。两种情况都覆盖。
 */
function upsertOg(html, property, content) {
  const tag = `<meta property="${property}" content="${esc(content)}" />`;
  const re = new RegExp(`<meta\\s+property="${property}"[^>]*>`, 'i');
  if (re.test(html)) return html.replace(re, () => tag);
  return html.replace(/<\/head>/i, () => `  ${tag}\n  </head>`);
}

/** 截断为 meta description（约 150 字，超出补省略号） */
function clip(s, n = 150) {
  const t = String(s);
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/** 指南详情页正文：返回链接 + h1 + intro + 步骤(h2+p) + FAQ(h3+p) */
function guideBody(g) {
  const steps = g.steps
    .map((s) => `<h2>${esc(s.title)}</h2><p>${esc(s.body)}</p>`)
    .join('');
  const faq = g.faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('');
  return (
    '<main>' +
    '<a href="/guides">全部指南</a>' +
    `<h1>${esc(g.title)}</h1>` +
    `<p>${esc(g.intro)}</p>` +
    steps +
    '<h2>常见问题</h2>' +
    faq +
    '</main>'
  );
}

/** 索引页正文：h1 + 副标语 + 各指南卡片链接（title + intro） */
function indexBody(guides) {
  const cards = guides
    .map(
      (g) =>
        `<a href="/guides/${esc(g.slug)}"><h2>${esc(g.title)}</h2><p>${esc(g.intro)}</p></a>`,
    )
    .join('');
  return `<main><h1>使用指南</h1><p>${esc(GUIDES_INTRO)}</p>${cards}</main>`;
}

/**
 * 用页面数据改写模板：<title> / description+canonical / #root 注入。
 * 三处均用替换函数（避免 $ 在替换串里被特殊解释）。
 */
function renderPage(template, { title, description, canonicalPath, bodyHtml }) {
  const canonicalUrl = `${SITE}${canonicalPath}`;
  let html = template;
  html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(title)}</title>`);
  // 替换模板里已有的 description meta，并顺带插入 canonical
  html = html.replace(
    /<meta\s+name="description"[^>]*>/i,
    () =>
      `<meta name="description" content="${esc(description)}" />\n    ` +
      `<link rel="canonical" href="${esc(canonicalUrl)}" />`,
  );
  // Open Graph：让指南链接分享到微信/社交平台显示本页而非首页预览
  html = upsertOg(html, 'og:title', title);
  html = upsertOg(html, 'og:description', description);
  html = upsertOg(html, 'og:url', canonicalUrl);
  html = html.replace(/<div id="root">\s*<\/div>/, () => `<div id="root">${bodyHtml}</div>`);
  return html;
}

// ── 主流程 ──────────────────────────────────────────────
const template = readFileSync(TEMPLATE_PATH, 'utf8');

// 模板结构自检：vite 产物若变了结构，早失败早报警
const checks = [
  [/<div id="root">\s*<\/div>/, '空的 #root 挂载点'],
  [/<title>[\s\S]*?<\/title>/, '<title> 标签'],
  [/<meta\s+name="description"[^>]*>/i, 'description meta'],
];
for (const [re, label] of checks) {
  if (!re.test(template)) {
    console.error(`[prerender] 模板 dist/index.html 缺少 ${label}——vite 产物结构可能已变，中止。`);
    process.exit(1);
  }
}

const guides = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
const outputs = [];

// 索引页 → dist/guides/index.html
{
  const html = renderPage(template, {
    title: `使用指南 · ${PRODUCT}`,
    description: clip(GUIDES_INTRO),
    canonicalPath: '/guides',
    bodyHtml: indexBody(guides),
  });
  const dir = resolve(DIST, 'guides');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, 'index.html');
  writeFileSync(file, html);
  outputs.push({ file, h1: '使用指南' });
}

// 每篇指南 → dist/guides/<slug>/index.html
for (const g of guides) {
  const html = renderPage(template, {
    title: `${g.title} · ${PRODUCT}`,
    description: clip(g.intro),
    canonicalPath: `/guides/${g.slug}`,
    bodyHtml: guideBody(g),
  });
  const dir = resolve(DIST, 'guides', g.slug);
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, 'index.html');
  writeFileSync(file, html);
  outputs.push({ file, h1: g.title });
}

// 清单 + 断言（非空 且 含对应 h1 文本；任一失败 exit 1）
let failed = 0;
console.log('[prerender] 生成清单：');
for (const { file, h1 } of outputs) {
  const content = readFileSync(file, 'utf8');
  const rel = file.replace(`${ROOT}/`, '');
  const ok = content.length > 0 && content.includes(`<h1>${esc(h1)}</h1>`);
  console.log(`  ${ok ? '✓' : '✗'} ${rel}  (${content.length} bytes)`);
  if (!ok) failed++;
}
if (failed > 0) {
  console.error(`[prerender] 断言失败：${failed} 个文件为空或缺少 h1。`);
  process.exit(1);
}
console.log(`[prerender] 完成：${outputs.length} 个静态页（1 索引 + ${guides.length} 指南）。`);
