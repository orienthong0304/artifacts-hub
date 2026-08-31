/**
 * 代码编辑框（能力波次 2，站长点名项）。
 *
 * 行为：先渲染裸 Textarea（可立即输入、可粘贴），同时后台动态 import CodeMirror；
 * chunk 到位后**原地换成 CodeMirror 并保留当前内容与滚动意图**。
 *
 * 为什么不用 React.lazy + Suspense：Suspense 的 fallback 是「另一棵树」，
 * 切换时会丢掉用户已经敲进 Textarea 的焦点与选区；而且 chunk 加载失败时
 * Suspense 只会把整页炸成错误边界——编辑器加载不出来不应该让人发布不了作品。
 * 这里失败就**永久停在 Textarea**，只在控制台留一行，用户照常能用。
 *
 * jumpToLine 两条实现都在（CodeMirror 版 / Textarea 版），由 ref 统一暴露，
 * 调用方（editor.tsx 的错误卡「跳到第 N 行」）不需要知道当前是哪种。
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { CodeKind, EditorHandle } from './codemirror-setup';

export interface CodeEditorHandle {
  /** 跳到第 N 行并选中（1-indexed） */
  jumpToLine(line: number): void;
  focus(): void;
}

interface Props {
  value: string;
  kind: CodeKind;
  placeholder?: string;
  onChange: (value: string) => void;
  /**
   * 整篇粘贴时的改写钩子（W2-1 粘贴即成功）。
   * **只在这一次粘贴会替换掉整个文档时触发**（文档为空，或选区覆盖全文）——
   * 也就是「在 Claude 里全选复制、粘到这」的那一刻。
   * 返回 null 表示不改写。
   *
   * 为什么不在 onChange 里无差别清洗：用户完全可能做一个「展示 markdown 的 HTML 页面」，
   * 正文里就带着三反引号围栏。无差别清洗会把人家的内容吃掉，是静默数据丢失。
   */
  onFullPaste?: (text: string) => string | null;
  className?: string;
  id?: string;
}

const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(
  { value, kind, placeholder, onChange, onFullPaste, className, id },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  /** onChange 放 ref：CodeMirror 的 updateListener 在 create 时就闭包固定了 */
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  /** 初始文档放 ref：异步 import 期间用户可能已经往 Textarea 里粘了东西 */
  const valueRef = useRef(value);
  valueRef.current = value;
  const fullPasteRef = useRef(onFullPaste);
  fullPasteRef.current = onFullPaste;

  const [ready, setReady] = useState(false);

  // 挂载即开始下载 chunk；失败则静默停在 Textarea
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('./codemirror-setup');
        if (cancelled || !hostRef.current) return;
        handleRef.current = mod.createEditor({
          parent: hostRef.current,
          doc: valueRef.current,
          kind,
          placeholder,
          onChange: (v) => onChangeRef.current(v),
          onFullPaste: (text) => fullPasteRef.current?.(text) ?? null,
        });
        setReady(true);
      } catch (e) {
        // 编辑器加载不出来不该让人发布不了作品——留在 Textarea
        console.warn('[code-editor] CodeMirror 加载失败，继续使用基础编辑框', e);
      }
    })();
    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // 只挂载一次：kind 变化走下面的 setKind，不重建（重建会丢撤销栈）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部值变更（上传文件、粘贴清洗、编辑模式回填）同步进 CodeMirror
  useEffect(() => {
    if (ready) handleRef.current?.setValue(value);
  }, [value, ready]);

  useEffect(() => {
    if (ready) handleRef.current?.setKind(kind);
  }, [kind, ready]);

  useImperativeHandle(ref, () => ({
    jumpToLine(line: number) {
      if (handleRef.current) {
        handleRef.current.jumpToLine(line);
        return;
      }
      // Textarea 版：按行累加偏移 + setSelectionRange + 估算 scrollTop
      const el = textareaRef.current;
      if (!el) return;
      const lines = el.value.split('\n');
      const idx = Math.min(Math.max(line, 1), lines.length) - 1;
      const start = lines.slice(0, idx).reduce((n, l) => n + l.length + 1, 0);
      el.focus();
      el.setSelectionRange(start, start + lines[idx].length);
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      el.scrollTop = Math.max(0, idx * lh - el.clientHeight / 3);
    },
    focus() {
      if (handleRef.current) handleRef.current.focus();
      else textareaRef.current?.focus();
    },
  }));

  return (
    <div className={cn('relative min-h-0 overflow-hidden rounded-md border border-input bg-surface', className)}>
      {/* CodeMirror 宿主：chunk 未到位时高度为 0，不占位 */}
      <div ref={hostRef} className={cn('h-full', !ready && 'hidden')} />
      {!ready && (
        <Textarea
          id={id}
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const el = textareaRef.current;
            const fn = fullPasteRef.current;
            if (!el || !fn) return;
            const coversAll =
              el.value.trim() === '' ||
              (el.selectionStart === 0 && el.selectionEnd === el.value.length);
            if (!coversAll) return;
            const text = e.clipboardData.getData('text/plain');
            const next = fn(text);
            if (next === null) return;
            e.preventDefault();
            onChange(next);
          }}
          spellCheck={false}
          placeholder={placeholder}
          className="h-full w-full resize-none rounded-md border-0 bg-surface font-mono text-[13px] leading-relaxed focus-visible:ring-0"
        />
      )}
    </div>
  );
});

export default CodeEditor;
