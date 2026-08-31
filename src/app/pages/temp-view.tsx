/**
 * /t/:token 临时链接查看页（契约 §3.6，纯净形态）：
 * 全视口 RunnerFrame 渲染（badge 开，右下「用 Artifacts 制作」在 iframe 内），零平台 UI；
 * 过期 / 撤销 / 不存在 → 无壳页面居中错误卡片 + 回首页按钮
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import RunnerFrame from '@/app/components/runner-frame';
import ReportDialog from '@/app/components/report-dialog';
import { ApiError, tempLinkApi, type Artifact } from '@/app/lib/api';

/** 错误卡片文案：区分「链接失效」与「限流/网络异常」 */
interface FailureInfo {
  title: string;
  hint: string;
}

export default function TempViewPage() {
  const { token = '' } = useParams();

  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<FailureInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailure(null);
    setArtifact(null);
    tempLinkApi
      .resolve(token)
      .then(({ artifact }) => {
        if (cancelled) return;
        setArtifact(artifact);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // 404 = 过期 / 撤销 / 不存在 / 已下架；429（限流）与网络失败 → 提示稍后重试，不误导为「链接失效」
        if (e instanceof ApiError && e.status === 404) {
          setFailure({
            title: '链接已过期或不存在',
            hint: '临时链接到期即失效，也可能已被作者撤销。如需继续查看，请联系作者重新获取。',
          });
        } else {
          setFailure({
            title: '访问过于频繁或网络异常，请稍后重试',
            hint: '请稍候片刻再刷新页面；若多次失败，可能是网络问题或访问过于频繁。',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-bg text-ink-muted">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-accent" />
        正在加载作品…
      </div>
    );
  }

  if (failure || !artifact) {
    const info: FailureInfo = failure ?? {
      title: '链接已过期或不存在',
      hint: '临时链接到期即失效，也可能已被作者撤销。如需继续查看，请联系作者重新获取。',
    };
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-bg px-4">
        <div className="max-w-lg text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
            <Timer className="h-5 w-5 text-accent" />
          </div>
          <p className="mt-4 font-serif text-2xl text-ink">{info.title}</p>
          <p className="mt-3 text-sm text-ink-muted">{info.hint}</p>
          <Button asChild className="mt-8 rounded-full">
            <Link to="/">回到首页</Link>
          </Button>
        </div>
      </div>
    );
  }

  // 纯净渲染：全视口 + 角标（iframe 内），无任何平台 UI
  return (
    <div className="h-[100dvh] bg-bg">
      <RunnerFrame
        kind={artifact.type}
        code={artifact.code || ''}
        badge
        aiLabel={artifact.aiGenerated}
        className="h-full"
      />
      {/* 举报入口（合规必需）：右下角标上方极小灰字，临时链接接口返回完整 artifact 含 id */}
      <ReportDialog artifactId={artifact.id} />
    </div>
  );
}
