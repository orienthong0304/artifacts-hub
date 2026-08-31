/**
 * /a/:slug 作品查看页（纯净形态，契约 §3.1 / §3.7 / §3.10）：
 * 全视口渲染，访客只见作品本身 + 右下「用 Artifacts 制作」角标（在 runner iframe 内）；
 * 仅作者可见右上角悬浮控制条（预览/代码切换、分享、编辑、历史、收起）
 * 锁定形态：居中解锁卡片，密码换令牌后无刷新进入正常查看
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Check,
  ChevronsRight,
  Copy,
  History,
  Loader2,
  Lock,
  Pencil,
  Settings2,
  Share2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import RunnerFrame from '@/app/components/runner-frame';
import ShareDialog from '@/app/components/share-dialog';
import PublishSuccessDialog from '@/app/components/publish-success-dialog';
import ReportDialog from '@/app/components/report-dialog';
import { ReviewStatusBanner } from '@/app/components/review-status';
import {
  ApiError,
  artifactApi,
  setAccessToken,
  versionApi,
  type Artifact,
  type ArtifactVersion,
} from '@/app/lib/api';
import { useAuth } from '@/app/lib/auth';
import { formatRelativeTime } from '@/app/lib/format';
import { cn } from '@/lib/utils';

export default function ArtifactViewPage() {
  const { slug = '' } = useParams();
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);

  // 作者悬浮控制条展开/收起
  const [controlsOpen, setControlsOpen] = useState(true);

  // 分享
  const [shareOpen, setShareOpen] = useState(false);

  /**
   * 发布成功浮层（W2-4）：只在编辑器跳过来的那一次弹。
   * router state 读完即用 replace 清掉——否则刷新或前进后退会重复弹。
   */
  const [publishedOpen, setPublishedOpen] = useState(false);
  useEffect(() => {
    if ((location.state as { justPublished?: boolean } | null)?.justPublished) {
      setPublishedOpen(true);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location, navigate]);

  // 版本历史（契约 §3.7，仅作者）
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState('');
  const [restoreTarget, setRestoreTarget] = useState<ArtifactVersion | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState('');

  // 解锁（锁定形态）
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState('');

  useEffect(() => {
    // 跳转判定需要比对当前用户与作者，等登录态解析完成再拉详情（authLoading 期间本页本就在 loading 态）
    if (authLoading) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setArtifact(null);
    setView('preview');
    setUnlockPassword('');
    setUnlockError('');
    artifactApi
      .get(slug)
      .then(({ artifact }) => {
        if (cancelled) return;
        // 契约 §3.10：已设自定义路径的 HTML 作品，查看页即跳子域权威地址（V1 客户端跳转）
        // 无密码作品才直跳（锁定/带密码走解锁流程），跳转后中止本页渲染避免闪烁；
        // 已下架作品与作者本人不跳转（保留下架提示与治理/管理入口，子域侧对下架作品是 404）
        const isOwner = !!user && user.username === artifact.author.username;
        if (
          artifact.customUrl &&
          artifact.type === 'html' &&
          !artifact.hasPassword &&
          !artifact.isTakenDown &&
          !isOwner
        ) {
          window.location.replace(artifact.customUrl);
          return;
        }
        setArtifact(artifact);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setError('作品不存在，或已被删除。');
        } else if (e instanceof ApiError && (e.status === 403 || e.status === 401)) {
          setError('该作品为私密作品，仅作者可见。');
        } else {
          setError((e as Error).message || '加载失败，请稍后重试。');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, authLoading, user]);

  const isAuthor = !!user && !!artifact && user.username === artifact.author.username;

  /** 解锁：密码换令牌 → 存 sessionStorage → 重新拉详情（无刷新进入正常查看） */
  const handleUnlock = async () => {
    if (!unlockPassword.trim()) {
      setUnlockError('请输入访问密码');
      return;
    }
    setUnlocking(true);
    setUnlockError('');
    try {
      const { accessToken } = await artifactApi.unlock(slug, unlockPassword);
      setAccessToken(slug, accessToken);
      const { artifact: full } = await artifactApi.get(slug);
      setArtifact(full);
      setUnlockPassword('');
    } catch (e) {
      setUnlockError((e as Error).message || '解锁失败，请稍后重试。');
    } finally {
      setUnlocking(false);
    }
  };

  /** 拉取版本列表（打开历史 Dialog / 恢复成功后刷新） */
  const loadVersions = useCallback(async (artifactId: string) => {
    setVersionsLoading(true);
    setVersionsError('');
    try {
      const { items } = await versionApi.list(artifactId);
      setVersions(items);
    } catch (e) {
      setVersionsError((e as Error).message || '加载版本历史失败，请稍后重试。');
    } finally {
      setVersionsLoading(false);
    }
  }, []);

  const openHistory = () => {
    if (!artifact) return;
    setHistoryOpen(true);
    setRestoreNotice('');
    loadVersions(artifact.id);
  };

  /** 恢复到指定版本：照走全部审核闸门；直接用恢复响应的完整 artifact（含 code）刷新，
   *  不再多发一次 get 重拉（避免多计一次 views，也避免重拉失败误报「恢复失败」） */
  const confirmRestore = async () => {
    if (!artifact || !restoreTarget) return;
    const targetVersion = restoreTarget.version;
    setRestoring(true);
    setVersionsError('');
    try {
      const { artifact: restored } = await versionApi.restore(artifact.id, targetVersion);
      setRestoreTarget(null);
      setArtifact(restored);
      await loadVersions(artifact.id);
      setRestoreNotice(`已恢复到 v${targetVersion}，恢复前的内容已存为新版本。`);
    } catch (e) {
      setRestoreTarget(null);
      setVersionsError((e as Error).message || '恢复失败，请稍后重试。');
    } finally {
      setRestoring(false);
    }
  };

  const copyCode = async () => {
    if (!artifact?.code) return;
    try {
      await navigator.clipboard.writeText(artifact.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 剪贴板不可用时静默失败 */
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-bg text-ink-muted">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-accent" />
        正在加载作品…
      </div>
    );
  }

  if (error || !artifact) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-bg px-4">
        <div className="max-w-lg text-center">
          <p className="font-serif text-2xl text-ink">无法查看该作品</p>
          <p className="mt-3 text-sm text-ink-muted">{error || '未知错误'}</p>
          <Button asChild className="mt-8 rounded-full">
            <Link to="/">回到广场</Link>
          </Button>
        </div>
      </div>
    );
  }

  const authorName = artifact.author.displayName || artifact.author.username;

  // 锁定形态：居中解锁卡片（契约 §3.1 / §3.2）
  if (artifact.locked) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-bg px-4">
        <div className="w-full max-w-sm rounded-card border border-line bg-surface p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
            <Lock className="h-5 w-5 text-accent" />
          </div>
          <h1 className="mt-4 font-serif text-xl font-semibold text-ink">{artifact.title}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            来自{' '}
            <Link
              to={`/u/${artifact.author.username}`}
              className="font-medium text-ink underline-offset-4 hover:text-accent hover:underline"
            >
              {authorName}
            </Link>
          </p>
          <p className="mt-4 text-sm text-ink-muted">该作品已设置访问密码，请输入密码查看。</p>
          <div className="mt-4 space-y-3">
            <Input
              type="password"
              value={unlockPassword}
              onChange={(e) => {
                setUnlockPassword(e.target.value);
                setUnlockError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleUnlock();
              }}
              placeholder="访问密码"
              autoFocus
              className="bg-bg text-center"
            />
            {unlockError && <p className="text-sm text-destructive">{unlockError}</p>}
            <Button className="w-full rounded-full" onClick={handleUnlock} disabled={unlocking}>
              {unlocking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              解锁
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // 正常渲染态：渲染区占满视口，访客零平台 UI（角标在 runner iframe 内）
  return (
    <div className="relative h-[100dvh] bg-bg text-ink">
      {view === 'preview' || !isAuthor ? (
        <RunnerFrame
          kind={artifact.type}
          code={artifact.code || ''}
          badge
          aiLabel={artifact.aiGenerated}
          className="h-full"
          /* 作者才看得到「复制修复提示词」与运行时问题徽标——访客改不了这个作品 */
          showFixActions={isAuthor}
        />
      ) : (
        <div className="relative h-full overflow-auto bg-[#232019] p-4 sm:p-6">
          <Button
            size="sm"
            variant="secondary"
            className="absolute right-4 top-16 z-10 rounded-full sm:right-6"
            onClick={copyCode}
          >
            {copied ? (
              <>
                <Check className="mr-1 h-3.5 w-3.5" /> 已复制
              </>
            ) : (
              <>
                <Copy className="mr-1 h-3.5 w-3.5" /> 复制代码
              </>
            )}
          </Button>
          <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-[#E8E5DE]">
            {artifact.code}
          </pre>
        </div>
      )}

      {/* 下架 / 待审提示（计划 W1-5）：仅作者/管理员能拉到这两类作品详情，访客侧是 404 或看不到。
          下架态附申诉出口——处置、告知、申诉必须成套（/terms 已把先审后展写成对外承诺） */}
      <ReviewStatusBanner artifact={artifact} />

      {/* 举报入口（合规必需）：右下角标上方极小灰字，非作者的所有访客可见 */}
      {!isAuthor && <ReportDialog artifactId={artifact.id} />}

      {/* 作者悬浮控制条：预览/代码切换、分享、编辑、历史、收起（可再展开） */}
      {isAuthor &&
        (controlsOpen ? (
          <div className="absolute right-4 top-4 z-30 flex items-center gap-1 rounded-full border border-line bg-surface/90 p-1 shadow-lg backdrop-blur">
            <div className="flex rounded-full border border-line bg-bg p-0.5 text-xs">
              {(
                [
                  { key: 'preview', label: '预览' },
                  { key: 'code', label: '代码' },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setView(t.key)}
                  className={cn(
                    'rounded-full px-3 py-1 transition-colors',
                    view === t.key ? 'bg-ink text-bg' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-ink-muted hover:text-ink"
              onClick={() => setShareOpen(true)}
            >
              <Share2 className="mr-1 h-3.5 w-3.5" />
              分享
            </Button>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="rounded-full text-ink-muted hover:text-ink"
            >
              <Link to={`/edit/${artifact.id}`}>
                <Pencil className="mr-1 h-3.5 w-3.5" />
                编辑
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-ink-muted hover:text-ink"
              onClick={openHistory}
            >
              <History className="mr-1 h-3.5 w-3.5" />
              历史
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-ink-muted hover:text-ink"
              title="收起控制条"
              onClick={() => setControlsOpen(false)}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="icon"
            className="absolute right-4 top-4 z-30 h-9 w-9 rounded-full border-line bg-surface/80 opacity-60 shadow-md backdrop-blur transition-opacity hover:opacity-100"
            title="展开控制条"
            onClick={() => setControlsOpen(true)}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        ))}

      {/* 发布成功浮层（W2-4）：只在刚从编辑器发布过来的那一次出现 */}
      <PublishSuccessDialog
        artifact={artifact}
        open={publishedOpen}
        onOpenChange={setPublishedOpen}
      />

      {/* 分享 Dialog（仅作者入口） */}
      <ShareDialog
        artifact={artifact}
        isAuthor={isAuthor}
        open={shareOpen}
        onOpenChange={setShareOpen}
        onArtifactChange={(patch) =>
          setArtifact((prev) => (prev ? { ...prev, ...patch } : prev))
        }
      />

      {/* 版本历史 Dialog（契约 §3.7，仅作者） */}
      <Dialog
        open={historyOpen}
        onOpenChange={(open) => {
          setHistoryOpen(open);
          if (!open) {
            setRestoreNotice('');
            setVersionsError('');
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif">版本历史</DialogTitle>
            <DialogDescription>
              每次保存内容都会自动快照（最多保留 20 版）。恢复不会丢内容——当前内容会先存为新版本。
            </DialogDescription>
          </DialogHeader>
          {restoreNotice && (
            <p className="rounded-md bg-accent-soft px-3 py-2 text-sm text-ink">{restoreNotice}</p>
          )}
          {versionsError && <p className="text-sm text-destructive">{versionsError}</p>}
          {versionsLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-ink-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-accent" />
              正在加载版本历史…
            </div>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {versions.map((v, idx) => (
                <div
                  key={v.id}
                  className="flex items-center gap-3 rounded-lg border border-line bg-bg px-3 py-2"
                >
                  <Badge
                    variant="outline"
                    className="shrink-0 border-line font-mono text-xs text-ink-muted"
                  >
                    v{v.version}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{v.title}</p>
                    <p className="text-xs text-ink-muted">{formatRelativeTime(v.createdAt)}</p>
                  </div>
                  {idx === 0 ? (
                    <span className="shrink-0 text-xs text-ink-muted">当前版本</span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 rounded-full border-line"
                      disabled={restoring}
                      onClick={() => setRestoreTarget(v)}
                    >
                      恢复
                    </Button>
                  )}
                </div>
              ))}
              {versions.length === 0 && !versionsError && (
                <p className="py-6 text-center text-sm text-ink-muted">暂无版本记录</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 恢复二次确认 */}
      <AlertDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open && !restoring) setRestoreTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">
              恢复到 v{restoreTarget?.version}？
            </AlertDialogTitle>
            <AlertDialogDescription>
              当前内容会先存为新版本，可再恢复回来。恢复会照常经过内容审核。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full border-line" disabled={restoring}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full"
              disabled={restoring}
              onClick={(e) => {
                e.preventDefault();
                confirmRestore();
              }}
            >
              {restoring && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认恢复
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
