/**
 * RunnerFrame：封装渲染子域 iframe 的握手 / 渲染 / 错误态
 * postMessage 协议见契约第 4 节：
 *   runner → 主站  { __artifacts, type: 'ready' | 'rendered' | 'error' | 'resize' }
 *   主站 → runner  { __artifacts, type: 'render', payload: { kind, code } }
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import RenderErrorCard, { type RunnerError } from '@/app/components/render-error-card';
import { RUNNER_ORIGIN } from '@/app/config';
import { cn } from '@/lib/utils';
import type { ArtifactType } from '@/app/lib/api';

export type RunnerStatus = 'loading' | 'rendering' | 'rendered' | 'error';

interface RunnerFrameProps {
  kind: ArtifactType;
  code: string;
  /** 代码变化后延迟发送 render 的毫秒数（编辑器传 800，查看页默认 0） */
  debounceMs?: number;
  /** 显示「用 Artifacts 制作」角标（查看页 true；编辑器预览缺省不显示） */
  badge?: boolean;
  /**
   * 生成合成内容标识（契约 §3.11）：true 时角标文案为「⚡ AI 生成 · 用 Artifacts 制作」。
   * 缺省 true——漏标一条生成内容的代价大于给一条非生成内容误标。
   */
  aiLabel?: boolean;
  className?: string;
  onStatusChange?: (status: RunnerStatus, errorMessage?: string) => void;
  /**
   * 作者态：显示「复制修复提示词」与已渲染成功后的运行时问题徽标。
   * 访客态不显示——他改不了这个作品，给他这些只是噪音（契约 §4.1 的 fatal 分级前端表现）。
   */
  showFixActions?: boolean;
  /** 编辑器传入：点「跳到第 N 行」时定位代码框 */
  onJumpToLine?: (line: number) => void;
}

interface RunnerMessage {
  __artifacts?: boolean;
  type?: string;
  message?: string;
  /** 结构化错误码（契约 §4.1）；旧 runner 不带此字段 */
  code?: string;
  /** 首屏就失败 = true；已渲染成功后的局部问题 = false。缺省视为 true（旧 runner 语义） */
  fatal?: boolean;
  detail?: RunnerError['detail'];
  height?: number;
}

export default function RunnerFrame({
  kind,
  code,
  debounceMs = 0,
  badge = false,
  aiLabel = true,
  className,
  onStatusChange,
  showFixActions = false,
  onJumpToLine,
}: RunnerFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  /** runner 未就绪时暂存的最新 payload */
  const pendingRef = useRef<{
    kind: ArtifactType;
    code: string;
    badge: boolean;
    aiLabel: boolean;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusCallbackRef = useRef(onStatusChange);
  statusCallbackRef.current = onStatusChange;

  const [status, setStatus] = useState<RunnerStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  /** 当前致命错误的结构化形态（契约 §4.1）；旧 runner 只给 message 时也能退化展示 */
  const [fatalError, setFatalError] = useState<RunnerError | null>(null);
  /** 已渲染成功之后发生的运行时问题：不遮挡作品，作者态折叠为一枚徽标 */
  const [runtimeIssues, setRuntimeIssues] = useState<RunnerError[]>([]);
  const [issuesOpen, setIssuesOpen] = useState(false);

  const updateStatus = useCallback((next: RunnerStatus, message = '') => {
    setStatus(next);
    setErrorMessage(message);
    statusCallbackRef.current?.(next, message || undefined);
  }, []);

  const postRender = useCallback(
    (payload: { kind: ArtifactType; code: string; badge: boolean; aiLabel: boolean }) => {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow) return;
      updateStatus('rendering');
      setFatalError(null);
      setRuntimeIssues([]);
      // sandbox 无 allow-same-origin 时 iframe 为 opaque origin，任何具体
      // targetOrigin 都无法投递，只能用 '*'（消息只含用户自己的代码，无敏感数据）
      frameWindow.postMessage(
        { __artifacts: true, type: 'render', payload },
        '*',
      );
    },
    [updateStatus],
  );

  // 监听 runner 消息（校验 origin 与 __artifacts 标记）
  useEffect(() => {
    const onMessage = (event: MessageEvent<RunnerMessage>) => {
      // opaque origin 的 iframe 消息 origin 恒为 "null"，无法按域名校验；
      // 以 event.source 与 __artifacts 标记做身份校验（source 校验更强）
      const data = event.data;
      if (!data || data.__artifacts !== true) return;
      if (event.source !== iframeRef.current?.contentWindow) return;

      switch (data.type) {
        case 'ready': {
          readyRef.current = true;
          if (pendingRef.current) {
            postRender(pendingRef.current);
            pendingRef.current = null;
          }
          break;
        }
        case 'rendered':
          updateStatus('rendered');
          break;
        case 'error': {
          const err: RunnerError = {
            message: data.message || '渲染失败，请检查代码。',
            code: data.code,
            fatal: data.fatal,
            detail: data.detail,
          };
          // 契约 §4.1 的 fatal 分级：已渲染成功后的局部问题（一张图 404、一次运行时异常）
          // 不该把整页盖成错误卡——作品还在正常跑，访客应该继续看到它。
          // 缺省视为 fatal，保持旧 runner 的刚性行为（向后兼容）。
          if (data.fatal === false) {
            setRuntimeIssues((prev) =>
              // 同一条重复上报（如轮询失败的资源）只留一条
              prev.some((p) => p.message === err.message) ? prev : [...prev, err],
            );
            break;
          }
          setFatalError(err);
          updateStatus('error', err.message);
          break;
        }
        case 'resize':
          // 内容高度自适应（可选能力），全屏 iframe 场景无需处理
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [postRender, updateStatus]);

  /**
   * 握手超时兜底（计划 W1-8）：渲染子域被拦（企业网络 / 浏览器策略 / DNS 故障）或
   * 加载失败时，iframe 不会触发任何事件，`ready` 永不到达——此前的表现是**永久转圈**，
   * 用户会判定「平台坏了」。子域 shell 早已有同款 10s timer（serve.ts），主站没有。
   */
  useEffect(() => {
    if (readyRef.current) return;
    const timer = setTimeout(() => {
      if (!readyRef.current) {
        updateStatus(
          'error',
          `渲染器加载失败。可能是网络问题，或浏览器/网络策略拦截了渲染子域（${RUNNER_ORIGIN}）。请刷新重试，或换用其它网络。`
        );
      }
    }, 10_000);
    return () => clearTimeout(timer);
  }, [updateStatus]);

  // 代码 / 类型变化 → 防抖后发送 render（每次 render 覆盖上一次）
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const send = () => {
      const payload = { kind, code, badge, aiLabel };
      if (readyRef.current) {
        postRender(payload);
      } else {
        pendingRef.current = payload;
      }
    };
    if (debounceMs > 0) {
      timerRef.current = setTimeout(send, debounceMs);
    } else {
      send();
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [kind, code, debounceMs, badge, aiLabel, postRender]);

  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-surface', className)}>
      <iframe
        ref={iframeRef}
        src={`${RUNNER_ORIGIN}/`}
        title="Artifact 渲染"
        // 不给 allow-same-origin：用户代码拿不到主站上下文（契约第 4 节）
        sandbox="allow-scripts allow-forms allow-popups allow-modals"
        className="h-full w-full border-0"
      />

      {/* 加载 / 渲染中遮罩 */}
      {(status === 'loading' || status === 'rendering') && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg/60">
          <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm text-ink-muted shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            {status === 'loading' ? '正在加载渲染器…' : '正在渲染…'}
          </div>
        </div>
      )}

      {/* 致命错误：结构化错误卡（契约 §4.1） */}
      {status === 'error' && (
        <RenderErrorCard
          error={fatalError ?? { message: errorMessage }}
          showFixActions={showFixActions}
          onJumpToLine={onJumpToLine}
        />
      )}

      {/* 已渲染成功后的运行时问题：不遮挡作品；仅作者可见，折叠为右上角一枚徽标 */}
      {showFixActions && status !== 'error' && runtimeIssues.length > 0 && (
        <div className="absolute right-3 top-3 z-10 max-w-[min(22rem,80%)]">
          <button
            type="button"
            onClick={() => setIssuesOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft/95 px-2.5 py-1 text-xs text-ink shadow-sm backdrop-blur"
          >
            <AlertTriangle className="h-3.5 w-3.5 text-accent" />
            {runtimeIssues.length} 处运行时问题
          </button>
          {issuesOpen && (
            <ul className="mt-1.5 space-y-1 rounded-card border border-line bg-surface/95 p-2.5 text-xs leading-relaxed text-ink-muted shadow-md backdrop-blur">
              {runtimeIssues.map((it, i) => (
                <li key={i} className="break-words">
                  {it.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
