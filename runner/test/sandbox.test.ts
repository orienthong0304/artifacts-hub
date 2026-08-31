// 内层 srcdoc 构建与内联脚本转义（契约 §4）
//
// 两条最高危的性质在这里锁住：
//   ① escapeInlineScript 必须转义 "</script>"，否则用户代码里的该串会提前闭合内联模块脚本，
//      后续引导代码变成页面文本 → 作品白屏。这是注入面也是可用性面。
//   ② buildHtmlSrcdoc 此前**不注入 REPORTER_JS** → html 类型作品零错误上报（出问题即白屏无提示）。
//      W1-2 已补注入。配套的硬约束写在 main.ts reportError：「kind=html 的 error 一律 non-fatal」
//      ——html 的 rendered 依赖 iframe load 事件，load 之前的脚本错误若按 renderedSent 判据
//      会被误判 fatal，那会让存量能正常显示的 html 作品新增全屏遮罩。
import { describe, it, expect } from 'vitest';
import { buildReactSrcdoc, buildHtmlSrcdoc } from '../src/sandbox';

const TAILWIND = 'https://run.example/vendor/tailwind.js';
const IMPORT_MAP = { react: 'https://run.example/vendor/react.js' };

describe('buildReactSrcdoc', () => {
  it('注入顺序：REPORTER 必须在 importmap 与用户模块之前（否则早期错误捕不到）', () => {
    const html = buildReactSrcdoc('const a = 1;', IMPORT_MAP, TAILWIND);
    const reporterAt = html.indexOf('__artifactsPost');
    const importMapAt = html.indexOf('type="importmap"');
    const moduleAt = html.indexOf('type="module"');
    expect(reporterAt).toBeGreaterThan(-1);
    expect(reporterAt).toBeLessThan(importMapAt);
    expect(importMapAt).toBeLessThan(moduleAt);
  });

  it('importmap 内容为传入的映射', () => {
    const html = buildReactSrcdoc('const a = 1;', IMPORT_MAP, TAILWIND);
    expect(html).toContain(JSON.stringify({ imports: IMPORT_MAP }));
  });

  it('含 root 挂载点与 tailwind runtime', () => {
    const html = buildReactSrcdoc('const a = 1;', IMPORT_MAP, TAILWIND);
    expect(html).toContain('id="root"');
    expect(html).toContain(TAILWIND);
  });

  it('用户代码里的 </script> 被转义，绝不提前闭合内联模块', () => {
    const evil = `const s = "</script><script>window.__pwned = 1;</script>";`;
    const html = buildReactSrcdoc(evil, IMPORT_MAP, TAILWIND);
    expect(html).not.toContain('</script><script>window.__pwned');
    expect(html).toContain('<\\/script');
  });

  it('用户代码里的 <!-- 被转义（防 HTML 注释状态干扰解析）', () => {
    const html = buildReactSrcdoc(`const s = "<!-- x";`, IMPORT_MAP, TAILWIND);
    expect(html).toContain('<\\!--');
  });
});

describe('buildHtmlSrcdoc · 三种文档形态的注入位置', () => {
  it('有 <head> 时注入到 head 开标签之后', () => {
    const out = buildHtmlSrcdoc('<!doctype html><html><head><title>t</title></head><body>b</body></html>', TAILWIND);
    const headAt = out.indexOf('<head>');
    const twAt = out.indexOf(TAILWIND);
    const titleAt = out.indexOf('<title>');
    expect(twAt).toBeGreaterThan(headAt);
    expect(twAt).toBeLessThan(titleAt);
  });

  it('无 head 有 <html> 时补一个 head', () => {
    const out = buildHtmlSrcdoc('<html><body>b</body></html>', TAILWIND);
    expect(out).toContain('<head>');
    expect(out.indexOf(TAILWIND)).toBeGreaterThan(-1);
  });

  it('片段（无 html 无 head）时前置注入', () => {
    const out = buildHtmlSrcdoc('<div>fragment</div>', TAILWIND);
    expect(out.indexOf(TAILWIND)).toBeLessThan(out.indexOf('<div>fragment</div>'));
  });

  it('用户文档内容原样保留（html 类型是原样渲染，不做改写）', () => {
    const src = '<!doctype html><html><head></head><body><h1>标题</h1><script>console.log(1)</script></body></html>';
    const out = buildHtmlSrcdoc(src, TAILWIND);
    expect(out).toContain('<h1>标题</h1>');
    expect(out).toContain('console.log(1)');
  });
});

describe('buildHtmlSrcdoc · 错误上报（W1-2）', () => {
  it('html 现在也注入 REPORTER_JS —— 此前 html 类型作品零错误上报，出问题即白屏无提示', () => {
    const out = buildHtmlSrcdoc('<div>x</div>', TAILWIND);
    expect(out).toContain('unhandledrejection');
    expect(out).toContain('window.__artifactsPost = post');
    expect(out).toMatch(/addEventListener\(\s*["']error["']/);
  });

  it('REPORTER 必须在 tailwind 与用户内容之前（早期错误才捕得到）', () => {
    const out = buildHtmlSrcdoc('<div>marker</div>', TAILWIND);
    const reporterAt = out.indexOf('window.__artifactsPost = post');
    expect(reporterAt).toBeGreaterThan(-1);
    expect(reporterAt).toBeLessThan(out.indexOf(TAILWIND));
    expect(reporterAt).toBeLessThan(out.indexOf('<div>marker</div>'));
  });

  it('资源失败归类覆盖 IMG/IFRAME/AUDIO/VIDEO（此前只特判 SCRIPT/LINK）', () => {
    const out = buildHtmlSrcdoc('<div>x</div>', TAILWIND);
    expect(out).toContain('RESOURCE_FAILED');
    expect(out).toContain('IMG');
    expect(out).toContain('VIDEO');
  });

  it('沙箱限制识别存在且不吞错（匹配不上归 RUNTIME_ERROR）', () => {
    const out = buildHtmlSrcdoc('<div>x</div>', TAILWIND);
    expect(out).toContain('SANDBOX_UNSUPPORTED');
    expect(out).toContain('RUNTIME_ERROR');
    expect(out).toContain('localStorage');
  });

  it('无 ResizeObserver 分支的轮询有上限，不再是永久 setInterval', () => {
    const out = buildHtmlSrcdoc('<div>x</div>', TAILWIND);
    expect(out).toContain('clearInterval');
  });

  it('对照：react 路径同样装了错误监听器', () => {
    const react = buildReactSrcdoc('const a = 1;', IMPORT_MAP, TAILWIND);
    expect(react).toContain('unhandledrejection');
    expect(react).toContain('window.__artifactsPost = post');
    expect(react).toMatch(/addEventListener\(\s*["']error["']/);
  });

  it('注入 RESIZE 上报（高度自适应已有）', () => {
    const out = buildHtmlSrcdoc('<div>x</div>', TAILWIND);
    expect(out).toContain('resize');
  });
});
