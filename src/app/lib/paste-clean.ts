/**
 * 粘贴即成功（能力波次 2 · W2-1）。
 *
 * 用户的真实动作是「在 Claude 里生成 → 全选复制 → 粘到我们这」，
 * 复制到的十有八九不是纯代码，而是**带 markdown 围栏、甚至前后夹着解说文字**的一整段回复。
 * 此前我们原样收下 → 第一行 ``` 直接让 Babel 报语法错 → 用户以为是我们的问题。
 *
 * 这里做三件确定性的事（零模型调用、可逐条验证）：
 *   1. 剥 markdown 围栏（``` / ~~~，含 info string；夹在解说里时取最长的一块）
 *   2. 嗅探类型（react / html），让类型选择器自动跟着粘贴内容走
 *   3. 字节计数（500KB 上限是契约第 2 节的硬约束，得在发布前就看得见）
 *
 * 全部纯函数，无副作用，供 editor.tsx 调用。
 */

/** 代码上限 500KB（契约第 2 节） */
export const MAX_CODE_BYTES = 500 * 1024;

/** 围栏：行首 3 个及以上的 ` 或 ~，后面可跟 info string（tsx / jsx / html / javascript…） */
const FENCE_OPEN_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\n`]*)$/;

export interface FenceBlock {
  lang: string;
  code: string;
}

/**
 * 提取文本里的所有 markdown 代码块。
 * 闭合围栏必须是同种字符且不短于开围栏（CommonMark 规则），这样代码内部
 * 出现的 ``` 才不会把块提前截断。
 */
export function extractFences(text: string): FenceBlock[] {
  const lines = text.split('\n');
  const blocks: FenceBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = FENCE_OPEN_RE.exec(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    const marker = m[1][0];
    const minLen = m[1].length;
    const lang = m[2].trim().toLowerCase();
    const body: string[] = [];
    i++;
    let closed = false;
    while (i < lines.length) {
      const c = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i]);
      if (c && c[1][0] === marker && c[1].length >= minLen) {
        closed = true;
        i++;
        break;
      }
      body.push(lines[i]);
      i++;
    }
    // 未闭合的围栏也收下：AI 回复被截断时很常见，此时后面全部内容就是代码
    void closed;
    blocks.push({ lang, code: body.join('\n') });
  }
  return blocks;
}

export interface CleanResult {
  code: string;
  /** 是否真的改动了内容（没改就别打扰用户） */
  changed: boolean;
  /** 给用户看的一句话，说明我们动了什么 */
  note: string;
  /** 围栏上标注的语言（tsx/html…），可用于类型嗅探 */
  fenceLang: string;
}

/**
 * 清洗粘贴内容：剥围栏。
 *
 * 判定顺序：
 *   - 没有围栏 → 原样返回
 *   - 只有一个围栏块 → 取它
 *   - 多个围栏块 → 取**字节最长**的那个（AI 回复常先给一小段示例再给完整文件）
 */
export function cleanPastedCode(raw: string): CleanResult {
  const blocks = extractFences(raw);
  if (blocks.length === 0) {
    return { code: raw, changed: false, note: '', fenceLang: '' };
  }
  let best = blocks[0];
  for (const b of blocks) if (b.code.length > best.code.length) best = b;

  const code = best.code.replace(/^\n+/, '').replace(/\s+$/, '');
  if (!code.trim()) return { code: raw, changed: false, note: '', fenceLang: '' };

  const note =
    blocks.length > 1
      ? `已从粘贴内容中提取最长的一段代码（共 ${blocks.length} 段），并去掉 markdown 围栏`
      : '已去掉粘贴内容里的 markdown 围栏';
  return { code, changed: code !== raw, note, fenceLang: best.lang };
}

export type SniffedKind = 'react' | 'html';

/**
 * 类型嗅探。
 *
 * html 的判据是**结构性**的：doctype、<html>、或以标签开头且带 <head>/<body>/<script>/<style>。
 * react 的判据是模块语法：import/export。
 * 两者都不成立时返回 null —— 不猜，保持用户当前选择。
 */
export function sniffKind(code: string, fenceLang = ''): SniffedKind | null {
  const lang = fenceLang.trim().toLowerCase();
  if (lang === 'html' || lang === 'htm') return 'html';
  if (['tsx', 'jsx', 'react'].includes(lang)) return 'react';

  const head = code.slice(0, 4000);
  const lower = head.toLowerCase();
  const trimmed = head.replace(/^\s*(<!--[\s\S]*?-->\s*)*/, '');

  if (/^\s*<!doctype\s+html/i.test(trimmed) || /^\s*<html[\s>]/i.test(trimmed)) return 'html';

  // 模块语法一出现就是 react：完整 HTML 文档里不会有裸的 import/export 语句
  if (/^\s*import\s[\s\S]*?from\s+['"]/m.test(head) || /^\s*export\s+(default|const|function)\s/m.test(code)) {
    return 'react';
  }

  if (/^\s*</.test(trimmed) && /<(head|body|script|style)[\s>]/i.test(lower)) return 'html';

  return null;
}

/** 字节数（UTF-8），与后端及 formSchema 的判据一致 */
export function byteLength(code: string): number {
  return new TextEncoder().encode(code).length;
}

/** 人类可读体积：<1KB 显示 B，否则一位小数的 KB */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}
