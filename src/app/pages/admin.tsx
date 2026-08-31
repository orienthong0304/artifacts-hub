/**
 * /admin 管理后台：待审核作品（审核门，契约 §3.3） + 未处理举报列表 + 下架/恢复
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Check, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { adminApi, type Artifact, type Report } from '@/app/lib/api';
import AdminUsersPanel from '@/app/components/admin-users-panel';
import { formatRelativeTime } from '@/app/lib/format';

export default function AdminPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [pending, setPending] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [{ items }, { items: pendingItems }] = await Promise.all([
        adminApi.reports(),
        adminApi.pending(),
      ]);
      setReports(items);
      setPending(pendingItems);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 审核操作：approve 过审并信任作者；reject 下架
  const review = async (artifact: Artifact, action: 'approve' | 'reject') => {
    setBusyId(artifact.id);
    try {
      await adminApi.review(artifact.id, action);
      setPending((prev) => prev.filter((a) => a.id !== artifact.id));
      if (action === 'reject') {
        // 服务端 reject 已下架并 resolve 该 artifact 的未处理举报，本地同步移除
        setReports((prev) => prev.filter((r) => r.artifact?.id !== artifact.id));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const toggleTakedown = async (report: Report, takenDown: boolean) => {
    if (!report.artifact) return;
    const artifactId = report.artifact.id;
    setBusyId(report.id);
    try {
      await adminApi.takedown(artifactId, takenDown);
      if (takenDown) {
        // 服务端下架已 resolve 该 artifact 的未处理举报，本地移除对应条目
        setReports((prev) => prev.filter((r) => r.artifact?.id !== artifactId));
      } else {
        // 恢复上架：仅更新本地列表中同一 artifact 的下架状态
        setReports((prev) =>
          prev.map((r) =>
            r.artifact && r.artifact.id === artifactId
              ? { ...r, artifact: { ...r.artifact, isTakenDown: takenDown } }
              : r,
          ),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="font-serif text-3xl font-bold text-ink">管理后台</h1>
        <p className="mt-1 text-sm text-ink-muted">作品审核、举报处理与用户管理</p>
      </div>

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
      ) : (
        <>
      <h2 className="mb-3 font-serif text-xl font-semibold text-ink">待审核作品（{pending.length}）</h2>
      {pending.length === 0 ? (
        <p className="mb-8 text-sm text-ink-muted">暂无待审核作品。</p>
      ) : (
        <ul className="mb-8 space-y-3">
          {pending.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-4">
              <div className="min-w-0 flex-1">
                <Link to={`/a/${a.slug}`} className="truncate font-serif text-lg font-semibold text-ink hover:text-accent">
                  {a.title}
                </Link>
                <p className="mt-0.5 text-xs text-ink-muted">
                  作者：{a.author.displayName || a.author.username} · {formatRelativeTime(a.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" className="rounded-full" disabled={busyId === a.id} onClick={() => review(a, 'approve')}>
                  <Check className="mr-1 h-3.5 w-3.5" /> 通过并信任作者
                </Button>
                <Button size="sm" variant="outline" className="rounded-full border-line text-destructive" disabled={busyId === a.id} onClick={() => review(a, 'reject')}>
                  <Ban className="mr-1 h-3.5 w-3.5" /> 下架
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <h2 className="mb-3 font-serif text-xl font-semibold text-ink">未处理举报（{reports.length}）</h2>
      {reports.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-surface/60 px-6 py-20 text-center">
          <p className="font-serif text-xl text-ink">暂无未处理举报</p>
          <p className="mt-2 text-sm text-ink-muted">一切正常。</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => (
            <li
              key={r.id}
              className="rounded-card border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {r.artifact ? (
                      <Link
                        to={`/a/${r.artifact.slug}`}
                        className="truncate font-serif text-lg font-semibold text-ink hover:text-accent"
                      >
                        {r.artifact.title}
                      </Link>
                    ) : (
                      <span className="text-ink-muted">（作品已删除）</span>
                    )}
                    {r.artifact?.isTakenDown && (
                      <Badge variant="outline" className="border-accent/40 text-xs text-accent">
                        已下架
                      </Badge>
                    )}
                  </div>
                  {r.artifact && (
                    <p className="mt-0.5 text-xs text-ink-muted">
                      作者：{r.artifact.author?.displayName || r.artifact.author?.username || '未知'}
                    </p>
                  )}
                  <p className="mt-2 rounded-md bg-bg px-3 py-2 text-sm text-ink">
                    举报原因：{r.reason}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {formatRelativeTime(r.createdAt)}
                  </p>
                </div>

                {r.artifact && (
                  <div className="flex shrink-0 items-center gap-2">
                    {r.artifact.isTakenDown ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full border-line"
                        disabled={busyId === r.id}
                        onClick={() => toggleTakedown(r, false)}
                      >
                        {busyId === r.id ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="mr-1 h-3.5 w-3.5" />
                        )}
                        恢复上架
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full border-line text-destructive"
                        disabled={busyId === r.id}
                        onClick={() => toggleTakedown(r, true)}
                      >
                        {busyId === r.id ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Ban className="mr-1 h-3.5 w-3.5" />
                        )}
                        下架
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
        </>
      )}

      {/* 用户管理（契约 §3.12）：会员档位与配额的手工运营面。
          独立组件自带加载态，与上方审核/举报的加载互不阻塞 */}
      <div className="mt-10 border-t border-line pt-8">
        <AdminUsersPanel />
      </div>
    </div>
  );
}
