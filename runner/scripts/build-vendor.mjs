// 构建 vendor 白名单包：把每个白名单库打成单文件 ESM 到 public/vendor/，
// 并把 shadcn/ui 组件源码（vendor-src/ui/）逐个打包为 `@/components/ui/*` 模块。
// react 全家桶全局单例：依赖 react 的包全部把 react 留作 external，运行时由 import map 指向同一份 react.js。
//
// 用法：node scripts/build-vendor.mjs  （npm run build:vendor）

import { build } from "esbuild";
import { mkdir, copyFile, writeFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VENDOR_PACKAGES, UI_COMPONENTS } from "../vendor.config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "public", "vendor");

/** JS 保留字：不能作为具名导出的标识符 */
const RESERVED = new Set(
  (
    "break case catch class const continue debugger default delete do else enum export extends false finally " +
    "for function if import in instanceof new null return super switch this throw true try typeof var void while " +
    "with yield let static await implements interface package private protected public"
  ).split(" ")
);
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * 枚举一个包的具名导出：
 * - node ESM 命名空间的 keys（对 CJS 包走 cjs-module-lexer 推断）
 * - default 导出对象自身的 keys（补齐 lexer 推断不到的，如 papaparse）
 * 打成 ESM 时逐个显式导出，保证 `import { useState } from 'react'` 这类具名导入可用。
 */
async function collectExportNames(spec) {
  const names = new Set();
  try {
    const ns = await import(spec);
    for (const k of Object.keys(ns)) names.add(k);
    const d = ns.default;
    if (d && (typeof d === "object" || typeof d === "function")) {
      for (const k of Object.keys(d)) names.add(k);
    }
  } catch (err) {
    console.warn(`[vendor] 警告：无法在 node 中枚举 ${spec} 的导出（${err.message}），仅保留 default 导出`);
  }
  names.delete("default");
  names.delete("__esModule");
  return [...names].filter((n) => IDENT_RE.test(n) && !RESERVED.has(n)).sort();
}

/** 生成包装入口源码：default + 全部具名导出 */
function makeEntry(spec, names) {
  const q = JSON.stringify;
  const lines = [
    `import * as __ns from ${q(spec)};`,
    // CJS 包经 esbuild interop 后 default 即 module.exports；纯 ESM 无 default 时退回命名空间
    `const __d = __ns.default === undefined ? __ns : __ns.default;`,
    `export default __d;`,
  ];
  for (const n of names) {
    lines.push(
      `export const ${n} = __ns[${q(n)}] !== undefined ? __ns[${q(n)}] : (__d == null ? undefined : __d[${q(n)}]);`
    );
  }
  return lines.join("\n");
}

/**
 * CJS 包（react-dom、react/jsx-runtime 等）在 ESM 产物里对 external 依赖的 require() 会落到
 * esbuild 的 __require 兜底并抛 "Dynamic require of ... is not supported"。
 * 这里生成 banner：静态 import 全部 external，并定义模块级 require 从中取值
 * （CJS 语义下 require 应返回 module.exports，即 interop 后的 default）。
 */
function makeRequireShim(externals) {
  const names = externals.filter((n) => !n.includes("*"));
  if (names.length === 0) return "";
  const lines = [];
  const entries = [];
  names.forEach((name, i) => {
    lines.push(`import * as __ext_${i} from ${JSON.stringify(name)};`);
    entries.push(`${JSON.stringify(name)}: __ext_${i}`);
  });
  lines.push(`var __externals__ = { ${entries.join(", ")} };`);
  lines.push(
    `var require = function (name) { var m = __externals__[name]; if (m === undefined) throw new Error('Cannot require "' + name + '"'); return m && m.default !== undefined ? m.default : m; };`
  );
  return lines.join("\n");
}

const COMMON = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  logLevel: "warning",
  define: {
    "process.env.NODE_ENV": '"production"',
    global: "globalThis",
  },
};

const requireFromHere = createRequire(import.meta.url);

/**
 * esbuild 的 external 会连带匹配包的子路径：如果入口自身（如 react-dom/client）被自己的
 * external（react-dom）覆盖，包装入口里的 import 会被原样保留 → 运行时经 import map 指回自己，
 * 形成循环自引用。此时把入口解析成 node_modules 里的绝对文件路径再交给 esbuild 打包。
 */
function entryImportSpec(pkg) {
  const rootName = pkg.name.startsWith("@")
    ? pkg.name.split("/").slice(0, 2).join("/")
    : pkg.name.split("/")[0];
  const coveredBySelfExternal = pkg.external.includes(pkg.name) || pkg.external.includes(rootName);
  return coveredBySelfExternal ? requireFromHere.resolve(pkg.name) : pkg.name;
}

async function buildPackage(pkg) {
  const names = await collectExportNames(pkg.name);
  await build({
    ...COMMON,
    stdin: {
      contents: makeEntry(entryImportSpec(pkg), names),
      resolveDir: root,
      sourcefile: `vendor-entry:${pkg.name}`,
      loader: "js",
    },
    external: pkg.external,
    banner: { js: makeRequireShim(pkg.external) },
    outfile: path.join(outDir, pkg.file),
  });
  return { module: pkg.name, file: pkg.file };
}

async function buildUiComponent(name) {
  const externals = [
    ...VENDOR_PACKAGES.map((p) => p.name),
    "@/*", // @/lib/utils 与 @/components/ui/* 之间的互相引用走 import map
  ];
  await build({
    ...COMMON,
    entryPoints: [path.join(root, "vendor-src", "ui", `${name}.tsx`)],
    jsx: "automatic",
    external: externals,
    outfile: path.join(outDir, "ui", `${name}.js`),
  });
  return { module: `@/components/ui/${name}`, file: `ui/${name}.js` };
}

async function buildUtils() {
  await build({
    ...COMMON,
    entryPoints: [path.join(root, "vendor-src", "lib", "utils.ts")],
    external: ["clsx", "tailwind-merge"],
    outfile: path.join(outDir, "lib", "utils.js"),
  });
  return { module: "@/lib/utils", file: "lib/utils.js" };
}

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

async function main() {
  const start = Date.now();
  await mkdir(outDir, { recursive: true });
  await mkdir(path.join(outDir, "ui"), { recursive: true });
  await mkdir(path.join(outDir, "lib"), { recursive: true });

  // 自托管 Tailwind Play CDN runtime（checked-in 静态资产，构建时拷贝，离线可用）
  await copyFile(path.join(root, "assets", "tailwind-3.4.16.js"), path.join(outDir, "tailwind.js"));

  const results = [];
  // npm 包逐个构建（collectExportNames 需要顺序 import，esbuild 本身很快）
  for (const pkg of VENDOR_PACKAGES) {
    results.push(await buildPackage(pkg));
  }
  results.push(await buildUtils());
  results.push(...(await Promise.all(UI_COMPONENTS.map((n) => buildUiComponent(n)))));
  results.push({ module: "(tailwind runtime)", file: "tailwind.js" });

  // 记录体积清单
  let total = 0;
  const manifest = [];
  for (const r of results) {
    const s = await stat(path.join(outDir, r.file));
    total += s.size;
    manifest.push({ ...r, bytes: s.size });
  }
  manifest.sort((a, b) => b.bytes - a.bytes);
  await writeFile(
    path.join(outDir, "manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), totalBytes: total, files: manifest }, null, 2)
  );

  console.log("\nvendor 产物体积（minified，未 gzip）：");
  for (const m of manifest) {
    console.log(`  ${m.module.padEnd(28)} ${m.file.padEnd(30)} ${formatSize(m.bytes)}`);
  }
  console.log(`  合计 ${formatSize(total)}，耗时 ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error("[vendor] 构建失败：", err);
  process.exit(1);
});
