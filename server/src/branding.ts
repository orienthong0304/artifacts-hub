/**
 * 服务端侧的品牌与公示常量（计划 W1-6 / W1-8）。
 *
 * 为什么要有这份副本：子域直出的 HTML（shell、404 页）由 API 生成，而前端的
 * `src/app/config.ts` 属于另一个构建产物，服务端无法引用。这里刻意保持极小，
 * 只放「会出现在服务端渲染 HTML 里」的几项。
 *
 * ⚠️ 改动时必须与 `src/app/config.ts` 同步——两处不一致会让页脚公示与子域页公示互相矛盾。
 * 唯一真值以 ICP 备案信息为准。
 */

/** 产品名 */
export const PRODUCT_NAME = 'Artifacts';

/** ICP 备案号 */
export const ICP_NUMBER = process.env.ICP_NUMBER ?? '';

/**
 * 运营主体全称（PIPL 第 17 条要求公示）。
 * 必须与 ICP_NUMBER 的备案主体完全一致，且与 `src/app/config.ts` 的
 * OPERATOR_NAME 保持相同。留空时退化为以备案号作标识（页面不损坏）。
 */
export const OPERATOR_NAME = process.env.OPERATOR_NAME ?? '';

/** 投诉举报与数据权利请求邮箱 */
export const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? '';

/** 公示标识：有主体全称用全称，否则退化为备案号；两者皆空（海外自托管）时为空串，模板侧整块隐藏 */
export const OPERATOR_LABEL = OPERATOR_NAME || (ICP_NUMBER ? `${ICP_NUMBER} 备案主体` : '');
