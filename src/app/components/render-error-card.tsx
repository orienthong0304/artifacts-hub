/**
 * 渲染错误卡（能力波次 1 · W1-3）——消费契约 §4.1 的结构化 error。
 *
 * 这个组件出现的时刻，正是用户最卡住、最可能流失的时刻：他拿着 AI 生成的代码来，
 * 结果看到一句读不懂的报错。而他手边**正开着那个 AI**。
 * 所以这里的主操作不是「重试」，是「复制修复提示词」——把渲染失败变成回到对话的闭环。
 *
 * 这条能力只有我方做得成：竞品不转译 JSX，结构上不存在 IMPORT_NOT_ALLOWED /
 * TRANSPILE_ERROR 这类失败，要复制得先造一个转译器。
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, ClipboardCopy, CornerDownRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** 与契约 §4.1 对齐的结构化错误（主站侧只读，字段全部可选以兼容旧 runner） */
export interface RunnerError {
  message: string;
  code?: string;
  fatal?: boolean;
  detail?: {
    line?: number;
    column?: number;
    frame?: string;
    imports?: { source: string; suggestion?: string }[];
    resource?: string;
    raw?: string;
  };
}

/** 按错误码给一行人话标题——用户先要知道「这是什么事」，再看细节 */
function titleFor(err: RunnerError): string {
  switch (err.code) {
    case 'IMPORT_NOT_ALLOWED':
      return '这段代码用到了平台没有内置的库';
    case 'RELATIVE_IMPORT':
      return '这段代码引用了其它文件';
    case 'NO_DEFAULT_EXPORT':
      return '没有找到要渲染的组件';
    case 'TRANSPILE_ERROR':
      return err.detail?.line ? `第 ${err.detail.line} 行语法有问题` : '代码语法有问题';
    case 'RESOURCE_FAILED':
      return '有资源没能加载成功';
    case 'SANDBOX_UNSUPPORTED':
      return '这段代码用到了沙箱里不可用的能力';
    case 'TIMEOUT':
      return '渲染超时了';
    case 'BABEL_LOAD_FAILED':
      return '转译器没能加载';
    default:
      return '渲染出错了';
  }
}

/** 平台硬约束——进提示词，让 AI 一次改对而不是反复试 */
const PLATFORM_RULES = [
  '必须是**单文件**：不能有相对路径 import，所有代码合并进同一个文件',
  '必须有 `export default` 导出根组件',
  '只能用平台白名单内的依赖（见下方清单），不能引入其它 npm 包',
  '不能引用本地图片/字体等资源；图片请用完整 URL 或 data: URI',
];

/**
 * 组装「复制给 AI 的修复提示词」。
 * 刻意**不含用户代码全文**——用户手边就有原文，把几十 KB 代码塞进剪贴板既无必要，
 * 也会让提示词超出对话窗口。需要的是：错在哪、为什么错、改成什么。
 */
function buildFixPrompt(err: RunnerError): string {
  const lines: string[] = [
    '我把这段代码发布到 Artifacts 平台时渲染失败了，请帮我修好。',
    '',
    '## 报错',
    err.message,
  ];

  const d = err.detail;
  if (d?.line) {
    lines.push('', `位置：第 ${d.line} 行${d.column != null ? ` 第 ${d.column} 列` : ''}`);
  }
  if (d?.frame) {
    lines.push('', '```', d.frame, '```');
  }
  if (d?.imports?.length) {
    lines.push('', '## 需要替换的依赖');
    for (const it of d.imports) {
      lines.push(`- \`${it.source}\`${it.suggestion ? ` → ${it.suggestion}` : ''}`);
    }
  }
  if (d?.resource) {
    lines.push('', `加载失败的资源：${d.resource}`);
  }

  lines.push('', '## 平台约束（请严格遵守）');
  PLATFORM_RULES.forEach((r) => lines.push(`- ${r}`));
  lines.push('', '请直接给出修改后的完整单文件代码。');
  return lines.join('\n');
}

interface Props {
  error: RunnerError;
  /** 作者态才显示「复制修复提示词」——访客看到它没有意义（他改不了这个作品） */
  showFixActions?: boolean;
  /** 编辑器传入：点「跳到第 N 行」时定位代码框 */
  onJumpToLine?: (line: number) => void;
}

export default function RenderErrorCard({ error, showFixActions, onJumpToLine }: Props) {
  const [copied, setCopied] = useState(false);
  const [fallbackText, setFallbackText] = useState('');

  const offenders = error.detail?.imports ?? [];
  const line = error.detail?.line;

  const copyPrompt = async () => {
    const text = buildFixPrompt(error);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 8000);
    } catch {
      // 剪贴板不可用（http 环境 / 权限受限）：降级为可长按选中的文本块，绝不静默失败
      setFallbackText(text);
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bg/80 p-4 sm:p-6">
      <div className="max-h-full w-full max-w-xl overflow-auto rounded-card border border-line bg-surface p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-2 text-ink">
          <AlertTriangle className="h-5 w-5 shrink-0 text-accent" />
          <h3 className="font-serif text-lg font-semibold">{titleFor(error)}</h3>
        </div>

        {/* 越界依赖芯片：一眼看清「哪些库要换成什么」 */}
        {offenders.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {offenders.map((it) => (
              <li
                key={it.source}
                className="rounded-full border border-line bg-bg px-2.5 py-1 text-xs text-ink-muted"
              >
                <code className="text-ink">{it.source}</code>
                {it.suggestion && (
                  <>
                    <CornerDownRight className="mx-1 inline h-3 w-3 text-accent" />
                    {it.suggestion}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* code frame：等宽 + 不换行 + 横向滚动。折行会让 caret 与列号错位，读不出问题在哪 */}
        {error.detail?.frame ? (
          <pre className="mt-3 max-h-52 overflow-auto rounded-md bg-bg p-3 font-mono text-xs leading-relaxed whitespace-pre text-ink-muted">
            {error.detail.frame}
          </pre>
        ) : (
          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-bg p-3 text-xs leading-relaxed text-ink-muted">
            {error.message}
          </pre>
        )}

        {/* 相对路径导入：给两条真实出路，而不是只说「不支持」 */}
        {error.code === 'RELATIVE_IMPORT' && (
          <p className="mt-3 text-xs leading-relaxed text-ink-muted">
            单文件作品需要把被引用的代码合并进同一个文件。如果这本来就是个多文件项目，
            <Link to="/sites" className="mx-1 text-accent hover:underline">
              改用 ZIP 站点托管
            </Link>
            更合适。
          </p>
        )}

        {showFixActions && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" className="rounded-full" onClick={copyPrompt}>
              {copied ? (
                <>
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                  已复制，去 AI 里粘贴
                </>
              ) : (
                <>
                  <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" />
                  复制修复提示词
                </>
              )}
            </Button>
            {line != null && onJumpToLine && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full border-line"
                onClick={() => onJumpToLine(line)}
              >
                跳到第 {line} 行
              </Button>
            )}
          </div>
        )}

        {/* 剪贴板不可用时的降级：给出可手动选中的完整文本 */}
        {fallbackText && (
          <div className="mt-3">
            <p className="text-xs text-ink-muted">
              浏览器不允许自动复制，请手动选中下面的文字：
            </p>
            <textarea
              readOnly
              value={fallbackText}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-1.5 h-32 w-full rounded-md border border-line bg-bg p-2 font-mono text-xs text-ink-muted"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export { buildFixPrompt };
