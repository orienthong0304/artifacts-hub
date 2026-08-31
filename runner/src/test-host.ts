// 宿主测试页脚本：模拟主站与 runner 的 postMessage 交互（本地验证用，不参与生产逻辑）

import dashboardCode from "../examples/dashboard.tsx?raw";
import motionCode from "../examples/motion.tsx?raw";
import pageHtml from "../examples/page.html?raw";

const iframe = document.getElementById("runner") as HTMLIFrameElement;
const codeEl = document.getElementById("code") as HTMLTextAreaElement;
const kindEl = document.getElementById("kind") as HTMLSelectElement;
const renderBtn = document.getElementById("render") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;
const logEl = document.getElementById("log")!;

const EXAMPLES: Record<string, { kind: "react" | "html"; code: string }> = {
  dashboard: { kind: "react", code: dashboardCode },
  motion: { kind: "react", code: motionCode },
  html: { kind: "html", code: pageHtml },
};

let ready = false;

function log(text: string, cls = ""): void {
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = `[${new Date().toLocaleTimeString("zh-CN")}] ${text}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function sendRender(): void {
  if (!iframe.contentWindow) return;
  const payload = { kind: kindEl.value as "react" | "html", code: codeEl.value };
  // 注意：runner iframe 的 sandbox 不含 allow-same-origin，其 origin 为 opaque，
  // postMessage 指定具体 targetOrigin 永远无法匹配，这里只能用 '*'（消息不含敏感数据）。
  iframe.contentWindow.postMessage({ __artifacts: true, type: "render", payload }, "*");
  log(`→ render (kind=${payload.kind}, ${payload.code.length} 字符)`);
  statusEl.textContent = "渲染中…";
}

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== iframe.contentWindow) return;
  const data = event.data;
  if (!data || data.__artifacts !== true) return;
  switch (data.type) {
    case "ready":
      ready = true;
      renderBtn.disabled = false;
      statusEl.textContent = "runner 就绪";
      log("← ready", "ok");
      break;
    case "rendered":
      statusEl.textContent = "渲染完成";
      log("← rendered", "ok");
      break;
    case "error":
      statusEl.textContent = "渲染出错";
      log(`← error: ${data.message}`, "err");
      break;
    case "resize":
      log(`← resize: height=${data.height}`);
      break;
  }
});

renderBtn.addEventListener("click", sendRender);

document.querySelectorAll<HTMLButtonElement>("button[data-example]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const example = EXAMPLES[btn.dataset.example!];
    codeEl.value = example.code;
    kindEl.value = example.kind;
    if (ready) sendRender();
  });
});

// 默认预填仪表盘样例
codeEl.value = dashboardCode;
