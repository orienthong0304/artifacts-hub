/**
 * /guides/:slug 使用指南详情页：步骤 + 常见问题 + CTA；未知 slug 显示 404 卡片
 */
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { findGuide } from '@/app/lib/guides-content';
import { usePageTitle } from '@/app/lib/use-page-title';
import { PRODUCT_NAME } from '@/app/config';

export default function GuideDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const guide = findGuide(slug);

  usePageTitle(guide ? `${guide.title} · ${PRODUCT_NAME}` : `指南不存在 · ${PRODUCT_NAME}`);

  // 未知 slug：404 卡片
  if (!guide) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 sm:px-6">
        <div className="rounded-card border border-dashed border-line bg-surface/60 px-6 py-16 text-center">
          <p className="font-serif text-5xl font-bold text-ink">
            4<span className="text-accent">0</span>4
          </p>
          <p className="mt-4 font-serif text-xl text-ink">没有这篇指南</p>
          <p className="mt-2 text-sm text-ink-muted">链接可能拼写有误，或者这篇指南已被移动。</p>
          <Button asChild variant="outline" className="mt-8 rounded-full border-line px-6">
            <Link to="/guides">查看全部指南</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      {/* 返回索引 */}
      <Link
        to="/guides"
        className="inline-flex items-center gap-1 text-sm text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        全部指南
      </Link>

      <h1 className="mt-4 font-serif text-3xl font-bold leading-snug text-ink">{guide.title}</h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-muted sm:text-base">{guide.intro}</p>

      {/* 步骤 */}
      <div className="mt-10 space-y-8">
        {guide.steps.map((step, i) => (
          <section key={step.title} className="flex gap-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent font-serif text-sm font-bold text-accent-ink">
              {i + 1}
            </span>
            <div className="min-w-0">
              <h2 className="font-serif text-lg font-semibold leading-snug text-ink">
                {step.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{step.body}</p>
            </div>
          </section>
        ))}
      </div>

      {/* 常见问题 */}
      <div className="mt-12">
        <h2 className="font-serif text-xl font-bold text-ink">常见问题</h2>
        <div className="mt-4 space-y-4">
          {guide.faq.map((item) => (
            <section key={item.q} className="rounded-card border border-line bg-surface p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-ink">{item.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{item.a}</p>
            </section>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="mt-12 rounded-card border border-line bg-surface px-6 py-10 text-center">
        <p className="font-serif text-xl font-bold text-ink">现在就把你的作品发出去</p>
        <p className="mt-2 text-sm text-ink-muted">免费托管，不因欠费下线；代码随时可导出。</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button asChild className="rounded-full px-6">
            <Link to="/new">
              <Sparkles className="mr-2 h-4 w-4" />
              免费开始创作
            </Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full border-line px-6">
            <Link to="/">查看广场示例</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
