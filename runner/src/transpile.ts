// 浏览器端转译：@babel/standalone（presets: typescript + react）把用户单文件 TSX/JSX 转成可执行 ESM。
// 转译同时完成三件事（通过自定义 Babel 插件在 AST 层处理，避免脆弱的正则分析）：
//   1. 收集所有 import / export-from 的来源，供白名单校验
//   2. 检测是否存在 default export，无则由调用方报中文错误
//   3. 把 export 语句改写为普通声明，并把 default export 挂到 globalThis.__ARTIFACT_DEFAULT__，
//      使转译产物可以作为内联 <script type="module"> 与挂载引导代码拼在同一个模块里执行

import * as BabelNS from "@babel/standalone";

// @babel/standalone 是 CJS 包，防御性取 default
const Babel: any = (BabelNS as any).default ?? BabelNS;

export interface TranspileResult {
  /** 改写后的 JS 代码（无 export 语句，default 挂到 globalThis.__ARTIFACT_DEFAULT__） */
  code: string;
  /** 所有 import 来源（含 export ... from 的来源） */
  imports: string[];
  /** 源码中是否有 default export */
  hasDefaultExport: boolean;
}

/**
 * 转译失败。除中文 message 外保留 Babel 给出的位置与 code frame（契约 §4.1）——
 * 让用户看到「第 6 行第 14 列」和带 caret 的代码片段，而不是一句「请检查语法」。
 * 这些字段直接进「复制修复提示词」，是 AI 一轮改对的关键输入。
 */
export class TranspileError extends Error {
  line?: number;
  column?: number;
  /** Babel 的 code frame（带行号与 caret 的多行文本） */
  frame?: string;
  /** 原始报错文本，不做解析、不吞错 */
  raw?: string;

  constructor(
    message: string,
    extra: { line?: number; column?: number; frame?: string; raw?: string } = {}
  ) {
    super(message);
    this.line = extra.line;
    this.column = extra.column;
    this.frame = extra.frame;
    this.raw = extra.raw;
  }
}

/** 收集 import 并改写 export 的 Babel 插件 */
function createArtifactPlugin(meta: { imports: string[]; hasDefault: boolean }) {
  return function artifactPlugin(babel: any) {
    const t = babel.types;

    const assignDefault = (expr: any) =>
      t.expressionStatement(
        t.assignmentExpression(
          "=",
          t.memberExpression(t.identifier("globalThis"), t.identifier("__ARTIFACT_DEFAULT__")),
          expr
        )
      );

    return {
      visitor: {
        // 必须在 Program enter 时扫描原始 AST 收集 import：
        // preset-typescript 会在自己的 Program 阶段删除未使用的 import（当作潜在类型导入），
        // 若依赖 ImportDeclaration 访问器，未使用的白名单外 import 会漏检。
        // 插件访问器先于 preset 执行，此时 AST 尚未被改写。
        Program(path: any) {
          for (const stmt of path.node.body) {
            if (stmt.type === "ImportDeclaration") {
              if (stmt.importKind !== "type") meta.imports.push(stmt.source.value);
            } else if (stmt.type === "ExportNamedDeclaration" && stmt.source) {
              if (stmt.exportKind !== "type") meta.imports.push(stmt.source.value);
            } else if (stmt.type === "ExportAllDeclaration") {
              meta.imports.push(stmt.source.value);
            } else if (stmt.type === "ExportDefaultDeclaration") {
              meta.hasDefault = true;
            }
          }
        },
        ExportAllDeclaration(path: any) {
          path.remove();
        },
        ExportNamedDeclaration(path: any) {
          const node = path.node;
          if (node.source) {
            // export { x } from 'pkg' —— 来源已在 Program 阶段计入白名单校验，导出本身对单文件渲染无意义，移除
            path.remove();
            return;
          }
          if (node.declaration) {
            // export const A = ... / export function B() {} → 保留声明，去掉 export
            path.replaceWith(node.declaration);
            return;
          }
          // export { a, b } → 移除
          path.remove();
        },
        ExportDefaultDeclaration(path: any) {
          meta.hasDefault = true;
          const decl = path.node.declaration;
          if ((t.isFunctionDeclaration(decl) || t.isClassDeclaration(decl)) && decl.id) {
            // export default function App() {} → 保留具名声明 + 挂载
            path.replaceWithMultiple([decl, assignDefault(t.identifier(decl.id.name))]);
          } else if (t.isFunctionDeclaration(decl) || t.isClassDeclaration(decl)) {
            // 匿名 function / class → 转表达式后挂载
            path.replaceWith(assignDefault(t.toExpression(decl)));
          } else {
            // export default <表达式>
            path.replaceWith(assignDefault(decl));
          }
        },
      },
    };
  };
}

/** 转译 react 类型的用户代码；语法错误抛 TranspileError（中文提示 + 原始错误） */
export function transpileReact(source: string): TranspileResult {
  const meta = { imports: [] as string[], hasDefault: false };
  let result: { code?: string | null };
  try {
    result = Babel.transform(source, {
      filename: "artifact.tsx",
      sourceType: "module",
      presets: [
        ["typescript", { isTSX: true, allExtensions: true }],
        ["react", { runtime: "automatic", development: false }],
      ],
      plugins: [createArtifactPlugin(meta)],
    });
  } catch (err: any) {
    const raw = err && err.message ? String(err.message) : String(err);
    // Babel 把位置放在 err.loc（{line,column}），code frame 放在 err.codeFrame 或
    // 追加在 message 尾部。两处都取，取不到就退化为纯文本——绝不因为解析失败而吞掉原始报错。
    const line = err?.loc?.line;
    const column = err?.loc?.column;
    const frame: string | undefined =
      typeof err?.codeFrame === "string"
        ? err.codeFrame
        : /\n\s*\d+\s*\|/.test(raw)
          ? raw.slice(raw.indexOf("\n") + 1)
          : undefined;
    // message 保留原措辞（旧消费方只读它，展示效果必须不变）；位置另放结构化字段
    throw new TranspileError(`代码转译失败（请检查语法）：${raw}`, {
      line,
      column,
      frame,
      raw,
    });
  }
  if (!result || typeof result.code !== "string") {
    throw new TranspileError("代码转译失败：转译器未产出结果。");
  }
  return { code: result.code, imports: meta.imports, hasDefaultExport: meta.hasDefault };
}
