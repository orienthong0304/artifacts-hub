/**
 * /me 我的作品管理：列表 + 可见性徽章 + 编辑/删除/改可见性 + 浏览量
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Eye,
  KeyRound,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Plus,
  Share2,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { TypeBadge } from '@/app/components/artifact-card';
import ShareDialog from '@/app/components/share-dialog';
import {
  ReviewStatusBadge,
  isPendingPublic,
  PENDING_TEXT,
  TAKEN_DOWN_TEXT,
} from '@/app/components/review-status';
import { artifactApi, meApi, type Artifact, type Visibility } from '@/app/lib/api';
import { SITES_DOMAIN_SUFFIX } from '@/app/config';
import { useAuth } from '@/app/lib/auth';
import { formatRelativeTime, formatViews } from '@/app/lib/format';
import { cn } from '@/lib/utils';

/** 隐私政策变更告知条的已读标记（按变更日期区分，下次变更换 key 即可再次提示） */
const PRIVACY_NOTICE_KEY = 'artifacts:privacy-notice:2026-07-26';

const VISIBILITY_LABEL: Record<Visibility, string> = {
  public: '公开',
  unlisted: '不公开列出',
  private: '私密',
};

export default function MePage() {
  const { user, refresh } = useAuth();
  const [items, setItems] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** 正在操作（改可见性/删除）的作品 id */
  const [busyId, setBusyId] = useState<string | null>(null);
  /** 分享 Dialog 当前对应的作品 id */
  const [shareId, setShareId] = useState<string | null>(null);
  // 隐私政策变更告知条（计划 W1-7 / 站长决策 3）：披露立刻补齐，但不强制老用户重新点同意
  // （重确认机制目前不存在，为一次文案纠正去建它是本末倒置；债务记在不采纳清单的「后续观察」）
  const [privacyNoticeDismissed, setPrivacyNoticeDismissed] = useState(
    () => localStorage.getItem(PRIVACY_NOTICE_KEY) === '1',
  );
  // 转私密的二次确认目标（计划 W1-5）：唯一「一次点击即让已发出去的链接失效」的操作
  const [privatizeTarget, setPrivatizeTarget] = useState<Artifact | null>(null);
  /** 批量选中的作品 id 集合 */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 批量操作进行中 */
  const [batchBusy, setBatchBusy] = useState(false);
  type SortKey = 'updated' | 'created' | 'views' | 'title';
  const [sort, setSort] = useState<SortKey>('updated');

  // 我的子域（契约 §3.10）：一次领取，不可更改
  const [prefixInput, setPrefixInput] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [subdomainError, setSubdomainError] = useState('');

  const claimSubdomain = async (e: FormEvent) => {
    e.preventDefault();
    const prefix = prefixInput.trim();
    if (!prefix) return;
    setClaiming(true);
    setSubdomainError('');
    try {
      await meApi.claimSubdomain(prefix);
      // 领取成功后刷新全局登录态，卡片切换为已领取展示
      await refresh();
      setPrefixInput('');
    } catch (err) {
      setSubdomainError((err as Error).message);
    } finally {
      setClaiming(false);
    }
  };

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const allSelected = items.length > 0 && selected.size === items.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(items.map((a) => a.id)));

  const batchSetVisibility = async (visibility: Visibility) => {
    const ids = [...selected];
    if (!ids.length) return;
    setBatchBusy(true);
    setError('');
    try {
      // 用服务端真值覆盖，不做乐观更新：pending 作品改 public 时服务端保留 pending
      // （先审后展，契约 §3.3）；乐观更新会显示「公开」而作品实际不在广场
      const { items: updated } = await artifactApi.batchVisibility(ids, visibility);
      const byId = new Map(updated.map((a) => [a.id, a]));
      setItems((prev) => prev.map((a) => byId.get(a.id) ?? a));
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBatchBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    artifactApi
      .listMine()
      .then(({ items }) => {
        if (!cancelled) setItems(items);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyVisibility = async (artifact: Artifact, visibility: Visibility) => {
    setBusyId(artifact.id);
    try {
      const { artifact: updated } = await artifactApi.update(artifact.id, { visibility });
      setItems((prev) => prev.map((a) => (a.id === artifact.id ? { ...a, ...updated } : a)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  /**
   * 改可见性。转为私密需二次确认（计划 W1-5）：这是本页唯一「一次点击即让已发出去的
   * 链接对外失效」的操作，且从下拉里误选极容易——公开与私密在列表中相邻。
   * unlisted 同样需要确认：不公开作品的链接也是直接分享给人的。
   */
  const changeVisibility = async (artifact: Artifact, visibility: Visibility) => {
    if (visibility === artifact.visibility) return;
    if (visibility === 'private') {
      openPrivatizeConfirm(artifact);
      return;
    }
    await applyVisibility(artifact, visibility);
  };

  /**
   * 从 Select 的回调里开 AlertDialog 是 Radix 的已知冲突：Select 与 Dialog 各自通过
   * react-remove-scroll 在 body 上加 `pointer-events: none`，两者开关生命周期交叠时
   * 清理记账会打架 —— 实测结果是弹窗关闭后 body 残留 `pointer-events: none`，
   * **整页点不动**（用户只能刷新页面）。
   *
   * 注意选择器必须限定 `[data-state="open"]`：Radix 在退场动画期间保留已关闭的
   * listbox / dialog 节点，不限定状态会把「已关闭但未卸载」误判成「仍打开」。
   */
  const OPEN_LAYER_SELECTOR =
    '[role="listbox"][data-state="open"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

  /** 等 Select 真正关闭后再挂载弹窗，让弹窗独占这把锁；带上限避免死等 */
  const openPrivatizeConfirm = (artifact: Artifact) => {
    const deadline = Date.now() + 1000;
    const whenSelectClosed = () => {
      if (document.querySelector(OPEN_LAYER_SELECTOR) && Date.now() < deadline) {
        requestAnimationFrame(whenSelectClosed);
        return;
      }
      setPrivatizeTarget(artifact);
    };
    requestAnimationFrame(whenSelectClosed);
  };

  /**
   * 关闭确认框后的兜底：清掉残留锁。轮询几轮而非只查一次——Radix 的清理与退场动画
   * 结束时机不定，单次检查会被它随后的重新应用覆盖。仅在确无 open 层时才清。
   */
  const releaseBodyPointerEvents = () => {
    let tries = 0;
    const attempt = () => {
      if (++tries > 8) return;
      if (!document.querySelector(OPEN_LAYER_SELECTOR)) {
        if (document.body.style.pointerEvents === 'none') {
          document.body.style.removeProperty('pointer-events');
        }
      }
      setTimeout(attempt, 100);
    };
    setTimeout(attempt, 100);
  };

  const shareTarget = items.find((a) => a.id === shareId) || null;

  /**
   * 总览四格（W2-7）。「审核中」与「已下架」是需要用户**采取行动**的两格，
   * 计数非零时标 accent；「公开」只在真正出现在广场时才算（pending 的 public 不在广场）。
   */
  const overview = useMemo(() => {
    const pending = items.filter(isPendingPublic).length;
    const removed = items.filter((a) => a.status !== 'active').length;
    const live = items.filter(
      (a) => a.visibility === 'public' && a.status === 'active' && !isPendingPublic(a),
    ).length;
    return [
      { label: '全部作品', value: items.length, alert: false },
      { label: '广场可见', value: live, alert: false },
      { label: '审核中', value: pending, alert: true },
      { label: '已下架', value: removed, alert: true },
    ];
  }, [items]);

  const sortedItems = useMemo(() => {
    const arr = [...items];
    switch (sort) {
      case 'created':
        return arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      case 'views':
        return arr.sort((a, b) => b.views - a.views);
      case 'title':
        return arr.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
      default:
        return arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
  }, [items, sort]);

  const remove = async (artifact: Artifact) => {
    setBusyId(artifact.id);
    try {
      await artifactApi.remove(artifact.id);
      setItems((prev) => prev.filter((a) => a.id !== artifact.id));
      setSelected((prev) => {
        if (!prev.has(artifact.id)) return prev;
        const next = new Set(prev);
        next.delete(artifact.id);
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="font-serif text-3xl font-bold text-ink">我的作品</h1>
        <Button asChild variant="accent" className="shrink-0 rounded-full">
          <Link to="/new">
            <Plus className="mr-1 h-4 w-4" />
            新建作品
          </Link>
        </Button>
      </div>

      {/* 总览条（能力波次 2 · W2-7）：此前第一屏只有一句「共 N 个作品」，
          「有几个是公开的」「有没有卡在审核里」「被下架了几个」都得自己一行行数。 */}
      {!loading && items.length > 0 && (
        <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {overview.map((s) => (
            <div
              key={s.label}
              className="rounded-card border border-line bg-surface px-4 py-3"
            >
              <dt className="text-xs text-ink-muted">{s.label}</dt>
              <dd
                className={cn(
                  'mt-0.5 font-serif text-2xl font-semibold tabular-nums',
                  s.alert && s.value > 0 ? 'text-accent' : 'text-ink',
                )}
              >
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/* 隐私政策变更告知（计划 W1-7）：补充了第三方机器审核披露与保留期限 */}
      {!privacyNoticeDismissed && (
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-ink-muted">
          <p className="min-w-0 flex-1">
            我们更新了
            <Link to="/privacy" className="mx-1 text-accent hover:underline">
              隐私政策
            </Link>
            ：补充了内容机器审核的受托方披露、各类数据的保留期限，以及 Cookie 与
            ZIP 站点边界的准确说明。数据处理行为本身没有变化。
          </p>
          <button
            type="button"
            className="shrink-0 rounded-full border border-line px-3 py-1 text-ink-muted hover:text-ink"
            onClick={() => {
              localStorage.setItem(PRIVACY_NOTICE_KEY, '1');
              setPrivacyNoticeDismissed(true);
            }}
          >
            知道了
          </button>
        </div>
      )}

      {/* 我的子域（契约 §3.10）：一次领取，不可更改。
          已领取后整卡降级为一行 chip（W2-7）——它是一次性动作，
          此前领完仍占掉首屏约 200px，手机上第一张作品卡都进不了首屏。 */}
      {user?.subdomainPrefix ? (
        <p className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
          我的子域：
          <code className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-ink">
            {user.subdomainPrefix}.{SITES_DOMAIN_SUFFIX}
          </code>
          <span>作品设了自定义路径后即挂在这个域名下</span>
        </p>
      ) : user ? (
        <div className="mb-6 rounded-card border border-line bg-surface p-5">
          <h2 className="font-serif text-lg font-semibold text-ink">我的子域</h2>
          <p className="mt-1 text-sm text-ink-muted">
            领取后，作品可通过 <code className="text-ink">前缀.{SITES_DOMAIN_SUFFIX}/自定义路径</code> 访问（前缀领取后不可更改）。
          </p>
          <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={claimSubdomain}>
            <Input
              value={prefixInput}
              onChange={(e) => {
                setPrefixInput(e.target.value);
                setSubdomainError('');
              }}
              placeholder="3-30 位小写字母/数字/连字符"
              className="w-full bg-bg sm:w-64"
              disabled={claiming}
            />
            <Button type="submit" className="rounded-full" disabled={claiming || !prefixInput.trim()}>
              {claiming && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              领取
            </Button>
            <span className="text-xs text-ink-muted">领取后不可更改，请谨慎填写。</span>
          </form>
          {subdomainError && (
            <p className="mt-2 text-sm text-destructive">{subdomainError}</p>
          )}
        </div>
      ) : null}

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-24 text-ink-muted">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-accent" />
          正在加载…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-surface/60 px-6 py-20 text-center">
          <p className="font-serif text-xl text-ink">还没有作品</p>
          <p className="mt-2 text-sm text-ink-muted">
            粘贴一段 AI 生成的代码，一分钟内发布你的第一个作品。
          </p>
          <Button asChild className="mt-6 rounded-full">
            <Link to="/new">去创作</Link>
          </Button>
        </div>
      ) : (
        <>
          {/* 批量操作工具条 */}
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-full border border-line bg-surface px-4 py-2 text-sm">
            <label className="flex cursor-pointer items-center gap-2 text-ink-muted">
              <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
              全选
            </label>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="h-7 w-32 rounded-full border-line bg-bg text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated">最近更新</SelectItem>
                <SelectItem value="created">最近创建</SelectItem>
                <SelectItem value="views">浏览量</SelectItem>
                <SelectItem value="title">标题</SelectItem>
              </SelectContent>
            </Select>
            {selected.size > 0 ? (
              <>
                <span className="text-ink-muted">已选 {selected.size} 个 · 批量设为</span>
                {(Object.keys(VISIBILITY_LABEL) as Visibility[]).map((v) => (
                  <Button
                    key={v}
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-full border-line text-xs"
                    disabled={batchBusy}
                    onClick={() => batchSetVisibility(v)}
                  >
                    {VISIBILITY_LABEL[v]}
                  </Button>
                ))}
                {batchBusy && <Loader2 className="h-4 w-4 animate-spin text-accent" />}
                <button
                  type="button"
                  className="ml-auto text-xs text-ink-muted hover:text-ink"
                  onClick={() => setSelected(new Set())}
                >
                  取消选择
                </button>
              </>
            ) : (
              <span className="text-xs text-ink-muted">勾选作品可批量调整可见性</span>
            )}
          </div>

          <ul className="space-y-3">
          {sortedItems.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line bg-surface p-4"
            >
              <Checkbox
                checked={selected.has(a.id)}
                onCheckedChange={() => toggleOne(a.id)}
                aria-label={`选择 ${a.title}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <TypeBadge type={a.type} />
                  {a.visibility !== 'public' && (
                    <Badge variant="outline" className="border-line text-xs text-ink-muted">
                      {VISIBILITY_LABEL[a.visibility]}
                    </Badge>
                  )}
                  {a.hasPassword && (
                    <Badge
                      variant="outline"
                      className="gap-1 border-line text-xs text-ink-muted"
                    >
                      <KeyRound className="h-3 w-3" />
                      有密码
                    </Badge>
                  )}
                  {/* 已设自定义路径（W2-7）：此前只有点开分享 Dialog 才知道
                      这个作品到底挂在哪个地址上 */}
                  {a.customPath && (
                    <Badge
                      variant="outline"
                      className="gap-1 border-accent/30 bg-accent-soft text-xs text-ink"
                      title={a.customUrl || a.customPath}
                    >
                      <LinkIcon className="h-3 w-3 text-accent" />
                      /{a.customPath}
                    </Badge>
                  )}
                  {/* 审核中 / 已下架（计划 W1-5）：此前 reviewStatus 零渲染，
                      用户看不到「说公开但广场没有」的原因 */}
                  <ReviewStatusBadge artifact={a} />
                </div>
                {isPendingPublic(a) && (
                  <p className="mt-1 text-xs text-ink-muted">{PENDING_TEXT}</p>
                )}
                {/* 下架的就地说明与申诉出口（W2-2）：此前只有一枚徽标，
                    解释文案挂在 title 属性上——触屏没有 hover，手机上等于没有 */}
                {a.isTakenDown && (
                  <p className="mt-1 text-xs text-ink-muted">
                    {TAKEN_DOWN_TEXT}。
                    <Link to="/contact" className="ml-1 text-accent underline-offset-4 hover:underline">
                      如认为是误判，可申诉
                    </Link>
                  </p>
                )}
                <Link
                  to={`/a/${a.slug}`}
                  className="mt-1.5 block truncate font-serif text-lg font-semibold text-ink hover:text-accent"
                >
                  {a.title}
                </Link>
                <p className="mt-0.5 flex items-center gap-3 text-xs text-ink-muted">
                  <span className="inline-flex items-center gap-1">
                    <Eye className="h-3.5 w-3.5" />
                    {formatViews(a.views)}
                  </span>
                  <span>更新于 {formatRelativeTime(a.updatedAt)}</span>
                </p>
              </div>

              {/* 窄屏让操作组独占一行并允许内部折行（W2-2）：此前 shrink-0 + 内部 flex
                  在 375px 下把 334px 的按钮组塞进 309px 的行里，删除按钮压过卡片边框 */}
              <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
                {/* 改可见性 */}
                <Select
                  value={a.visibility}
                  onValueChange={(v) => changeVisibility(a, v as Visibility)}
                  disabled={busyId === a.id}
                >
                  <SelectTrigger className="h-8 w-32 rounded-full border-line bg-bg text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(VISIBILITY_LABEL) as Visibility[]).map((v) => (
                      <SelectItem key={v} value={v}>
                        {VISIBILITY_LABEL[v]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* 分享 */}
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full border-line"
                  onClick={() => setShareId(a.id)}
                >
                  <Share2 className="mr-1 h-3.5 w-3.5" />
                  分享
                </Button>

                <Button asChild variant="outline" size="sm" className="rounded-full border-line">
                  <Link to={`/edit/${a.id}`}>
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    编辑
                  </Link>
                </Button>

                {/* 删除（二次确认） */}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full text-ink-muted hover:text-destructive"
                      disabled={busyId === a.id}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="font-serif">
                        删除「{a.title}」？
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        删除后无法恢复，作品链接将立即失效。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="rounded-full border-line">
                        取消
                      </AlertDialogCancel>
                      <AlertDialogAction
                        className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => remove(a)}
                      >
                        确认删除
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </li>
          ))}
          </ul>
        </>
      )}

      {/* 转私密二次确认（计划 W1-5）：文案点明后果，而不是泛泛的「确定吗」 */}
      <AlertDialog
        open={!!privatizeTarget}
        onOpenChange={(open) => {
          if (!open) {
            setPrivatizeTarget(null);
            releaseBodyPointerEvents();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">设为私密？</AlertDialogTitle>
            <AlertDialogDescription>
              「{privatizeTarget?.title}」设为私密后，
              <strong className="font-medium text-ink">已分享出去的链接将立即对外失效</strong>
              ，只有你自己能打开；临时分享链接也会同时失效。你可以随时改回来。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full border-line">取消</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full"
              onClick={() => {
                const target = privatizeTarget;
                setPrivatizeTarget(null);
                releaseBodyPointerEvents();
                if (target) void applyVisibility(target, 'private');
              }}
            >
              设为私密
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 分享 Dialog（列表行入口） */}
      {shareTarget && (
        <ShareDialog
          artifact={shareTarget}
          isAuthor
          open
          onOpenChange={(open) => {
            if (!open) setShareId(null);
          }}
          onArtifactChange={(patch) =>
            setItems((prev) =>
              prev.map((a) => (a.id === shareTarget.id ? { ...a, ...patch } : a)),
            )
          }
        />
      )}
    </div>
  );
}
