/**
 * /trust 「为什么可信」：安全实践与承诺（对照 html2.link 缺陷清单反向设计，战略文档 §2）
 */
import { ShieldCheck } from 'lucide-react';
import { PRODUCT_NAME } from '@/app/config';

const PRACTICES: { title: string; body: string }[] = [
  {
    title: '零服务端执行',
    body: '你的代码在平台服务器上只作为文本存取，永远不会被服务端执行。渲染完全发生在访问者自己的浏览器里。',
  },
  {
    title: '双层沙箱隔离（单文件作品）',
    body: '单文件作品在独立子域的 iframe 中渲染，且不授予同源权限（opaque origin）——作品代码没有可用的源，无法读取主站 Cookie、无法冒充平台身份。',
  },
  {
    title: 'ZIP 站点的边界（请注意）',
    body: 'ZIP 静态站点不同于单文件作品：它运行在自己的独立子域上，是一个真实的顶层来源，站内脚本在该子域上下文中执行。站点文件对访问者全部可读，请不要在其中放置任何密钥、令牌或私密数据。',
  },
  {
    title: '登录态防窃取',
    body: '登录凭证保存在 httpOnly Cookie（生产环境使用 __Host- 前缀强化），页面脚本读不到；即使某个作品包含恶意代码，也拿不到你的登录态。',
  },
  {
    title: '访问密码只存哈希',
    body: '作品访问密码以 bcrypt 哈希存储，任何接口都不会返回明文或哈希——平台自己也无法还原你的密码。',
  },
  {
    title: '访问统计的实际范围',
    body: '访问统计只有聚合计数（总量与按日计数），数据表里不存在访客维度的字段。反滥用限流会在内存中短暂使用请求来源 IP，不写入数据库、不用于分析；服务器访问日志当前关闭。平台不接入第三方统计与广告脚本。',
  },
  {
    title: '数据随时可导出',
    body: '作品代码在查看页一键完整复制，没有任何锁定。我们不设「在线时长」类扣费机制，不因欠费下线你的作品。',
  },
  {
    title: '内容有人治理',
    body: '发布前敏感词扫描、阿里云内容安全机器审核（作品文本以委托处理方式提交，详见隐私政策）、新账号作品先审后进广场、全站举报入口 + 管理员处置——让分享环境干净可信。',
  },
];

export default function TrustPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-8 w-8 text-accent" />
        <h1 className="font-serif text-3xl font-bold text-ink">为什么可信</h1>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        {PRODUCT_NAME} 托管的是可执行的网页代码，安全与隐私是设计的起点而不是补丁。以下是我们的做法与承诺。
      </p>
      <div className="mt-8 space-y-5">
        {PRACTICES.map((p) => (
          <section key={p.title} className="rounded-card border border-line bg-surface p-5">
            <h2 className="font-serif text-lg font-semibold text-ink">{p.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{p.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
