/**
 * 审核 / 处置状态对作者的可见化（计划 W1-5）
 *
 * 立项理由：`reviewStatus` 此前在整个 src/app 只出现在类型定义里、零渲染。
 * 服务端在机审拿不准（medium）或机审服务不可用时保留 pending 转人工（契约 §3.3，
 * 2026-07-27 起机审通过即 approved），此时若无说明，用户看到「说公开而广场没有」
 * 的结论是「这站是假的」，然后不再回来，也不来问。
 *
 * /terms 已把审核规则写成对外承诺，不能对被处置者隐藏结果。处置、告知、申诉必须成套：
 * 下架提示一并给出申诉出口（/contact）。
 */
import { Link } from 'react-router-dom';
import { Ban, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Artifact } from '@/app/lib/api';

/** 待审说明文案（单一来源，避免各处措辞漂移） */
export const PENDING_TEXT = '内容需人工复核，通过后会自动出现在广场';

/** 已下架说明文案 */
export const TAKEN_DOWN_TEXT = '该作品已被下架，目前仅你与管理员可见';

type StatusArtifact = Pick<Artifact, 'reviewStatus' | 'isTakenDown' | 'visibility'>;

/** 待审是否值得提示：仅 public 待审会造成「说公开但广场没有」的认知落差 */
export function isPendingPublic(a: StatusArtifact): boolean {
  return a.reviewStatus === 'pending' && a.visibility === 'public';
}

/**
 * 列表行内的紧凑徽标（/me）。`title` 承载完整说明，避免行内文字过长。
 */
export function ReviewStatusBadge({ artifact }: { artifact: StatusArtifact }) {
  if (artifact.isTakenDown) {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-accent/40 text-xs text-accent"
        title={TAKEN_DOWN_TEXT}
      >
        <Ban className="h-3 w-3" />
        已下架
      </Badge>
    );
  }
  if (isPendingPublic(artifact)) {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-line text-xs text-ink-muted"
        title={PENDING_TEXT}
      >
        <Clock className="h-3 w-3" />
        审核中
      </Badge>
    );
  }
  return null;
}

/**
 * 查看页顶部横幅（/a/:slug）。下架态附申诉出口——处置必须可申诉。
 * 仅作者/管理员能拉到已下架或待审作品的详情，访客侧本就是 404 或看不到。
 */
export function ReviewStatusBanner({ artifact }: { artifact: StatusArtifact }) {
  const takenDown = artifact.isTakenDown;
  if (!takenDown && !isPendingPublic(artifact)) return null;
  return (
    /*
     * 窄屏下移到控制条底下（能力波次 2 · W2-2）。
     * 作者悬浮控制条是 top-4 z-30、375px 下宽 359px 几乎占满整行，
     * 而本横幅是 top-4 z-20 —— 两者同一层叠上下文、矩形相交，
     * 控制条 bg-surface/90 + backdrop-blur 不透明，把横幅整条盖住，
     * 连「如认为是误判，可申诉」这个链接都吃掉了指针事件：
     * 处置、告知、申诉本该成套，窄屏上等于没做。
     */
    <div className="absolute left-1/2 top-[5.5rem] z-20 w-max max-w-[90vw] -translate-x-1/2 sm:top-4">
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-line bg-accent-soft/95 px-4 py-1.5 text-sm text-ink shadow-md backdrop-blur">
        {takenDown ? (
          <>
            <Ban className="h-4 w-4 shrink-0 text-accent" />
            <span>{TAKEN_DOWN_TEXT}。</span>
            <Link to="/contact" className="underline decoration-accent/50 hover:decoration-accent">
              如认为是误判，可申诉
            </Link>
          </>
        ) : (
          <>
            <Clock className="h-4 w-4 shrink-0 text-accent" />
            <span>{PENDING_TEXT}。你现在就能把链接分享出去。</span>
          </>
        )}
      </div>
    </div>
  );
}
