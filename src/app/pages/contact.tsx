/**
 * /contact 「联系与举报」：平台主体公示 + 各类请求的统一受理出口（计划 W1-6）
 *
 * 立项理由：PIPL 第 17 条要求公示个人信息处理者名称与联系方式，《网络信息内容生态治理规定》
 * 要求公布投诉举报方式。更实际的是——作品被下架后的申诉、数据权利请求、忘记密码的人工兜底、
 * ZIP 站点的举报兜底，全都需要一个可达渠道；没有它，上述功能只能做半截。
 */
import { Mail } from 'lucide-react';
import {
  PRODUCT_NAME,
  CONTACT_EMAIL,
  OPERATOR_LABEL,
  ICP_NUMBER,
  OPERATOR_NAME,
} from '@/app/config';
import { usePageTitle } from '@/app/lib/use-page-title';

interface Topic {
  title: string;
  body: string;
  /** 邮件主题前缀，帮助站长分流 */
  subject: string;
}

const TOPICS: Topic[] = [
  {
    title: '违法违规内容举报',
    body: '发现涉嫌违法违规、侵权或危害他人的作品。作品页右下角也有直接举报入口，无需登录；两个渠道等效。请附上作品链接与具体问题。',
    subject: '内容举报',
  },
  {
    title: '作品被下架后的申诉',
    body: '若你的作品被判定违规下架而你认为属于误判，请附作品链接与说明。我们会人工复核并回复处理结论。',
    subject: '下架申诉',
  },
  {
    title: '个人信息与数据权利请求',
    body: '查阅、复制、更正你的账号信息，或要求删除。作品代码可在查看页一键完整复制，无需申请即可自行导出。',
    subject: '数据权利',
  },
  {
    title: '注销账号',
    body: '注销后账号下的全部作品、站点、访问链接与 API Token 将被删除且不可恢复。请用注册邮箱发信，我们会先与你确认再执行。',
    subject: '注销账号',
  },
  {
    title: '忘记密码',
    body: '目前暂未开放邮件自助重置，请用注册邮箱发信申请人工重置。',
    subject: '重置密码',
  },
  {
    title: '安全漏洞报告',
    body: '欢迎负责任披露。请勿公开披露未修复的问题，也请勿在验证过程中访问、修改或导出他人数据。我们会尽快确认并致谢。',
    subject: '安全漏洞',
  },
  {
    title: 'ZIP 站点开通申请',
    body: 'ZIP 静态站点托管目前为 beta，按需开通。请说明用途与大致规模（文件数 / 体积）。',
    subject: 'ZIP 站点申请',
  },
  {
    title: '去角标与商务咨询',
    body: '希望移除作品页右下角的平台角标，或有其它合作与定制需求，欢迎来信说明场景。',
    subject: '去角标咨询',
  },
];

export default function ContactPage() {
  usePageTitle('联系与举报');
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <div className="flex items-center gap-3">
        <Mail className="h-8 w-8 text-accent" />
        <h1 className="font-serif text-3xl font-bold text-ink">联系与举报</h1>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        以下所有事项都通过同一个邮箱受理。为便于分流，请在邮件主题里带上对应的类别名。
      </p>

      {/* 主体公示 */}
      <section className="mt-6 rounded-card border border-line bg-surface p-5">
        <h2 className="font-serif text-lg font-semibold text-ink">平台信息</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-muted">产品名称</dt>
            <dd className="text-ink">{PRODUCT_NAME}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-muted">运营主体</dt>
            <dd className="text-ink">{OPERATOR_LABEL}</dd>
          </div>
          {ICP_NUMBER && (
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-ink-muted">ICP 备案</dt>
              <dd>
                <a
                  href="https://beian.miit.gov.cn/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink underline decoration-line hover:decoration-ink"
                >
                  {ICP_NUMBER}
                </a>
              </dd>
            </div>
          )}
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-muted">联系邮箱</dt>
            <dd>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-accent underline decoration-accent/40 hover:decoration-accent"
              >
                {CONTACT_EMAIL}
              </a>
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          受理时限：我们会在收到邮件后 <strong className="font-medium text-ink">7 个工作日</strong>
          内回复。涉及违法违规内容的举报优先处理，核实后会尽快下架。
        </p>
      </section>

      {/* 隐私提示：举报是匿名可写的自由文本，必须提前劝阻填写敏感信息 */}
      <div className="mt-4 rounded-card border border-line bg-bg p-4 text-xs leading-relaxed text-ink-muted">
        <strong className="font-medium text-ink">请勿在来信中填写不必要的个人信息。</strong>
        为处理你的请求，我们只需要问题描述、相关链接，以及一个可回复的邮箱地址。请不要提供身份证号、
        银行卡号、密码，也不要在内容举报中附上与举报无关的第三方联系方式。
      </div>

      <div className="mt-8 space-y-4">
        {TOPICS.map((t) => (
          <section key={t.title} className="rounded-card border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-serif text-lg font-semibold text-ink">{t.title}</h2>
              <a
                href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`[${t.subject}] `)}`}
                className="text-xs text-accent hover:underline"
              >
                写邮件 →
              </a>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{t.body}</p>
          </section>
        ))}
      </div>

      {/* 主体全称未配置时的自检提示：仅开发环境可见，避免线上长期缺公示而无人察觉 */}
      {import.meta.env.DEV && !OPERATOR_NAME && (
        <p className="mt-8 rounded-card border border-dashed border-accent/50 p-4 text-xs text-ink-muted">
          开发提示：<code>OPERATOR_NAME</code> 尚未在 <code>src/app/config.ts</code> 中填写，
          当前以备案号作为主体标识。请填入与 {ICP_NUMBER} 完全一致的主体全称。
        </p>
      )}
    </div>
  );
}
