/**
 * CodeMirror 6 装配（能力波次 2，站长点名项）。
 *
 * 本模块是**唯一**引入 @codemirror/* 的地方，且只被 code-editor.tsx 动态 import ——
 * Vite 会把它单独切 chunk，主 bundle 不含编辑器代码，只有进 /new 或 /edit 才下载。
 *
 * 刻意不装 basicSetup：它自带自动补全与 lint。站长批复只要
 * 「行号 + JSX/TS 高亮 + 当前行高亮 + Tab 缩进」——补全对着一份我们**不做类型检查**的
 * 单文件代码只会给出错误建议，lint 会和 runner 的真实白名单判定打架（runner 才是真值）。
 */
import { EditorState, type Extension, Compartment } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  bracketMatching,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
  HighlightStyle,
} from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { tags as t } from '@lezer/highlight';

/** 设计 tokens（src/index.css）：编辑器要和站点同一套色，不能自带一套深色主题 */
const INK = '#1A1915';
const INK_MUTED = '#6E6B64';
const ACCENT = '#D97757';
const LINE = '#E8E5DE';
const SURFACE = '#FFFFFF';

/** 高亮配色：珊瑚橙留给关键字与标签名，其余用暖黑/暖灰的明度层次 —— 避免彩虹屏 */
const artifactsHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: ACCENT, fontWeight: '500' },
  { tag: [t.definitionKeyword, t.modifier], color: ACCENT },
  { tag: [t.string, t.special(t.string)], color: '#3F7E52' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#8A5A2B' },
  { tag: [t.comment, t.blockComment, t.lineComment], color: '#9A968C', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#2B5D8A' },
  { tag: [t.propertyName], color: INK },
  { tag: [t.typeName, t.className, t.namespace], color: '#7A4E9E' },
  { tag: [t.tagName, t.angleBracket], color: ACCENT },
  { tag: [t.attributeName], color: '#8A5A2B' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: INK_MUTED },
  { tag: [t.variableName], color: INK },
  { tag: t.invalid, color: '#B42318' },
]);

const artifactsTheme = EditorView.theme({
  '&': {
    backgroundColor: SURFACE,
    color: INK,
    fontSize: '13px',
    height: '100%',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    lineHeight: '1.6',
    overflow: 'auto',
  },
  '.cm-content': { padding: '8px 0', caretColor: ACCENT },
  '.cm-gutters': {
    backgroundColor: SURFACE,
    color: '#B8B4AA',
    border: 'none',
    borderRight: `1px solid ${LINE}`,
    paddingRight: '2px',
  },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(217,119,87,0.07)', color: INK_MUTED },
  '.cm-activeLine': { backgroundColor: 'rgba(217,119,87,0.05)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: ACCENT, borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(217,119,87,0.20)',
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'rgba(217,119,87,0.18)',
    outline: 'none',
  },
  '.cm-placeholder': { color: 'rgba(110,107,100,0.6)' },
  // 触摸端把行号区收窄一点，375px 宽下别吃掉太多代码宽度
  '@media (max-width: 640px)': {
    '&': { fontSize: '12px' },
    '.cm-gutters': { paddingRight: '0' },
  },
}, { dark: false });

export type CodeKind = 'react' | 'html';

function languageFor(kind: CodeKind): Extension {
  return kind === 'html'
    ? html({ matchClosingTags: true, autoCloseTags: false })
    : javascript({ jsx: true, typescript: true });
}

export interface EditorHandle {
  view: EditorView;
  /** 外部值变更（上传文件、清洗粘贴内容）时同步进编辑器；与当前内容相同则不动，避免打断输入 */
  setValue(next: string): void;
  /** 切换 react/html 语言，不重建编辑器（否则会丢光标与撤销栈） */
  setKind(kind: CodeKind): void;
  /** 跳到第 N 行并选中整行（错误卡的「跳到第 N 行」） */
  jumpToLine(line: number): void;
  focus(): void;
  destroy(): void;
}

export function createEditor(opts: {
  parent: HTMLElement;
  doc: string;
  kind: CodeKind;
  placeholder?: string;
  onChange: (value: string) => void;
  /** 整篇粘贴（文档为空或选区覆盖全文）时的改写钩子；返回 null 表示不改写 */
  onFullPaste?: (text: string) => string | null;
}): EditorHandle {
  const langCompartment = new Compartment();

  const state = EditorState.create({
    doc: opts.doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      rectangularSelection(),
      crosshairCursor(),
      indentOnInput(),
      bracketMatching(),
      indentUnit.of('  '),
      syntaxHighlighting(artifactsHighlight),
      artifactsTheme,
      EditorView.lineWrapping,
      langCompartment.of(languageFor(opts.kind)),
      // indentWithTab 必须在 defaultKeymap 之前：否则 Tab 先被默认绑定吃掉
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      opts.placeholder ? cmPlaceholder(opts.placeholder) : [],
      EditorView.domEventHandlers({
        paste(event, view) {
          const fn = opts.onFullPaste;
          if (!fn) return false;
          const doc = view.state.doc;
          const sel = view.state.selection.main;
          // 只接管「整篇替换」：空文档（含只有空白）、或选区覆盖全文
          const coversAll =
            doc.toString().trim() === '' || (sel.from === 0 && sel.to === doc.length);
          if (!coversAll) return false;
          const text = event.clipboardData?.getData('text/plain');
          if (!text) return false;
          const next = fn(text);
          if (next === null) return false;
          event.preventDefault();
          view.dispatch({
            changes: { from: 0, to: doc.length, insert: next },
            selection: { anchor: next.length },
          });
          return true;
        },
      }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) opts.onChange(u.state.doc.toString());
      }),
    ],
  });

  const view = new EditorView({ state, parent: opts.parent });

  return {
    view,
    setValue(next) {
      const cur = view.state.doc.toString();
      if (cur === next) return;
      view.dispatch({ changes: { from: 0, to: cur.length, insert: next } });
    },
    setKind(kind) {
      view.dispatch({ effects: langCompartment.reconfigure(languageFor(kind)) });
    },
    jumpToLine(line) {
      const total = view.state.doc.lines;
      const n = Math.min(Math.max(Math.floor(line), 1), total);
      const l = view.state.doc.line(n);
      view.dispatch({
        selection: { anchor: l.from, head: l.to },
        effects: EditorView.scrollIntoView(l.from, { y: 'center' }),
        scrollIntoView: true,
      });
      view.focus();
    },
    focus() {
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}
