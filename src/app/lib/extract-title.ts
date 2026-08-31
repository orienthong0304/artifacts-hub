/**
 * 从代码中提取候选标题（契约 §5 编辑器体验）：
 *   html  → <title> 内容，退而求其次首个 <h1>
 *   react → default export 的函数组件名（PascalCase 拆词；App 视为无信息）
 */
import type { ArtifactType } from '@/app/lib/api';

export function extractTitle(code: string, type: ArtifactType): string {
  if (type === 'html') {
    const title = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(code)?.[1]?.trim();
    if (title) return title;
    return /<h1[^>]*>([^<]{1,120})<\/h1>/i.exec(code)?.[1]?.trim() ?? '';
  }
  const name = /export\s+default\s+function\s+([A-Za-z][A-Za-z0-9_]*)/.exec(code)?.[1];
  if (!name || name === 'App') return '';
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}
