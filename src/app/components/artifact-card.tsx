/**
 * 广场 / 主页通用的作品卡片：确定性卡面 + 类型徽章 + 右上折角 + hover 上浮
 *
 * 能力波次 2 · W2-5：此前整个广场是一片纯文字卡，扫过去分不出哪张是哪张。
 * 本项目已定**不做截图封面**（sandbox 内 origin=null、子 iframe 的 contentDocument 取不到，
 * html2canvas 结构性不可用——见 docs/ops/cover-capture-probe.md），
 * 所以卡面走「slug 派生的确定性渐变 + 首字」：同一个作品永远长同一个样，零请求、零存储。
 */
import { Link } from 'react-router-dom';
import { Code2, Eye, FileCode2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime, formatViews } from '@/app/lib/format';
import type { Artifact } from '@/app/lib/api';

interface ArtifactCardProps {
  artifact: Artifact;
  /** 是否显示作者行（用户主页可关闭） */
  showAuthor?: boolean;
  className?: string;
}

/**
 * 卡面配色：全部落在 Claude 暖色板内（珊瑚橙 / 暖沙 / 陶土 / 苔绿 / 雾蓝 / 梅），
 * 明度压得比正文低，保证叠在上面的首字与徽章始终可读。
 */
const COVER_PALETTE = [
  ['#F3D9CC', '#E4B39B'], // 珊瑚
  ['#EFE3CE', '#D9C39A'], // 暖沙
  ['#E8D5C8', '#C9A48C'], // 陶土
  ['#DDE3D5', '#B4C2A3'], // 苔绿
  ['#D8E0E6', '#A9BCC9'], // 雾蓝
  ['#E5DAE4', '#BFA6BE'], // 梅
  ['#EEDFD3', '#CDA98C'], // 奶咖
  ['#DCE1DE', '#AEB9B3'], // 灰绿
];

/** FNV-1a：稳定、无依赖、跨端一致——同一 slug 在任何设备上都是同一张卡面 */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 首字：中文取第一个字，英文取首字母大写；空标题退回类型首字母 */
function coverGlyph(title: string, type: Artifact['type']): string {
  const ch = title.trim()[0];
  if (!ch) return type === 'react' ? 'R' : 'H';
  return /[a-z]/.test(ch) ? ch.toUpperCase() : ch;
}

export function ArtifactCover({
  artifact,
  className,
}: {
  artifact: Artifact;
  className?: string;
}) {
  const h = hashString(artifact.slug);
  const [from, to] = COVER_PALETTE[h % COVER_PALETTE.length];
  // 角度也参与派生，同色系的两张卡也不会完全重样
  const angle = 100 + ((h >> 8) % 9) * 10;

  return (
    <div
      aria-hidden
      className={cn('relative overflow-hidden rounded-lg', className)}
      style={{ background: `linear-gradient(${angle}deg, ${from}, ${to})` }}
    >
      <span className="absolute -bottom-3 right-2 select-none font-serif text-[5rem] leading-none text-white/45">
        {coverGlyph(artifact.title, artifact.type)}
      </span>
    </div>
  );
}

export function TypeBadge({ type, className }: { type: Artifact['type']; className?: string }) {
  const isReact = type === 'react';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        isReact
          ? 'border-accent/30 bg-accent-soft text-ink'
          : 'border-line bg-bg text-ink-muted',
        className,
      )}
    >
      {isReact ? <Code2 className="h-3 w-3 text-accent" /> : <FileCode2 className="h-3 w-3" />}
      {isReact ? 'Code' : 'HTML'}
    </span>
  );
}

export default function ArtifactCard({ artifact, showAuthor = true, className }: ArtifactCardProps) {
  const authorName = artifact.author?.displayName || artifact.author?.username || '匿名';
  const authorHref = artifact.author?.username ? `/u/${artifact.author.username}` : null;

  /**
   * 卡片外层刻意**不是** Link：作者名要能单独点进个人主页，而 <a> 里套 <a> 是非法结构。
   * 改用「标题链接 + ::after 铺满整卡」的覆盖式热区，作者链接抬到 z-10 盖在它上面。
   */
  return (
    <article
      className={cn(
        'card-fold group relative flex flex-col gap-3 rounded-card border border-line bg-surface p-5',
        'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(26,25,21,0.08)]',
        className,
      )}
    >
      <ArtifactCover artifact={artifact} className="-mx-1 h-24" />

      <div>
        <TypeBadge type={artifact.type} />
      </div>

      <h3 className="line-clamp-2 font-serif text-lg font-semibold leading-snug text-ink group-hover:text-accent">
        <Link
          to={`/a/${artifact.slug}`}
          className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {artifact.title}
        </Link>
      </h3>

      {artifact.description ? (
        <p className="line-clamp-2 text-sm leading-relaxed text-ink-muted">
          {artifact.description}
        </p>
      ) : (
        <p className="text-sm italic text-ink-muted/60">暂无描述</p>
      )}

      <div className="mt-auto flex items-center justify-between border-t border-line pt-3 text-xs text-ink-muted">
        {showAuthor ? (
          authorHref ? (
            <Link
              to={authorHref}
              className="relative z-10 truncate underline-offset-4 hover:text-ink hover:underline"
            >
              {authorName}
            </Link>
          ) : (
            <span className="truncate">{authorName}</span>
          )
        ) : (
          <span>{formatRelativeTime(artifact.createdAt)}</span>
        )}
        <span className="flex shrink-0 items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <Eye className="h-3.5 w-3.5" />
            {formatViews(artifact.views)}
          </span>
          {showAuthor && <span>{formatRelativeTime(artifact.createdAt)}</span>}
        </span>
      </div>
    </article>
  );
}
