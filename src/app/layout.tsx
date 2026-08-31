/**
 * 全站布局：顶部导航 + 页面出口 + 页脚
 */
import { Link, Outlet } from 'react-router-dom';
import SiteHeader from '@/app/components/site-header';
import {
  PRODUCT_NAME,
  PRODUCT_TAGLINE,
  ICP_NUMBER,
  OPERATOR_LABEL,
  CONTACT_EMAIL,
} from '@/app/config';

export default function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <SiteHeader />
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-line py-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-1 px-4 text-center text-xs text-ink-muted sm:px-6">
          <span className="font-serif text-sm text-ink">{PRODUCT_NAME}</span>
          <span>{PRODUCT_TAGLINE}</span>
          <nav className="flex flex-wrap justify-center gap-3">
            <Link to="/guides" className="hover:text-ink">使用指南</Link>
            <Link to="/terms" className="hover:text-ink">服务条款</Link>
            <Link to="/privacy" className="hover:text-ink">隐私政策</Link>
            <Link to="/trust" className="hover:text-ink">为什么可信</Link>
            <Link to="/contact" className="hover:text-ink">联系与举报</Link>
          </nav>
          {/* 主体名称 + 投诉举报方式（PIPL 第 17 条 / 《网络信息内容生态治理规定》） */}
          <span className="mt-1">
            运营主体：{OPERATOR_LABEL}
            <span className="mx-1.5 text-line">·</span>
            投诉举报：
            <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-ink">
              {CONTACT_EMAIL}
            </a>
          </span>
          {/* ICP 备案为中国大陆特有公示（OS-3）：海外自托管留空即不渲染 */}
          {ICP_NUMBER && (
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noreferrer"
              className="text-ink-muted hover:text-ink"
            >
              {ICP_NUMBER}
            </a>
          )}
        </div>
      </footer>
    </div>
  );
}
