import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 构建标识（能力波次 1 · W1-1）。
 *
 * 为什么需要：runner 是全站唯一「回归 = 所有作品同时不渲染」的组件，而部署是
 * `rsync --delete`（deploy.sh），服务器不留历史产物。出问题时的第一个问题永远是
 * 「线上现在跑的是哪一版」——没有标识就只能靠本地能否重现构建来猜。
 *
 * git sha 定位代码版本；vendor manifest 哈希定位白名单产物版本（两者可以独立变化：
 * 改 vendor.config.mjs 不改 src 时 sha 变了但产物差异全在 vendor 里，反之亦然）。
 */
function resolveBuildStamp(): { sha: string; vendor: string } {
  let sha = "unknown";
  try {
    sha = execSync("git rev-parse --short HEAD", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    // 非 git 环境（如从 tarball 构建）：保持 unknown，不让构建失败
  }
  let vendor = "none";
  const manifestPath = path.resolve(__dirname, "public/vendor/manifest.json");
  if (existsSync(manifestPath)) {
    vendor = createHash("sha256")
      .update(readFileSync(manifestPath))
      .digest("hex")
      .slice(0, 8);
  }
  return { sha, vendor };
}

const BUILD_STAMP = resolveBuildStamp();

// runner 页面运行在主站的沙箱 iframe 中（sandbox 无 allow-same-origin，origin 为 opaque），
// 所有 module script / fetch 均以 Origin: null 发起 CORS 请求，
// 因此 dev / preview 必须放开 CORS；生产由静态站响应 Access-Control-Allow-Origin: *（见 README 部署一节）。
export default defineConfig({
  // 阻止向上查找主仓库的 postcss/tailwind 配置（runner 自身不使用 postcss）
  css: { postcss: {} },
  define: {
    __RUNNER_BUILD__: JSON.stringify(`${BUILD_STAMP.sha}+v${BUILD_STAMP.vendor}`),
  },
  server: {
    port: 5174,
    strictPort: true,
    cors: true,
  },
  preview: {
    port: 5174,
    strictPort: true,
    cors: true,
  },
  build: {
    target: "es2020",
    // @babel/standalone 单文件约 3MB，属预期体积，调高告警阈值保持输出干净
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, "index.html"),
        "test-host": path.resolve(__dirname, "test-host.html"),
      },
    },
  },
});
