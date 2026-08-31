/**
 * 全站配置（契约第 5 节：配置集中在 src/app/config.ts）
 */

/** 产品名（wordmark 衬线体） */
export const PRODUCT_NAME = 'Artifacts';

/** 副标语 */
export const PRODUCT_TAGLINE = '把 AI 生成的页面，变成可分享的作品';

/** API 前缀：开发经 vite proxy，生产经 OpenResty 同域反代 */
export const API_BASE = '/api';

/**
 * 分享链接域名（契约 §3.2；OS-3 参数化）：VITE_SITE_ORIGIN → 部署所在 origin。
 * 自托管者换域零配置即正确；本站生产构建经 .env.production 注入正式域名。
 */
export const SITE_ORIGIN =
  import.meta.env.VITE_SITE_ORIGIN || window.location.origin;

/** 子域后缀（契约 §3.9/§3.10 展示用；OS-3 参数化，与服务端 SITES_DOMAIN_SUFFIX 对应） */
export const SITES_DOMAIN_SUFFIX =
  import.meta.env.VITE_SITES_DOMAIN_SUFFIX ?? 'artifacts.orienthong.cn';

/** 渲染子域地址（契约第 1 节） */
export const RUNNER_ORIGIN =
  import.meta.env.VITE_RUNNER_ORIGIN || 'http://localhost:5174';

/** 服务条款/隐私政策版本（展示用副本；权威在 server/src/consent.ts） */
export const TERMS_VERSION = '2026-07-22';

/** ICP 备案号（公示用；OS-3：可由 VITE_ICP_NUMBER 覆盖，空 = 非大陆部署，页脚整块隐藏） */
export const ICP_NUMBER = import.meta.env.VITE_ICP_NUMBER ?? '';

/**
 * 运营主体全称（PIPL 第 17 条要求公示个人信息处理者名称）。
 *
 * 必须与 ICP_NUMBER 的备案主体**完全一致**——公示一个错误的法律主体比留空更糟。
 * 改动时必须同步 `server/src/branding.ts`（服务端渲染的子域 404 页用那一份），
 * 两处不一致会让页脚公示与子域页公示互相矛盾。
 * 留空时页脚与 /contact 退化为以备案号作标识（页面不会因此损坏）。
 */
export const OPERATOR_NAME = import.meta.env.VITE_OPERATOR_NAME ?? '';

/** 投诉举报与数据权利请求邮箱（公示用；需配置转发到常用邮箱后生效） */
export const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL ?? '';

/** 公示标识：有主体全称用全称，否则退化为备案号 —— 页脚/联系页/子域 404 共用 */
export const OPERATOR_LABEL = OPERATOR_NAME || `${ICP_NUMBER} 备案主体`;
