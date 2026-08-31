// 运行时 import map 与白名单校验，清单来源于 vendor.config.mjs（与 vendor 构建脚本共用）

import { VENDOR_PACKAGES, UI_COMPONENTS } from "../vendor.config.mjs";
import { suggestFor } from "./suggestions";
import type { OffendingImport } from "./protocol";

/** vendor 目录的绝对基址（跟随 runner 部署路径，支持子域根路径或 /runner/ 子路径） */
export function vendorBase(): string {
  return new URL("vendor/", document.baseURI).href;
}

/** 构建注入内层文档的 import map：模块名 → vendor 产物绝对 URL */
export function buildImportMap(): Record<string, string> {
  const base = vendorBase();
  const map: Record<string, string> = {};
  for (const pkg of VENDOR_PACKAGES) {
    map[pkg.name] = base + pkg.file;
  }
  map["@/lib/utils"] = base + "lib/utils.js";
  for (const name of UI_COMPONENTS) {
    map[`@/components/ui/${name}`] = base + `ui/${name}.js`;
  }
  return map;
}

/** 面向用户的支持清单文案（报错时列出） */
export function supportedListText(): string {
  const pkgs = VENDOR_PACKAGES
    .map((p) => p.name)
    .filter((n) => !n.includes("/")) // 子路径（react/jsx-runtime 等）不单独罗列
    .join("、");
  return `${pkgs}（含 react-dom/client、react/jsx-runtime 等子路径），以及 shadcn/ui 组件 @/components/ui/{${UI_COMPONENTS.join(
    ","
  )}} 与 @/lib/utils`;
}

/**
 * 校验 import 来源。全部合法返回 null。
 *
 * **收集全部越界项**（2026-07-26 修订，此前是命中首个即 return）：用户拿着 AI 生成的代码来，
 * 一次只告诉他一个问题意味着「改一个 → 再撞下一个」的往返；一次报全，人类和 Agent 都能一轮改完。
 *
 * 相对路径与白名单外分开归类：前者是单文件模型的结构性约束（要合并进同一文件或改用 ZIP 站点），
 * 后者是换个库就能解决——两类的可操作动作完全不同，不该混在一句话里。
 */
export interface ImportCheckResult {
  code: "RELATIVE_IMPORT" | "IMPORT_NOT_ALLOWED";
  message: string;
  /** 全部越界项（含替代建议），供错误卡渲染芯片与「复制修复提示词」 */
  offenders: OffendingImport[];
}

export function checkImports(
  imports: string[],
  allowed: Record<string, string>
): ImportCheckResult | null {
  const relative: string[] = [];
  const notAllowed: string[] = [];
  const seen = new Set<string>();
  for (const source of imports) {
    if (seen.has(source)) continue; // 同一 specifier 多次导入只报一次
    seen.add(source);
    if (source.startsWith("./") || source.startsWith("../") || source.startsWith("/")) {
      relative.push(source);
    } else if (!(source in allowed)) {
      notAllowed.push(source);
    }
  }

  // 相对路径优先报：它的修复动作（合并进同一文件 / 改用 ZIP 站点）更结构性
  if (relative.length > 0) {
    const list = relative.map((s) => `「${s}」`).join("、");
    return {
      code: "RELATIVE_IMPORT",
      message: `暂不支持相对路径导入${list}：artifact 必须是单文件，请把被引用的代码合并进同一个文件。`,
      offenders: relative.map((source) => ({
        source,
        suggestion: "把该文件的内容合并进同一个文件；多文件项目请改用 ZIP 站点托管",
      })),
    };
  }

  if (notAllowed.length > 0) {
    const list = notAllowed.map((s) => `「${s}」`).join("、");
    return {
      code: "IMPORT_NOT_ALLOWED",
      message: `暂不支持导入${list}。当前支持的库：${supportedListText()}。请改用支持范围内的库，或移除该依赖。`,
      offenders: notAllowed.map((source) => ({ source, suggestion: suggestFor(source) })),
    };
  }

  return null;
}
