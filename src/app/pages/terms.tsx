/**
 * /terms 服务条款（版本与 TERMS_VERSION 一致；修订时同步 server/src/consent.ts）
 */
import { PRODUCT_NAME, TERMS_VERSION, CONTACT_EMAIL, OPERATOR_LABEL, SITE_ORIGIN } from '@/app/config';

/** 展示用主机名（OS-3）：从分享域名派生，自托管换域即随之更新 */
const SITE_HOST = SITE_ORIGIN.replace(/^https?:\/\//, '');

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: '1. 服务说明',
    body: [
      `${PRODUCT_NAME}（${SITE_HOST}）为用户提供 AI 生成的单文件 React 组件 / HTML 页面的托管、渲染与分享服务。用户粘贴或上传代码后获得可分享链接。`,
    ],
  },
  {
    title: '2. 账号',
    body: [
      '注册需提供邮箱与用户名；你有义务妥善保管账号密码。账号仅限本人使用，不得转让、出售。',
      '本服务不面向 14 岁以下儿童。若你未满 14 周岁，请在监护人同意并指导下使用。',
      `注销账号：请用注册邮箱发信至 ${CONTACT_EMAIL}（见「联系与举报」页）。注销后账号下的全部作品、站点、访问链接与 API Token 将被删除且不可恢复。`,
    ],
  },
  {
    title: '3. 用户内容与授权',
    body: [
      '你上传的代码及其渲染结果归你所有。你授权平台为提供服务之目的存储、展示、分发该内容（含公开作品在广场展示）。',
      '你保证上传内容不侵犯他人知识产权、名誉权、隐私权等合法权益。',
    ],
  },
  {
    title: '4. 禁止行为',
    body: [
      '不得上传含违法违规信息的内容，包括但不限于：危害国家安全、色情低俗、赌博诈骗、恶意脚本（挖矿、钓鱼、窃取信息）、侵权内容。',
      '不得利用平台从事任何违反中华人民共和国法律法规的活动。',
    ],
  },
  {
    title: '5. 内容审核与处置',
    body: [
      '平台对内容执行发布前扫描与机器审核；作品文本与 ZIP 站点内文本文件会以委托处理方式提交至阿里云内容安全服务进行审核（详见隐私政策第 3 节）。公开作品经机器审核通过后进入广场；机器无法判定时转人工复核，复核通过后进入广场。',
      '对违规内容，平台有权不经通知下架、删除；情节严重的，暂停或终止账号。任何人可通过作品页「举报」提交线索。',
      `若你的作品被误判下架，可通过「联系与举报」页申诉（${CONTACT_EMAIL}），我们会人工复核并回复处理结论。`,
    ],
  },
  {
    title: '6. 生成合成内容标识',
    body: [
      '依据《人工智能生成合成内容标识办法》，你在发布作品时应主动声明该内容是否为人工智能生成或合成。发布页提供「AI 生成声明」开关，默认视为 AI 生成——本平台承载的主要就是 AI 生成的页面。',
      '对声明为生成合成内容的作品，平台会在作品页右下角角标显示「AI 生成」标识；通过作品的自定义子域地址访问时，页面元数据中另附标识信息。角标由平台在你的作品之外渲染，作品代码无法将其移除。',
      '任何人不得恶意删除、篡改、伪造、隐匿上述标识，也不得为他人实施上述行为提供工具或服务。若你的声明与事实不符，由此产生的责任由你承担。',
      'ZIP 站点（自定义子域托管）由静态服务器直接输出你上传的文件，平台不改写站点内的任何文件，因而无法为其自动添加标识。该类内容如属生成合成内容，请你自行在页面内做出标识。',
    ],
  },
  {
    title: '7. 服务变更与免责',
    body: [
      '平台按「现状」提供服务，不对用户代码的正确性、可用性作保证；因不可抗力、监管要求导致的服务中断，平台不承担责任。',
      '平台承诺不设「在线时长」类扣费机制，不因欠费下线作品；你的代码随时可在作品页完整复制导出。',
    ],
  },
  {
    title: '8. 运营主体',
    body: [
      `本服务由 ${OPERATOR_LABEL || '本站运营者'} 运营。联系方式与各类请求的受理范围见「联系与举报」页。`,
    ],
  },
  {
    title: '9. 条款修订',
    body: [
      '条款修订后将更新版本号并在本页公示；重大变更会在你下次登录或发布时提示重新确认。继续使用即视为接受修订后的条款。',
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="font-serif text-3xl font-bold text-ink">服务条款</h1>
      <p className="mt-2 text-sm text-ink-muted">版本：{TERMS_VERSION}</p>
      <div className="mt-8 space-y-6">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="font-serif text-lg font-semibold text-ink">{s.title}</h2>
            {s.body.map((p) => (
              <p key={p} className="mt-2 text-sm leading-relaxed text-ink-muted">{p}</p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
