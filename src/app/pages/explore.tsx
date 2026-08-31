/**
 * / 广场：公开作品卡片流 + 搜索（顶部导航防抖驱动）+ 类型筛选 + 最新/最热排序 + 加载更多
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import ArtifactCard from '@/app/components/artifact-card';
import { artifactApi, type Artifact, type ArtifactType } from '@/app/lib/api';
import { useAuth } from '@/app/lib/auth';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 24;

const TYPE_FILTERS: { label: string; value: ArtifactType | '' }[] = [
  { label: '全部', value: '' },
  { label: 'Code', value: 'react' },
  { label: 'HTML', value: 'html' },
];

type ExploreSort = 'latest' | 'hot';

const SORT_OPTIONS: { label: string; value: ExploreSort }[] = [
  { label: '最新', value: 'latest' },
  { label: '最热', value: 'hot' },
];

/** 三个信任点（对应 /trust 页的安全实践承诺） */
const TRUST_POINTS = [
  '沙箱渲染 · 代码零服务端执行',
  '免费托管 · 不因欠费下线',
  '作品随时导出',
];

export default function ExplorePage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  const typeParam = (searchParams.get('type') || '') as ArtifactType | '';
  // 排序：缺省 latest（url 不带参数），hot 显式写入 url 便于分享
  const sortParam: ExploreSort = searchParams.get('sort') === 'hot' ? 'hot' : 'latest';

  const [items, setItems] = useState<Artifact[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  /** 「加载更多」独立的错误态：与首屏 error 分开，见 loadMore 的 catch 注释 */
  const [moreError, setMoreError] = useState('');
  // 请求序号：首页加载 effect 与 loadMore 共用递增计数器，
  // 响应回来时若序号已被更新的查询覆盖，则丢弃过期响应（防止旧条目污染新列表）
  const requestSeqRef = useRef(0);

  // 搜索词 / 类型 / 排序变化 → 重置并拉取第一页
  useEffect(() => {
    let cancelled = false;
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError('');
    artifactApi
      .explore({
        q: q || undefined,
        type: typeParam || undefined,
        sort: sortParam === 'hot' ? 'hot' : undefined,
        page: 1,
        pageSize: PAGE_SIZE,
      })
      .then((res) => {
        if (cancelled || seq !== requestSeqRef.current) return;
        setItems(res.items);
        setTotal(res.total);
        setPage(1);
      })
      .catch((e: Error) => {
        if (!cancelled && seq === requestSeqRef.current) setError(e.message);
      })
      .finally(() => {
        if (!cancelled && seq === requestSeqRef.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q, typeParam, sortParam]);

  const hasMore = items.length < total;

  const loadMore = async () => {
    const seq = ++requestSeqRef.current;
    setMoreError('');
    setLoadingMore(true);
    try {
      const res = await artifactApi.explore({
        q: q || undefined,
        type: typeParam || undefined,
        sort: sortParam === 'hot' ? 'hot' : undefined,
        page: page + 1,
        pageSize: PAGE_SIZE,
      });
      // 在途时若切换了排序/类型/搜索（effect 或另一次 loadMore 已递增序号），丢弃过期响应
      if (seq !== requestSeqRef.current) return;
      setItems((prev) => [...prev, ...res.items]);
      setTotal(res.total);
      setPage(res.page);
    } catch (e) {
      // 「加载更多」失败**不能**复用首屏的 error（W2-2）：那条横幅渲染在列表上方，
      // 而用户此刻视线在页面底部的按钮上——只看到 spinner 消失、列表没变长，零反馈；
      // 同时页面顶部多出一条「加载失败」，与下方完好的 24 张卡自相矛盾。
      if (seq === requestSeqRef.current) setMoreError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const setType = (value: ArtifactType | '') => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('type', value);
    else next.delete('type');
    setSearchParams(next, { replace: true });
  };

  // 切换排序（url 驱动；上方 effect 依赖 sortParam，自动重置到第 1 页）
  const setSort = (value: ExploreSort) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'hot') next.set('sort', 'hot');
    else next.delete('sort');
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      {/* 衬线大标题区：定位叙事（粘贴 → 链接）+ 信任点 */}
      <section className="py-12 text-center sm:py-16">
        <h1 className="mx-auto max-w-3xl font-serif text-3xl font-bold leading-snug tracking-tight text-ink sm:text-5xl sm:leading-tight">
          粘贴 AI 生成的代码，
          <br />
          几秒变成<span className="text-accent">可分享的链接</span>
        </h1>
        <p className="mx-auto mt-4 max-w-3xl text-base text-ink-muted sm:text-lg">
          {/* 窄屏必须允许折行（W2-2）：这一句 455px 宽，在 375px 上把**整页**
              撑出 96px 横向滚动（html/body 都是 overflow-x: visible，全链路无兜底），
              而这是全站入口页。 */}
          <span className="sm:whitespace-nowrap">
            Claude / ChatGPT / DeepSeek / 豆包 生成的 React 与 HTML
          </span>{' '}
          · <span className="whitespace-nowrap">国内直连</span> ·{' '}
          <span className="whitespace-nowrap">微信可打开</span>
        </p>
        <div className="mt-8 flex items-center justify-center gap-5">
          <Button asChild size="lg" className="rounded-full px-6">
            <Link to={user ? '/new' : '/register'}>
              <Sparkles className="mr-2 h-4 w-4" />
              {user ? '新建作品' : '免费开始创作'}
            </Link>
          </Button>
          <Link
            to="/guides"
            className="text-sm text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
          >
            新手指南 →
          </Link>
          <Link
            to="/trust"
            className="text-sm text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
          >
            为什么可信 →
          </Link>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {TRUST_POINTS.map((point) => (
            <span
              key={point}
              className="rounded-full border border-line bg-surface/60 px-3 py-1 text-xs text-ink-muted"
            >
              {point}
            </span>
          ))}
        </div>
      </section>

      {/* 类型筛选（左）+ 最新/最热排序（右） */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setType(f.value)}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm transition-colors',
              typeParam === f.value
                ? 'border-ink bg-ink text-bg'
                : 'border-line bg-surface text-ink-muted hover:border-ink/40 hover:text-ink',
            )}
          >
            {f.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {q && !loading && (
            <span className="mr-1 text-sm text-ink-muted">
              「{q}」共 {total} 个结果
            </span>
          )}
          {SORT_OPTIONS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setSort(s.value)}
              className={cn(
                'rounded-full border px-4 py-1.5 text-sm transition-colors',
                sortParam === s.value
                  ? 'border-ink bg-ink text-bg'
                  : 'border-line bg-surface text-ink-muted hover:border-ink/40 hover:text-ink',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* 错误态 */}
      {error && (
        <div className="rounded-card border border-line bg-surface p-8 text-center text-sm text-ink-muted">
          加载失败：{error}
        </div>
      )}

      {/* 卡片瀑布流（响应式 grid） */}
      {loading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-card border border-line bg-surface p-5">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="mt-4 h-6 w-3/4" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : !error && items.length === 0 ? (
        /* 空态 */
        <div className="rounded-card border border-dashed border-line bg-surface/60 px-6 py-20 text-center">
          <p className="font-serif text-xl text-ink">
            {q || typeParam ? '没有找到匹配的作品' : '还没有公开作品'}
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            {q || typeParam
              ? '换个关键词或筛选条件试试。'
              : '成为第一个发布作品的人吧。'}
          </p>
          {!q && !typeParam && (
            <Button asChild className="mt-6 rounded-full">
              <Link to={user ? '/new' : '/register'}>去创作</Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((a) => (
              <ArtifactCard key={a.id} artifact={a} />
            ))}
          </div>

          {/* 加载更多：失败提示就地渲染在按钮下方，用户视线正在这里 */}
          {hasMore && (
            <div className="mt-10 text-center">
              <Button
                variant="outline"
                className="rounded-full border-line px-8"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {moreError ? '重试' : '加载更多'}
              </Button>
              {moreError && (
                <p className="mt-2 text-sm text-destructive">加载更多失败：{moreError}</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
