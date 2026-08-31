// API 层 Origin 校验中间件（契约 §3 安全注记）：拦截同 eTLD 子域会话骑乘（CSRF）。
//
// 背景：用户 ZIP 站点为 <sub>.artifacts.orienthong.cn 真实顶层源，与控制面
// artifacts.orienthong.cn 同 registrable domain。其 JS 可 credentials:'include' 向
// https://artifacts.orienthong.cn/api/* 发 CORS「simple request」（multipart/表单类 POST 无
// 预检），SameSite=Lax + host-only cookie 会被浏览器自动附带 → 副作用发生。__Host- 前缀仅
// 缓解 cookie tossing（写入向），拦不住这种「会话骑乘」（读取现有 cookie 的读取向）。
// 本中间件对 cookie 认证的状态变更请求做 Origin 白名单校验，补上这道缺口。
//
// TODO（终态，战略附录 E）：本中间件与 __Host- 前缀、2026-07-26 移除的旧名兼容读取（见
// auth.ts attachUser）都只是对「控制面与不受信任用户内容共享同一可注册域」这一结构性问题的
// 逐向缓解。终态是把用户内容迁到独立的可注册域（独立 eTLD+1），届时本文件可整体删除。
// 触发条件：ZIP 站点或用户前缀子域出现真实用户量增长，或出现真实的 cookie 旁路利用记录。
// 量级 L，见 docs/superpowers/specs/2026-07-26-wave1-rejected.md「后续观察」末条。
import type { MiddlewareHandler } from 'hono';
import type { AuthVariables } from './auth.js';
import { env } from './env.js';

/** 开发前端源（仅非生产环境加入白名单） */
const DEV_ORIGIN = 'http://localhost:5173';

/**
 * 允许的 Origin 白名单：控制面源（由 SITES_DOMAIN_SUFFIX 派生，自托管换域即随之生效，
 * dual-track roadmap OS-3——此前写死生产域，换域后所有 cookie 写请求会被自己 403）
 * + 非生产追加 localhost:5173 + env EXTRA_ALLOWED_ORIGIN（逗号分隔可多个）。
 * env 在进程内稳定，每次调用重算成本可忽略，换取可测性。
 */
export function allowedOrigins(): Set<string> {
  const set = new Set<string>([`https://${env.SITES_DOMAIN_SUFFIX}`]);
  if (!env.isProd) set.add(DEV_ORIGIN);
  for (const raw of env.EXTRA_ALLOWED_ORIGIN.split(',')) {
    const origin = raw.trim();
    if (origin) set.add(origin);
  }
  return set;
}

/**
 * Origin 校验中间件（挂在 attachUser **之前**：纯请求头判定，不依赖用户状态）。
 * 对 /api/* 的非 GET/HEAD/OPTIONS（状态变更）请求：
 * - 携带 `Authorization: Bearer`（API token 认证，无 cookie 参与，且跨源带自定义头必触发
 *   预检）→ 放行；
 * - 无 `Origin` 头（curl / 服务端调用 / 旧客户端）→ 放行（残余风险接受，契约 §3 注明）；
 * - `Origin` 在白名单 → 放行；否则 403「请求来源不被允许」。
 * 安全方法（GET/HEAD/OPTIONS）不改状态，一律不拦。
 */
export const csrfGuard: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const method = c.req.method.toUpperCase();
  const isSafeMethod = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  if (!isSafeMethod) {
    const auth = c.req.header('authorization');
    const isBearer = !!auth && /^bearer\s+/i.test(auth);
    const origin = c.req.header('origin');
    // 仅拦截：cookie 认证（非 Bearer）+ 携带 Origin 头 + Origin 不在白名单
    if (!isBearer && origin && !allowedOrigins().has(origin)) {
      return c.json({ error: '请求来源不被允许' }, 403);
    }
  }
  await next();
};
