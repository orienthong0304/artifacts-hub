// runner 主逻辑：监听主站 postMessage（校验 __artifacts 标记），
// 实现 ready / render / rendered / error / resize 协议（契约文档 §4）。

import {
  isRenderMessage,
  isInnerMessage,
  type RunnerMessageBody,
  type RenderMessage,
  type ErrorCode,
  type ErrorDetail,
} from "./protocol";
import { transpileReact, TranspileError } from "./transpile";
import { buildImportMap, checkImports, vendorBase } from "./import-map";
import { buildReactSrcdoc, buildHtmlSrcdoc, INNER_SANDBOX } from "./sandbox";
import { badgeText } from "./badge";
import { isAllowedHost } from "./host-allow";

/** 单次渲染超时（vendor 拉取 + 转译执行），超时报 error */
const RENDER_TIMEOUT_MS = 20_000;
/** 代码体积上限，与后端契约一致（500KB） */
const MAX_CODE_BYTES = 500 * 1024;

const stage = document.getElementById("stage")!;
const placeholder = document.getElementById("placeholder")!;

/** 主站 origin：从首个合法 render 消息记录，作为回发 targetOrigin（拿不到时退回 '*'）。
 *  ready 在收到任何消息之前发出，只能用 '*'（消息不含敏感数据）。 */
let hostOrigin: string | null = null;

let inner: HTMLIFrameElement | null = null;
let renderTimer: number | undefined;
let renderedSent = false;
let failed = false;

function postToHost(msg: RunnerMessageBody): void {
  const target = hostOrigin && hostOrigin !== "null" ? hostOrigin : "*";
  window.parent.postMessage({ __artifacts: true, ...msg }, target);
}

/** 当前渲染的类型：html 的 fatal 判据与 react 不同（见 reportError） */
let currentKind: "react" | "html" | null = null;

/**
 * 上报错误（契约 §4.1）。
 *
 * fatal 判据是 renderedSent —— 发出 rendered 之前的错误是「首屏就失败」，必须刚性可见；
 * 之后的是「作品已经在跑」，一张图片 404 不该把整页盖成错误卡。
 *
 * **kind='html' 一律 non-fatal**：html 的 rendered 依赖内层 iframe 的 load 事件，
 * 而 load 之前发生的脚本错误若套用 renderedSent 判据会被判成 fatal——那会让存量
 * 能正常显示的 html 作品新增全屏遮罩。html 只有一种 fatal：load 始终不来（走 TIMEOUT）。
 */
function reportError(
  message: string,
  opts: { code?: ErrorCode; detail?: ErrorDetail; forceFatal?: boolean } = {}
): void {
  const fatal = opts.forceFatal ?? (currentKind === "html" ? false : !renderedSent);
  if (fatal) {
    failed = true;
    clearTimer();
  }
  postToHost({ type: "error", message, code: opts.code, detail: opts.detail, fatal });
}

function clearTimer(): void {
  if (renderTimer !== undefined) {
    window.clearTimeout(renderTimer);
    renderTimer = undefined;
  }
}

function destroyInner(): void {
  clearTimer();
  if (inner) {
    inner.remove();
    inner = null;
  }
}

/** 挂载新的内层执行 iframe（每次 render 全量重建，杜绝状态残留） */
function mountInner(srcdoc: string, onLoad?: () => void): void {
  const el = document.createElement("iframe");
  el.className = "artifact-frame";
  el.setAttribute("sandbox", INNER_SANDBOX);
  el.setAttribute("title", "artifact 渲染沙箱");
  if (onLoad) el.addEventListener("load", onLoad);
  el.srcdoc = srcdoc;
  inner = el;
  stage.appendChild(el);
  placeholder.style.display = "none";
}

function render(payload: RenderMessage["payload"]): void {
  destroyInner();
  renderedSent = false;
  failed = false;

  // 角标（契约 §4）：外层文档渲染，用户代码（内层 iframe）无法移除。
  // 同时承载生成合成内容的显著提示标识（契约 §3.11）——用 textContent 赋值，不拼 HTML。
  // 空值保护：旧缓存的 index.html 可能没有 #badge，避免 TypeError 白屏
  const badgeEl = document.getElementById("badge");
  if (badgeEl) {
    badgeEl.hidden = payload?.badge !== true;
    badgeEl.textContent = badgeText(payload?.aiLabel);
  }

  if (!payload || typeof payload.code !== "string" || payload.code.trim() === "") {
    reportError("渲染失败：code 为空，请提供 React 组件代码或完整 HTML 文档。");
    return;
  }
  if (new Blob([payload.code]).size > MAX_CODE_BYTES) {
    reportError("渲染失败：代码超过 500KB 上限。", { code: "RUNTIME_ERROR", forceFatal: true });
    return;
  }

  currentKind = payload.kind === "html" ? "html" : "react";
  const tailwindUrl = vendorBase() + "tailwind.js";

  if (payload.kind === "react") {
    let transpiled;
    try {
      transpiled = transpileReact(payload.code);
    } catch (err) {
      if (err instanceof TranspileError) {
        reportError(err.message, {
          code: "TRANSPILE_ERROR",
          detail: { line: err.line, column: err.column, frame: err.frame, raw: err.raw },
        });
      } else {
        reportError(`代码转译失败：${String(err)}`, {
          code: "TRANSPILE_ERROR",
          detail: { raw: String(err) },
        });
      }
      return;
    }
    if (!transpiled.hasDefaultExport) {
      reportError(
        "渲染失败：未检测到 default export。React 类型的 artifact 必须是单文件组件，并以 export default 导出根组件。",
        { code: "NO_DEFAULT_EXPORT" }
      );
      return;
    }
    const importMap = buildImportMap();
    const importError = checkImports(transpiled.imports, importMap);
    if (importError) {
      reportError(importError.message, {
        code: importError.code,
        detail: { imports: importError.offenders },
      });
      return;
    }
    mountInner(buildReactSrcdoc(transpiled.code, importMap, tailwindUrl));
    // rendered / error 由内层模块汇报；这里只兜底超时
    renderTimer = window.setTimeout(() => {
      if (!renderedSent && !failed) {
        reportError("渲染超时：依赖加载或组件执行超过 20 秒，请检查代码是否存在死循环或网络问题。", { code: "TIMEOUT", forceFatal: true });
      }
    }, RENDER_TIMEOUT_MS);
    return;
  }

  if (payload.kind === "html") {
    mountInner(buildHtmlSrcdoc(payload.code, tailwindUrl), () => {
      // html 文档以 load 事件视为渲染完成
      if (!renderedSent) {
        renderedSent = true;
        clearTimer();
        postToHost({ type: "rendered" });
      }
    });
    renderTimer = window.setTimeout(() => {
      if (!renderedSent) reportError("渲染超时：HTML 文档加载超过 20 秒。", { code: "TIMEOUT", forceFatal: true });
    }, RENDER_TIMEOUT_MS);
    return;
  }

  reportError(`渲染失败：未知的渲染类型「${String((payload as { kind?: unknown }).kind)}」，仅支持 react / html。`, { code: "RUNTIME_ERROR", forceFatal: true });
}

/** 内层 iframe 消息 → 转发主站 */
function handleInnerMessage(data: unknown): void {
  if (!isInnerMessage(data)) return;
  switch (data.type) {
    case "rendered":
      if (!renderedSent && !failed) {
        renderedSent = true;
        clearTimer();
        postToHost({ type: "rendered" });
      }
      break;
    case "error":
      // 内层已能自行归类的（资源失败 / 沙箱限制）直接沿用；否则归为运行时错误。
      // fatal 由 reportError 按 renderedSent 与 kind 判定——渲染成功后的问题不再遮挡作品。
      reportError(typeof data.message === "string" ? data.message : "未知渲染错误", {
        code: data.code ?? "RUNTIME_ERROR",
        detail: data.detail,
      });
      break;
    case "resize":
      if (typeof data.height === "number" && isFinite(data.height) && data.height > 0) {
        postToHost({ type: "resize", height: Math.ceil(data.height) });
      }
      break;
  }
}

window.addEventListener("message", (event: MessageEvent) => {
  // 内层沙箱消息（来源必须是当前内层 iframe）
  if (inner && event.source === inner.contentWindow) {
    handleInnerMessage(event.data);
    return;
  }
  // 主站消息：校验 __artifacts 标记、必须来自父窗口，且父窗口 origin 在白名单内
  if (event.source !== window.parent) return;
  if (!isRenderMessage(event.data)) return;
  if (!isAllowedHost(event.origin)) {
    // 不回错误、不回任何内容：对未授权嵌入者保持静默，避免把 runner 变成可探测的服务
    return;
  }
  if (event.origin && event.origin !== "null") hostOrigin = event.origin;
  render(event.data.payload);
});

// runner 加载完成，通知主站可以发 render
// 构建标识写进页面 meta（供 /selfcheck 与人工排障直接看见）并随 ready 上报（W1-1）
(function stampBuild() {
  try {
    const meta = document.createElement("meta");
    meta.name = "x-runner-build";
    meta.content = __RUNNER_BUILD__;
    document.head.appendChild(meta);
  } catch {
    // 极端情况下 head 不可用时不影响渲染主路径
  }
})();
postToHost({ type: "ready", runner: __RUNNER_BUILD__ });
