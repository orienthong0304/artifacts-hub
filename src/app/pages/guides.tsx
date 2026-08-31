/**
 * /guides 使用指南索引页：标题 + 指南卡片列表（公开，无需登录）
 */
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen } from 'lucide-react';
import { GUIDES } from '@/app/lib/guides-content';
import { usePageTitle } from '@/app/lib/use-page-title';
import { PRODUCT_NAME } from '@/app/config';

export default function GuidesPage() {
  usePageTitle(`使用指南 · ${PRODUCT_NAME}`);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-serif text-3xl font-bold text-ink">使用指南</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted sm:text-base">
        保姆级教程：把 Claude / DeepSeek / 豆包 / ChatGPT 生成的网页代码，变成国内直连、微信可打开的在线链接。零部署经验也能照着做。
      </p>

      <div className="mt-8 space-y-4">
        {GUIDES.map((g) => (
          <Link
            key={g.slug}
            to={`/guides/${g.slug}`}
            className="group block rounded-card border border-line bg-surface p-5 transition-all hover:-translate-y-0.5 hover:border-ink/30 hover:shadow-sm sm:p-6"
          >
            <div className="flex items-start gap-3">
              <BookOpen className="mt-1 h-4 w-4 shrink-0 text-accent" />
              <div className="min-w-0">
                <h2 className="font-serif text-lg font-semibold leading-snug text-ink group-hover:text-accent">
                  {g.title}
                </h2>
                <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-muted">
                  {g.intro}
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm text-accent">
                  阅读教程
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
