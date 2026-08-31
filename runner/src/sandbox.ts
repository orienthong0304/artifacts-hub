// 内层执行环境（无特权 srcdoc iframe）的文档构建。
// 每次 render 都重建一个全新的内层 iframe，避免状态残留；内层通过 postMessage
// （__artifacts_inner 标记）把 rendered / error / resize 汇报给 runner，由 runner 转发主站。

import { SHADCN_THEME_CSS, TAILWIND_CONFIG_JS } from "./theme";

/** 内层 iframe 的 sandbox 属性（与外层一致，绝不含 allow-same-origin） */
export const INNER_SANDBOX = "allow-scripts allow-forms allow-popups allow-modals";

/**
 * 转义嵌入 <script> 内联内容的代码：防止用户代码里的 "</script>"（几乎只会出现在字符串/正则里，
 * 转义为 "<\\/script" 后语义不变）提前终结脚本标签；"<!--" 同理防止 HTML 注释状态干扰解析。
 */
function escapeInlineScript(code: string): string {
  return code.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
}

/** 最早注入的上报脚本：定义 __artifactsPost，并捕获全局错误 / 资源加载失败 / 未处理的 Promise 异常 */
const REPORTER_JS = `
(function () {
  function post(msg) {
    try { parent.postMessage(Object.assign({ __artifacts_inner: true }, msg), "*"); } catch (e) {}
  }
  window.__artifactsPost = post;
  // 沙箱限制识别：关键词宽匹配，保留原文；匹配不上就归为运行时错误（绝不吞错）
  var SANDBOX_HINTS = [
    "localStorage", "sessionStorage", "cookie", "opaque origin",
    "sandboxed", "cross-origin", "clipboard", "Blocked a frame"
  ];
  function classify(text) {
    var t = String(text || "");
    var sec = t.indexOf("SecurityError") >= 0 || t.indexOf("denied") >= 0 || t.indexOf("Blocked") >= 0;
    if (!sec) return "RUNTIME_ERROR";
    for (var i = 0; i < SANDBOX_HINTS.length; i++) {
      if (t.indexOf(SANDBOX_HINTS[i]) >= 0) return "SANDBOX_UNSUPPORTED";
    }
    return "RUNTIME_ERROR";
  }
  // 资源加载失败：SCRIPT/LINK 之外，IMG/IFRAME/AUDIO/VIDEO/SOURCE 此前会落进「未知错误」
  var RESOURCE_TAGS = { SCRIPT: 1, LINK: 1, IMG: 1, IFRAME: 1, AUDIO: 1, VIDEO: 1, SOURCE: 1, TRACK: 1 };
  window.addEventListener("error", function (e) {
    var target = e && e.target;
    if (target && target !== window && RESOURCE_TAGS[target.tagName]) {
      var url = target.src || target.href || target.currentSrc || "未知资源";
      post({
        type: "error",
        code: "RESOURCE_FAILED",
        message: "依赖资源加载失败：" + url,
        detail: { resource: String(url) }
      });
      return;
    }
    var msg = String((e && e.message) || "未知错误");
    post({ type: "error", code: classify(msg), message: "运行时错误：" + msg, detail: { raw: msg } });
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    var text = r && r.message ? String(r.message) : String(r);
    post({
      type: "error",
      code: classify(text),
      message: "未捕获的 Promise 异常：" + text,
      detail: { raw: text }
    });
  });
})();
`;

/** 内容高度上报（resize 消息，供主站自适应 iframe 高度，可选能力） */
const RESIZE_JS = `
(function () {
  var last = -1;
  function report() {
    var doc = document.documentElement;
    var body = document.body;
    var h = Math.max(
      doc ? doc.scrollHeight : 0,
      body ? body.scrollHeight : 0
    );
    if (h > 0 && h !== last) {
      last = h;
      if (window.__artifactsPost) window.__artifactsPost({ type: "resize", height: h });
      else try { parent.postMessage({ __artifacts_inner: true, type: "resize", height: h }, "*"); } catch (e) {}
    }
  }
  if (typeof ResizeObserver !== "undefined") {
    var ro = new ResizeObserver(report);
    if (document.documentElement) ro.observe(document.documentElement);
    window.addEventListener("load", function () {
      if (document.body) ro.observe(document.body);
      report();
    });
  } else {
    // 无 ResizeObserver 的老浏览器兜底轮询：load 后再跑 10 秒即停。
    // 此前是永久 setInterval——每个内层文档留一个永不回收的定时器。
    window.addEventListener("load", function () {
      report();
      var t = setInterval(report, 1000);
      setTimeout(function () { clearInterval(t); }, 10000);
    });
  }
})();
`;

/** react 挂载引导代码（拼在用户代码之后、同一个 module 内） */
const BOOTSTRAP_JS = `
import __React from "react";
import { createRoot as __createRoot } from "react-dom/client";

class __ArtifactErrorBoundary extends __React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error) {
    window.__artifactsPost({
      type: "error",
      message: "组件运行时错误：" + (error && error.message ? String(error.message) : String(error))
    });
  }
  render() { return this.state.hasError ? null : this.props.children; }
}

const __Component = globalThis.__ARTIFACT_DEFAULT__;
if (__Component === undefined || __Component === null) {
  window.__artifactsPost({
    type: "error",
    message: "渲染失败：未检测到 default export。React 类型的 artifact 必须以 export default 导出根组件。"
  });
} else {
  const __root = __createRoot(document.getElementById("root"));
  __root.render(
    __React.createElement(__ArtifactErrorBoundary, null, __React.createElement(__Component))
  );
  // 用 setTimeout 而非 requestAnimationFrame：后台标签页里 rAF 不触发，会导致 rendered 丢失
  setTimeout(function () {
    window.__artifactsPost({ type: "rendered" });
  }, 0);
}
`;

/**
 * 构建 react 类型的内层 srcdoc：
 * import map（白名单 → 自托管 vendor 绝对 URL）+ Tailwind runtime + shadcn 主题变量
 * + 转译后的用户代码与挂载引导（同一个内联 module）。
 */
export function buildReactSrcdoc(transpiledCode: string, importMap: Record<string, string>, tailwindUrl: string): string {
  const moduleCode = escapeInlineScript(`${transpiledCode}\n${BOOTSTRAP_JS}`);
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<script>${REPORTER_JS}</script>`,
    `<script type="importmap">${JSON.stringify({ imports: importMap })}</script>`,
    `<script src="${tailwindUrl}"></script>`,
    `<script>${escapeInlineScript(TAILWIND_CONFIG_JS)}</script>`,
    `<style>${SHADCN_THEME_CSS}</style>`,
    "</head>",
    "<body>",
    '<div id="root"></div>',
    `<script type="module">${moduleCode}</script>`,
    `<script>${RESIZE_JS}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}

/**
 * 构建 html 类型的内层 srcdoc：完整 HTML 文档原样渲染，仅在文档头部注入
 * 自托管 Tailwind runtime（用户文档自带的 CDN 引用失败也不受影响）与 resize 上报脚本。
 */
export function buildHtmlSrcdoc(userHtml: string, tailwindUrl: string): string {
  // REPORTER 必须最先注入（早于用户文档任何脚本），否则捕不到早期错误。
  // 此前 html 类型完全没有 REPORTER —— 出问题即白屏无提示（契约 §4.1）。
  // 注意：html 的 error 一律 non-fatal（判据见 main.ts reportError），因为 html 的
  // rendered 依赖 load 事件，load 前的脚本错误不代表作品渲染失败。
  const headSnippet =
    `<script>${REPORTER_JS}</script>` +
    `<script src="${tailwindUrl}"></script><script>${RESIZE_JS}</script>`;
  if (/<head[^>]*>/i.test(userHtml)) {
    return userHtml.replace(/<head[^>]*>/i, (m) => m + headSnippet);
  }
  if (/<html[^>]*>/i.test(userHtml)) {
    return userHtml.replace(/<html[^>]*>/i, (m) => `${m}<head>${headSnippet}</head>`);
  }
  return headSnippet + userHtml;
}
