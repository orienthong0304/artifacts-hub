// 认证路由：注册 / 登录 / 登出 / 当前用户（契约文档第 3 节）
import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { pool, type UserRow } from '../db.js';
import { env } from '../env.js';
import {
  type AuthVariables,
  denyBearer,
  requireAuth,
  resolveJwtSecret,
  setAuthCookie,
  clearAuthCookie,
  signToken,
} from '../auth.js';
import { rateLimit } from '../ratelimit.js';
import { recordConsent } from '../consent.js';
import { registerSchema, loginSchema, userPrefixSchema, zodMessage } from '../validation.js';
import { serializeUser } from '../serialize.js';

const BCRYPT_ROUNDS = 10;

/** 读取 JSON 请求体，非法 JSON 返回 null */
async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/** /api/auth 子路由 */
export const authRouter = new Hono<{ Variables: AuthVariables }>();

// 注册：201 {user} + set-cookie；重复邮箱/用户名 409；限流 10 次/分/IP
authRouter.post('/register', rateLimit('register'), async (c) => {
  const body = await readJson(c);
  if (body === null) return c.json({ error: '请求体不是合法的 JSON' }, 400);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);

  const { email, password, username } = parsed.data;

  // 单用户模式（dual-track roadmap OS-2）：已有用户即关闭注册；
  // 首个注册者自动成为管理员（不依赖 ADMIN_EMAIL——自托管者不该为当管理员多配一个变量）。
  // 并发双首注的窗口由下方 email/username 唯一约束兜底，且单用户实例无真实并发注册场景
  let singleModeFirstUser = false;
  if (env.AUTH_MODE === 'single') {
    const existing = await pool.query('select 1 from users limit 1');
    if (existing.rows.length > 0) {
      return c.json({ error: '本站为单用户实例，不开放注册' }, 403);
    }
    singleModeFirstUser = true;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  // ADMIN_EMAIL 指定邮箱注册的账号自动成为管理员（契约文档第 1 节）；single 模式首个注册者亦是
  const isAdmin =
    singleModeFirstUser ||
    (env.ADMIN_EMAIL !== '' && email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase());

  // user insert + recordConsent 同一事务：任一失败整体回滚，避免有账号无同意记录
  let user: UserRow;
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query<UserRow>(
      `insert into users (email, username, password_hash, is_admin)
       values ($1, $2, $3, $4) returning *`,
      [email, username, passwordHash, isAdmin]
    );
    user = result.rows[0];
    // 记录条款同意（契约 §3.4）：注册即视为同意当前版本条款
    await recordConsent(user.id, 'register', client);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    const pgErr = err as { code?: string; constraint?: string };
    if (pgErr.code === '23505') {
      // 唯一约束冲突：区分邮箱与用户名
      if (pgErr.constraint?.includes('username')) {
        return c.json({ error: '用户名已被使用' }, 409);
      }
      return c.json({ error: '邮箱已被注册' }, 409);
    }
    throw err;
  } finally {
    client.release();
  }

  const token = await signToken(user.id, resolveJwtSecret());
  setAuthCookie(c, token);
  return c.json({ user: serializeUser(user, { includeEmail: true }) }, 201);
});

// 登录：200 {user} + set-cookie；失败 401；限流 10 次/分/IP
authRouter.post('/login', rateLimit('login'), async (c) => {
  const body = await readJson(c);
  if (body === null) return c.json({ error: '请求体不是合法的 JSON' }, 400);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);

  const { email, password } = parsed.data;
  const result = await pool.query<UserRow>('select * from users where email = $1', [email]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return c.json({ error: '邮箱或密码错误' }, 401);
  }

  const token = await signToken(user.id, resolveJwtSecret());
  setAuthCookie(c, token);
  return c.json({ user: serializeUser(user, { includeEmail: true }) });
});

// 登出：清 cookie
authRouter.post('/logout', async (c) => {
  clearAuthCookie(c);
  return c.json({ ok: true });
});

/** /api/me 子路由（挂载在 /api 下） */
export const meRouter = new Hono<{ Variables: AuthVariables }>();

// 当前用户：未登录 401
meRouter.get('/me', requireAuth, async (c) => {
  const user = c.get('user')!;
  return c.json({ user: serializeUser(user, { includeEmail: true, includeQuotas: true }) });
});

// 领取子域前缀（契约 §3.10）：一次性、不可更改；与站点子域共用 subdomain_registry 命名空间
// 一次性且不可更改，拒 Bearer（契约 §3.8）
meRouter.post('/me/subdomain', requireAuth, denyBearer('请在网页登录后操作'), async (c) => {
  const user = c.get('user')!;
  if (user.subdomain_prefix) {
    return c.json({ error: '已领取前缀，前缀不可更改' }, 409);
  }
  const body = (await c.req.json().catch(() => ({}))) as { prefix?: unknown };
  const parsed = userPrefixSchema.safeParse(body.prefix);
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
  const prefix = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      "insert into subdomain_registry (name, kind, ref) values ($1, 'user', $2)",
      [prefix, user.id]
    );
    const updated = await client.query<UserRow>(
      'update users set subdomain_prefix = $1 where id = $2 returning *',
      [prefix, user.id]
    );
    await client.query('commit');
    return c.json({ user: serializeUser(updated.rows[0], { includeEmail: true }) });
  } catch (err) {
    await client.query('rollback');
    if ((err as { code?: string }).code === '23505') {
      return c.json({ error: '该前缀已被使用' }, 409);
    }
    throw err;
  } finally {
    client.release();
  }
});
