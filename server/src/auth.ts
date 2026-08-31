// JWT 签发/校验 + 鉴权中间件 + cookie 处理（契约文档第 3 节；Bearer API Token 见 §3.8）
import { createHash } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { SignJWT, jwtVerify } from 'jose';
import { env } from './env.js';
import { pool, type UserRow } from './db.js';
import { API_TOKEN_PREFIX } from './slug.js';

/**
 * cookie 命名（契约 §3）：生产用 __Host- 前缀（浏览器强制 Secure + Path=/ + 无 Domain，
 * 杜绝 run 子域等同 eTLD 站点 cookie tossing）；开发环境 http 无法满足前缀要求，保持旧名。
 */
export function cookieNameFor(isProd: boolean): string {
  return isProd ? '__Host-artifacts_token' : 'artifacts_token';
}
export const COOKIE_NAME = cookieNameFor(env.isProd);

/**
 * 子域私密查看会话的 cookie 名（契约 §3.10）。生产用 `__Host-` 前缀——浏览器强制
 * Secure + Path=/ + **无 Domain**，这正是该 cookie 需要的语义：它只应对签发它的那一个
 * 子域生效。无前缀时，同 eTLD 的其它用户子域可写平级域同名 cookie 冒充他人私密会话。
 * 开发环境 http 无法满足前缀要求，保持旧名。
 */
export function subSessionCookieNameFor(isProd: boolean): string {
  return isProd ? '__Host-sub_session' : 'sub_session';
}
/**
 * 旧 cookie 名：**仅用于登出清除**（至 2026-09 后可删）。
 * 兼容读取已于 2026-07-26 移除——见 attachUser 注释：子域可写平级域同名 cookie，
 * 兜底读旧名等于给同 eTLD 的用户内容开了一条会话固定通道。
 */
export const LEGACY_COOKIE_NAME = 'artifacts_token';
/** 有效期 30 天（秒） */
export const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

/** 签发 JWT：payload 仅含用户 id（sub），HS256，30 天过期 */
export async function signToken(userId: string, secret: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS)
    .sign(encoder.encode(secret));
}

/** 校验 JWT：成功返回用户 id，失败（过期/被篡改/密钥不符）返回 null */
export async function verifyToken(token: string, secret: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), {
      algorithms: ['HS256'],
    });
    // 登录 token 不带 typ；带 typ 的（如 artifact-access）不能当登录态使用
    if (payload.typ !== undefined) return null;
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

/** 作品访问令牌有效期 24 小时（秒），契约 §3.1 */
export const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/** 访问令牌的 typ claim 值 */
const ACCESS_TOKEN_TYP = 'artifact-access';

/** 签发作品访问令牌：claim { sub: artifactId, typ: 'artifact-access' }，24h，同一 JWT_SECRET */
export async function signArtifactAccessToken(
  artifactId: string,
  secret: string
): Promise<string> {
  return new SignJWT({ typ: ACCESS_TOKEN_TYP })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(artifactId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS)
    .sign(encoder.encode(secret));
}

/**
 * 校验作品访问令牌：typ 必须为 artifact-access，成功返回 artifactId，失败返回 null。
 * 登录 token（无 typ）在此校验必然失败，两类令牌不可互换。
 */
export async function verifyArtifactAccessToken(
  token: string,
  secret: string
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), {
      algorithms: ['HS256'],
    });
    if (payload.typ !== ACCESS_TOKEN_TYP) return null;
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

/** 子域换票 code 有效期（契约 §3.10）：60 秒，无服务端状态 */
export const SUBAUTH_CODE_TTL_SECONDS = 60;
/** 子域局部会话有效期：24 小时 */
export const SUB_SESSION_TTL_SECONDS = 24 * 60 * 60;
const SUBAUTH_CODE_TYP = 'subauth-code';
const SUB_SESSION_TYP = 'sub-session';

/** 签发换票 code：绑定用户/前缀/路径，仅能兑换该前缀的查看会话 */
export async function signSubauthCode(
  userId: string,
  prefix: string,
  path: string,
  secret: string
): Promise<string> {
  return new SignJWT({ typ: SUBAUTH_CODE_TYP, pfx: prefix, pth: path })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SUBAUTH_CODE_TTL_SECONDS)
    .sign(encoder.encode(secret));
}

export async function verifySubauthCode(
  token: string,
  secret: string
): Promise<{ userId: string; prefix: string; path: string } | null> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), { algorithms: ['HS256'] });
    if (payload.typ !== SUBAUTH_CODE_TYP) return null;
    if (typeof payload.sub !== 'string' || typeof payload.pfx !== 'string') return null;
    return { userId: payload.sub, prefix: payload.pfx, path: String(payload.pth ?? '') };
  } catch {
    return null;
  }
}

/** 签发子域局部会话：只证明「前缀主人」身份，不携带主站任何权限 */
export async function signSubSession(
  userId: string,
  prefix: string,
  secret: string
): Promise<string> {
  return new SignJWT({ typ: SUB_SESSION_TYP, pfx: prefix })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SUB_SESSION_TTL_SECONDS)
    .sign(encoder.encode(secret));
}

export async function verifySubSession(
  token: string,
  secret: string
): Promise<{ userId: string; prefix: string } | null> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), { algorithms: ['HS256'] });
    if (payload.typ !== SUB_SESSION_TYP) return null;
    if (typeof payload.sub !== 'string' || typeof payload.pfx !== 'string') return null;
    return { userId: payload.sub, prefix: payload.pfx };
  } catch {
    return null;
  }
}

let cachedSecret: string | null = null;

/** 解析 JWT 密钥：生产必须显式配置，开发缺省时用固定值并警告 */
export function resolveJwtSecret(): string {
  if (cachedSecret) return cachedSecret;
  if (env.JWT_SECRET) {
    cachedSecret = env.JWT_SECRET;
  } else if (env.isProd) {
    throw new Error('生产环境必须设置 JWT_SECRET 环境变量');
  } else {
    console.warn('[auth] 未设置 JWT_SECRET，使用开发用默认密钥（仅限本地开发）');
    cachedSecret = 'dev-only-insecure-secret';
  }
  return cachedSecret;
}

/** 写入登录 cookie（不设 Domain 属性，host-only，不下发给 run 子域） */
export function setAuthCookie(c: Context, token: string): void {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: env.isProd,
    path: '/',
    maxAge: TOKEN_TTL_SECONDS,
  });
}

/** 清除登录 cookie（含过渡期旧名）；__Host- 前缀的删除头也必须带 Secure，否则浏览器拒绝 */
export function clearAuthCookie(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: '/', secure: env.isProd });
  if (COOKIE_NAME !== LEGACY_COOKIE_NAME) {
    deleteCookie(c, LEGACY_COOKIE_NAME, { path: '/', secure: env.isProd });
  }
}

/** Hono context 变量类型：当前登录用户（未登录为 null）+ 鉴权来源（契约 §3.8） */
export type AuthVariables = {
  user: UserRow | null;
  /** 鉴权来源：'bearer' = API Token 命中；其余（含未登录）为 'cookie' */
  authVia: 'cookie' | 'bearer';
};

/** sha256 十六进制哈希（API Token 为高熵随机串，无需慢哈希，契约 §3.8） */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * 可选鉴权中间件（契约 §3 / §3.8）：先查 `Authorization: Bearer ak_...`——
 * sha256 命中未撤销的 api_tokens → 挂对应用户 + 更新 last_used_at + authVia='bearer'；
 * 无 Bearer 或无效再走 cookie。token 缺失/无效/用户已删除时不报错，user 置 null。
 */
export const attachUser: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  c.set('user', null);
  c.set('authVia', 'cookie');

  // Bearer API Token（契约 §3.8）：scheme 大小写不敏感（RFC 7235：auth-scheme 不区分大小写）；
  // 仅识别 ak_ 前缀的 token，避免误吞其它 Bearer 形态；token 部分原样保留
  const authHeader = c.req.header('authorization');
  const bearerMatch = authHeader?.match(/^bearer\s+(.*)$/i);
  if (bearerMatch && bearerMatch[1].startsWith(API_TOKEN_PREFIX)) {
    const plaintext = bearerMatch[1].trim();
    const result = await pool.query<UserRow & { api_token_id: string }>(
      `select u.*, t.id as api_token_id
       from api_tokens t
       join users u on u.id = t.user_id
       where t.token_hash = $1 and t.revoked_at is null`,
      [sha256Hex(plaintext)]
    );
    if (result.rows[0]) {
      const { api_token_id, ...user } = result.rows[0];
      c.set('user', user as UserRow);
      c.set('authVia', 'bearer');
      // 使用可见性：每次命中直接更新（流量小，无需节流）
      try {
        await pool.query('update api_tokens set last_used_at = now() where id = $1', [
          api_token_id,
        ]);
      } catch (err) {
        // 增值信息写入失败不阻断请求（fail-soft，与日计数/快照同语义）
        console.error('[auth] last_used_at 更新失败:', err);
      }
      await next();
      return;
    }
  }

  // 只读当前环境的 cookie 名。2026-07-26 移除对无前缀旧名的兼容读取：
  // 用户 ZIP 站点与前缀子域的 JS 跑在 <sub>.artifacts.orienthong.cn 真实顶层源上（§3.9/§3.10），
  // 可写 Domain=artifacts.orienthong.cn 的 `artifacts_token`；主站若仍兜底读旧名，
  // 未登录访客访问主站即被静默登入攻击者账号（会话固定）。clearAuthCookie 仍清旧名至 2026-09。
  const token = getCookie(c, COOKIE_NAME);
  if (token) {
    const userId = await verifyToken(token, resolveJwtSecret());
    if (userId) {
      const result = await pool.query<UserRow>('select * from users where id = $1', [userId]);
      if (result.rows[0]) {
        c.set('user', result.rows[0]);
      }
    }
  }
  await next();
};

/** 必须登录：未登录返回 401 */
export const requireAuth: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  if (!c.get('user')) {
    return c.json({ error: '未登录，请先登录' }, 401);
  }
  await next();
};

/**
 * 拒绝 Bearer（契约 §3.8）：API Token 是「发布用」凭证，不得用于不可逆或治理类动作。
 * attachUser 对任一未撤销 token 挂完整 user 身份，故一枚泄露的明文串否则可删作品删站点，
 * 甚至（管理员账号的 token）操纵内容治理决定。需 cookie 认证的端点统一挂此中间件。
 *
 * 工厂形态：各端点可给出更贴合场景的提示文案。
 */
export function denyBearer(
  message = '此操作需在网页登录后进行，API Token 不可用于该端点'
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    if (c.get('authVia') === 'bearer') {
      return c.json({ error: message }, 403);
    }
    await next();
  };
}

/** 必须管理员：未登录 401，非管理员或 Bearer 403（管理员 token 泄露不得等于治理权限） */
export const requireAdmin: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: '未登录，请先登录' }, 401);
  }
  if (!user.is_admin) {
    return c.json({ error: '需要管理员权限' }, 403);
  }
  // Bearer 一律拒绝：管理后台是纯网页面，无 Agent 用例；见 denyBearer 注释
  if (c.get('authVia') === 'bearer') {
    return c.json({ error: '管理操作需在网页登录后进行' }, 403);
  }
  await next();
};
