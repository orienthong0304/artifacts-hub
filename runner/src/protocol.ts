// 主站 ⇄ runner 的 postMessage 协议类型（契约文档 §4）

/** 渲染类型 */
export type ArtifactKind = "react" | "html";

/** 主站 → runner */
export interface RenderMessage {
  __artifacts: true;
  type: "render";
  payload: { kind: ArtifactKind; code: string; badge?: boolean; aiLabel?: boolean };
}

/** 结构化错误码（契约 §4.1）。消费方按此分支给出可操作的中文标题与动作。 */
export type ErrorCode =
  | "IMPORT_NOT_ALLOWED"
  | "RELATIVE_IMPORT"
  | "NO_DEFAULT_EXPORT"
  | "TRANSPILE_ERROR"
  | "RUNTIME_ERROR"
  | "RESOURCE_FAILED"
  | "SANDBOX_UNSUPPORTED"
  | "TIMEOUT"
  | "BABEL_LOAD_FAILED";

/** 越界导入项：source 是原始 specifier，suggestion 是白名单内的替代建议（可无） */
export interface OffendingImport {
  source: string;
  suggestion?: string;
}

/** 错误细节（契约 §4.1）：各字段按 code 取用，缺省即不适用 */
export interface ErrorDetail {
  /** TRANSPILE_ERROR：Babel 报出的位置与 code frame */
  line?: number;
  column?: number;
  frame?: string;
  /** IMPORT_NOT_ALLOWED / RELATIVE_IMPORT：**全部**越界项（不是只报第一个） */
  imports?: OffendingImport[];
  /** RESOURCE_FAILED：加载失败的资源 URL */
  resource?: string;
  /** 原始报错文本——不做解析、不吞错，供「复制修复提示词」原样带给 AI */
  raw?: string;
}

/**
 * runner → 主站（不含标记的载荷形式，postMessage 前补上 __artifacts: true）
 *
 * error 的 message 语义严格不变（旧消费方只读它，展示效果须与修订前一致）；
 * code / detail / fatal 为可选增量字段。fatal 缺省视为 true（旧 runner 不带该字段）。
 */
export type RunnerMessageBody =
  /** ready 携带构建标识（git sha + vendor 哈希），供主站/自检页确认线上跑的是哪一版 */
  | { type: "ready"; runner?: string }
  | { type: "rendered" }
  | {
      type: "error";
      message: string;
      code?: ErrorCode;
      detail?: ErrorDetail;
      fatal?: boolean;
    }
  | { type: "resize"; height: number };

/** runner → 主站 */
export type RunnerMessage = RunnerMessageBody & { __artifacts: true };

/** 内层执行 iframe → runner（仅 runner 内部使用，转发前会换成 __artifacts 标记） */
export interface InnerMessage {
  __artifacts_inner: true;
  type: "rendered" | "error" | "resize";
  message?: string;
  /** 内层已能自行归类的错误码（资源失败 / 沙箱限制），外层据此免去二次猜测 */
  code?: ErrorCode;
  detail?: ErrorDetail;
  height?: number;
}

export function isRenderMessage(data: unknown): data is RenderMessage {
  const d = data as RenderMessage;
  return !!d && d.__artifacts === true && d.type === "render";
}

export function isInnerMessage(data: unknown): data is InnerMessage {
  const d = data as InnerMessage;
  return !!d && d.__artifacts_inner === true && typeof d.type === "string";
}
