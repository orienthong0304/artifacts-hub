// Artifact 路由：CRUD / 详情 / 解锁 / 广场 / 用户主页 / 举报（契约文档第 3 节、§3.1）
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import bcrypt from 'bcryptjs';
import { pool, type ArtifactWithAuthorRow, type UserRow } from '../db.js';
import {
  type AuthVariables,
  denyBearer,
  requireAuth,
  resolveJwtSecret,
  signArtifactAccessToken,
  verifyArtifactAccessToken,
} from '../auth.js';
import { rateLimit, SlidingWindowRateLimiter } from '../ratelimit.js';
import { effectiveQuota, withinQuota } from '../quota.js';
import {
  createArtifactSchema,
  updateArtifactSchema,
  batchVisibilitySchema,
  unlockSchema,
  reportSchema,
  listQueryTypeSchema,
  exploreSortSchema,
  customPathSchema,
  zodMessage, UUID_PATTERN } from '../validation.js';
import { generateSlug } from '../slug.js';
import { recordConsent } from '../consent.js';
import { recordDailyView } from '../stats.js';
import {
  violatesPolicy,
  cloudModerate,
  cloudModerationEnabled,
  resolveReviewStatus,
  selectModerationFields,
  type CloudVerdict,
} from '../moderation.js';
import {
  serializeArtifact,
  serializeLockedArtifact,
  serializeUser,
} from '../serialize.js';
import { snapshotVersion } from '../versions.js';

/** 访问密码 bcrypt 轮数（与登录密码一致） */
const BCRYPT_ROUNDS = 10;

/**
 * 创建护栏（契约 §3.3/§3.12）：free 档默认 10 个/24h/用户，防批量灌垃圾；
 * 实际上限走 effectiveQuota（member/override 可放开）。内存实现，重启即重置。
 */
const createLimiter = new SlidingWindowRateLimiter(10, 24 * 60 * 60 * 1000);

/** accessPassword（string | null | undefined）→ 待入库哈希（string | null） */
async function hashAccessPassword(accessPassword: string | null | undefined): Promise<string | null> {
  return typeof accessPassword === 'string'
    ? bcrypt.hash(accessPassword, BCRYPT_ROUNDS)
    : null;
}

/** 联查作者的公共 select 片段 */
const ARTIFACT_SELECT = `
  select a.*, u.username as author_username, u.display_name as author_display_name,
         u.subdomain_prefix as author_subdomain_prefix
  from artifacts a
  join users u on u.id = a.user_id
`;

/** 读取 JSON 请求体，非法 JSON 返回 null */
async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/** uuid 形状校验：非 uuid 直接按不存在处理，避免 pg 22P02 抛 500 */

export const artifactsRouter = new Hono<{ Variables: AuthVariables }>();

// 我的全部 artifacts（含 private），?q=&type=，按 updated_at 倒序，不含 code
artifactsRouter.get('/artifacts', requireAuth, async (c) => {
  const user = c.get('user')!;
  const typeParsed = listQueryTypeSchema.safeParse(c.req.query('type') || undefined);
  if (!typeParsed.success) return c.json({ error: '类型必须是 react 或 html' }, 400);
  const q = c.req.query('q')?.trim();

  const conds: string[] = ['a.user_id = $1'];
  const params: unknown[] = [user.id];
  if (q) {
    params.push(`%${q}%`);
    conds.push(`(a.title ilike $${params.length} or a.description ilike $${params.length})`);
  }
  if (typeParsed.data) {
    params.push(typeParsed.data);
    conds.push(`a.type = $${params.length}`);
  }
  const result = await pool.query<ArtifactWithAuthorRow>(
    `${ARTIFACT_SELECT} where ${conds.join(' and ')} order by a.updated_at desc`,
    params
  );
  return c.json({ items: result.rows.map((row) => serializeArtifact(row)) });
});

// 创建：201 {artifact}（生成 slug）
artifactsRouter.post('/artifacts', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await readJson(c);
  if (body === null) return c.json({ error: '请求体不是合法的 JSON' }, 400);
  const parsed = createArtifactSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);

  const { title, description, type, code, visibility, accessPassword, aiGenerated } = parsed.data;
  // 敏感词闸门（契约 §3.3）：命中即拒绝，不回显命中词
  if (violatesPolicy([title, description, code])) {
    return c.json({ error: '内容疑似包含违禁内容，无法保存。如有疑问请联系站长。' }, 400);
  }
  // 发布护栏（契约 §3.3/§3.12）：体验兜底，不作为安全边界。trusted 显式豁免；
  // admin 与 member 经 effectiveQuota 得 0（不限）自然跳过
  const dailyLimit = effectiveQuota(user, 'dailyCreates');
  if (!user.is_trusted && dailyLimit > 0 && !createLimiter.allow(user.id, dailyLimit)) {
    return c.json({ error: `每 24 小时最多创建 ${dailyLimit} 个作品，请稍后再试或联系站长` }, 429);
  }
  // private 作品也允许存哈希（查看逻辑会忽略），与契约 §3.1 一致
  const accessPasswordHash = await hashAccessPassword(accessPassword);

  // 云端机审（契约 §3.3）：high 拒绝；medium/失败 → public 强制 pending 转人工；
  // pass → public 直接 approved（机审通过即上广场）；管理员跳过
  const cloud = user.is_admin ? ('pass' as const) : await cloudModerate([title, description, code]);
  if (cloud === 'reject') {
    return c.json({ error: '内容未通过机器审核，无法保存。如有疑问请联系站长。' }, 400);
  }
  const reviewStatus = resolveReviewStatus({
    visibility,
    isAdmin: user.is_admin,
    isTrusted: user.is_trusted,
    cloud,
  });

  // slug 唯一冲突时重试（8 位 nanoid 碰撞概率极低）
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateSlug();
    try {
      const result = await pool.query(
        `insert into artifacts (user_id, slug, title, description, type, code, visibility, access_password_hash, review_status, ai_generated)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [user.id, slug, title, description ?? null, type, code, visibility, accessPasswordHash, reviewStatus, aiGenerated]
      );
      const detail = await pool.query<ArtifactWithAuthorRow>(
        `${ARTIFACT_SELECT} where a.id = $1`,
        [result.rows[0].id]
      );
      // 记录发布同意（契约 §3.4）：同版本条款下每用户只记一次，幂等。
      // 作品已创建成功，consent 落库失败不应让请求 500——记日志继续
      try {
        await recordConsent(user.id, 'publish');
      } catch (err) {
        console.error('[consent] 发布同意记录失败（作品已创建，不影响响应）:', err);
      }
      // 版本快照 v1（契约 §3.7）：用入库内容；失败仅记日志，不影响创建响应
      const created = detail.rows[0];
      await snapshotVersion(created.id, {
        title: created.title,
        description: created.description,
        code: created.code,
      });
      return c.json({ artifact: serializeArtifact(detail.rows[0], { includeCode: true }) }, 201);
    } catch (err) {
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === '23505' && pgErr.constraint?.includes('slug')) continue;
      throw err;
    }
  }
  return c.json({ error: '生成作品链接失败，请重试' }, 500);
});

// 详情（含 code）：可选鉴权。private 无密码仅作者；taken_down 仅作者/管理员；public 命中时自增 views。
// 设有访问密码时（契约 §3.1，含 private）：仅作者豁免；其他人需 X-Access-Token 有效令牌，否则返回锁定形态（200）
artifactsRouter.get('/artifacts/:slug', async (c) => {
  const slug = c.req.param('slug');
  const user = c.get('user');
  const result = await pool.query<ArtifactWithAuthorRow>(
    `${ARTIFACT_SELECT} where a.slug = $1`,
    [slug]
  );
  const row = result.rows[0];
  if (!row) return c.json({ error: '作品不存在' }, 404);

  const isAuthor = !!user && user.id === row.user_id;
  const isAdmin = !!user && user.is_admin;

  // 已下架：仅作者/管理员可见（响应含 isTakenDown），其他人视同不存在
  if (row.is_taken_down && !isAuthor && !isAdmin) {
    return c.json({ error: '作品不存在' }, 404);
  }
  // private 无密码：仅作者可见（管理员亦不可见，避免越权浏览）。
  // 设有密码的作品（含 private）一律进入下方密码闸门——拿到链接并输入密码即可查看
  if (row.visibility === 'private' && !isAuthor && row.access_password_hash === null) {
    return c.json({ error: '作品不存在' }, 404);
  }

  // 访问密码闸门：仅作者豁免（管理员也需密码，避免越权浏览私密内容）；其他人校验 X-Access-Token
  if (row.access_password_hash !== null && !isAuthor) {
    const accessToken = c.req.header('x-access-token');
    const unlockedId = accessToken
      ? await verifyArtifactAccessToken(accessToken, resolveJwtSecret())
      : null;
    if (unlockedId !== row.id) {
      // 未解锁：返回 200 的锁定形态（无 code / description / views），不计 views
      return c.json({ artifact: serializeLockedArtifact(row) });
    }
    // 令牌有效：按正常详情返回并计入 views（契约 §3.1）
    const updated = await pool.query<{ views: number }>(
      'update artifacts set views = views + 1 where id = $1 returning views',
      [row.id]
    );
    row.views = updated.rows[0].views;
    await recordDailyView(row.id);
    return c.json({ artifact: serializeArtifact(row, { includeCode: true }) });
  }

  // views 自增：仅在 public 且未下架的详情命中时
  if (row.visibility === 'public' && !row.is_taken_down) {
    const updated = await pool.query<{ views: number }>(
      'update artifacts set views = views + 1 where id = $1 returning views',
      [row.id]
    );
    row.views = updated.rows[0].views;
    await recordDailyView(row.id);
  }

  return c.json({ artifact: serializeArtifact(row, { includeCode: true }) });
});

// 解锁（契约 §3.1）：bcrypt 比对访问密码，成功签发 24h 访问令牌；限流 10 次/分/IP
artifactsRouter.post('/artifacts/:slug/unlock', rateLimit('unlock'), async (c) => {
  const slug = c.req.param('slug');
  const body = await readJson(c);
  if (body === null) return c.json({ error: '请求体不是合法的 JSON' }, 400);
  const parsed = unlockSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);

  const result = await pool.query<ArtifactWithAuthorRow>(
    `${ARTIFACT_SELECT} where a.slug = $1`,
    [slug]
  );
  const row = result.rows[0];
  // 不存在 / 已下架：视同不存在
  if (!row || row.is_taken_down) {
    return c.json({ error: '作品不存在' }, 404);
  }
  if (row.access_password_hash === null) {
    // 无密码的 private 不泄露存在性；public/unlisted 明确提示无需密码
    if (row.visibility === 'private') return c.json({ error: '作品不存在' }, 404);
    return c.json({ error: '该作品未设置访问密码' }, 400);
  }
  if (!(await bcrypt.compare(parsed.data.password, row.access_password_hash))) {
    return c.json({ error: '访问密码错误' }, 401);
  }

  const accessToken = await signArtifactAccessToken(row.id, resolveJwtSecret());
  return c.json({ accessToken });
});

// 批量改可见性：仅作用于本人拥有的作品（非本人的 id 静默跳过）。
//
// 返回受影响作品的完整出参数组（2026-07-26 修订，此前只回 {updated: 数量}）：
// 下面的 SQL 对非管理员刻意保留 pending，只回条数会让前端只能做本地乐观更新——
// UI 显示「公开」，实际被广场与 /u/:username 排除，用户看不到任何解释。
// 回传真值后前端可直接覆盖，reviewStatus 与实际一致。
artifactsRouter.post('/artifacts/batch-visibility', requireAuth, denyBearer(), async (c) => {
  const user = c.get('user')!;
  const body = await readJson(c);
  if (body === null) return c.json({ error: '请求体不是合法的 JSON' }, 400);
  const parsed = batchVisibilitySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);

  const { ids, visibility } = parsed.data;
  // 审核门（契约 §3.3 转公开补审）：批量不执行云端机审——已配置 AK 时按 pass 判定
  // （approved 非公开作品批量转 public 的残余风险由举报+下架兜底），未配置时按 disabled
  // 回退 trusted 闸门；pending 作品不得经批量转为 approved 的 public（下方 SQL 防洗白，管理员豁免）
  const nextStatus = resolveReviewStatus({
    visibility,
    isAdmin: user.is_admin,
    isTrusted: user.is_trusted,
    cloud: cloudModerationEnabled() ? 'pass' : 'disabled',
  });
  const result = await pool.query<ArtifactWithAuthorRow>(
    `with updated as (
       update artifacts set visibility = $1,
         review_status = case
           when review_status = 'pending' and $2::text = 'approved' and $1::text = 'public' and $5::boolean = false
             then 'pending'
           else $2::text
         end,
         updated_at = now()
       where user_id = $3 and id = any($4::uuid[])
       returning *
     )
     select a.*, u.username as author_username, u.display_name as author_display_name,
            u.subdomain_prefix as author_subdomain_prefix
     from updated a join users u on u.id = a.user_id
     order by a.updated_at desc`,
    [visibility, nextStatus, user.id, ids, user.is_admin]
  );
  return c.json({
    updated: result.rowCount ?? 0,
    items: result.rows.map((row) => serializeArtifact(row)),
  });
});

/** applyArtifactUpdate 的补丁形态：accessPasswordHash 已由调用方哈希（undefined = 不变） */
export interface ArtifactUpdatePatch {
  title?: string;
  description?: string | null;
  code?: string;
  visibility?: string;
  /** 已哈希的访问密码：string = 设置/更换；null = 清除；缺省 = 不变 */
  accessPasswordHash?: string | null;
  /** 生成合成内容声明（契约 §3.11）；缺省 = 不变 */
  aiGenerated?: boolean;
}

/** applyArtifactUpdate 结果：直接可交给 c.json(body, status) */
export interface ArtifactUpdateResult {
  status: ContentfulStatusCode;
  body: Record<string, unknown>;
}

/**
 * 标准更新核心（PUT 与版本恢复共用，契约 §3.3/§3.7）：
 * 归属校验 → 敏感词 violatesPolicy → 云审 cloudModerate（pending 作品与转 public 全量、否则变更字段）
 * → resolveReviewStatus 重判 → update → 内容变更时记版本快照。
 * 恢复端点复用本函数，保证不能借恢复绕过任何闸门。
 */
export async function applyArtifactUpdate(
  user: UserRow,
  id: string,
  patch: ArtifactUpdatePatch
): Promise<ArtifactUpdateResult> {
  const owned = await pool.query<{
    user_id: string;
    visibility: string;
    review_status: string;
    title: string;
    description: string | null;
    code: string;
  }>('select user_id, visibility, review_status, title, description, code from artifacts where id = $1', [
    id,
  ]);
  if (!owned.rows[0]) return { status: 404, body: { error: '作品不存在' } };
  if (owned.rows[0].user_id !== user.id) return { status: 403, body: { error: '无权操作该作品' } };

  const { title, description, code, visibility, accessPasswordHash, aiGenerated } = patch;
  // 敏感词闸门（契约 §3.3）：命中即拒绝，不回显命中词
  if (violatesPolicy([title, description, code])) {
    return { status: 400, body: { error: '内容疑似包含违禁内容，无法保存。如有疑问请联系站长。' } };
  }
  // 云端机审（契约 §3.3）：管理员跳过；pending 作品与转 public 时对合并后全量内容重审
  // （防局部/空 PUT 洗白 + 转公开补审）；其余仅内容变更时送审变更字段；high 拒绝
  let cloud: CloudVerdict = 'pass';
  if (!user.is_admin) {
    const plan = selectModerationFields(owned.rows[0], { title, description, code, visibility });
    cloud = plan ? await cloudModerate(plan.fields) : 'pass';
  }
  if (cloud === 'reject') {
    return { status: 400, body: { error: '内容未通过机器审核，无法保存。如有疑问请联系站长。' } };
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if (title !== undefined) {
    params.push(title);
    sets.push(`title = $${params.length}`);
  }
  if (description !== undefined) {
    params.push(description);
    sets.push(`description = $${params.length}`);
  }
  if (code !== undefined) {
    params.push(code);
    sets.push(`code = $${params.length}`);
  }
  if (visibility !== undefined) {
    params.push(visibility);
    sets.push(`visibility = $${params.length}`);
  }
  if (accessPasswordHash !== undefined) {
    params.push(accessPasswordHash);
    sets.push(`access_password_hash = $${params.length}`);
  }
  if (aiGenerated !== undefined) {
    params.push(aiGenerated);
    sets.push(`ai_generated = $${params.length}`);
  }
  // 审核门（契约 §3.3）：非管理员每次变更都重新判定
  if (!user.is_admin) {
    const nextVisibility = visibility ?? owned.rows[0].visibility;
    params.push(
      resolveReviewStatus({
        visibility: nextVisibility,
        isAdmin: false,
        isTrusted: user.is_trusted,
        cloud,
      })
    );
    sets.push(`review_status = $${params.length}`);
  }
  sets.push('updated_at = now()');
  params.push(id);
  await pool.query(`update artifacts set ${sets.join(', ')} where id = $${params.length}`, params);

  const detail = await pool.query<ArtifactWithAuthorRow>(`${ARTIFACT_SELECT} where a.id = $1`, [id]);
  // 版本快照（契约 §3.7）：仅当 title/description/code 任一「值」较旧行发生变化时，以更新后的完整内容记版本。
  // 按值差异而非「字段是否提供」判定——与现状完全相同的全量 PUT（零改动保存）不记重复版本；
  // 仅改 visibility/accessPassword 同样不记；失败仅记日志，不影响响应
  const prev = owned.rows[0];
  const contentChanged =
    (title !== undefined && title !== prev.title) ||
    (description !== undefined && description !== prev.description) ||
    (code !== undefined && code !== prev.code);
  if (contentChanged) {
    const row = detail.rows[0];
    await snapshotVersion(id, { title: row.title, description: row.description, code: row.code });
  }
  return {
    status: 200,
    body: { artifact: serializeArtifact(detail.rows[0], { includeCode: true }) },
  };
}

// 更新：严格校验作者；可改 title/description/code/visibility/accessPassword/aiGenerated；
// 限流 20 次/分/IP（契约 §3.3：云审费用与滥用兜底）；核心逻辑与版本恢复共用 applyArtifactUpdate
artifactsRouter.put('/artifacts/:id', rateLimit('update', 20, 60_000), requireAuth, async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = await readJson(c);
  if (body === null) return c.json({ error: '请求体不是合法的 JSON' }, 400);
  const parsed = updateArtifactSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);

  const { title, description, code, visibility, accessPassword, aiGenerated } = parsed.data;
  const result = await applyArtifactUpdate(user, id, {
    title,
    description,
    code,
    visibility,
    aiGenerated,
    // 字符串 = 设置/更换（bcrypt）；null = 清除；缺省（undefined）= 不变
    ...(accessPassword !== undefined
      ? { accessPasswordHash: await hashAccessPassword(accessPassword) }
      : {}),
  });
  return c.json(result.body, result.status);
});

// 设置/清除自定义路径(契约 §3.10):body {customPath: string|null}
artifactsRouter.put('/artifacts/:id/custom-path', requireAuth, async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  if (!UUID_PATTERN.test(id)) return c.json({ error: '作品不存在' }, 404);
  const body = (await readJson(c)) as { customPath?: unknown } | null;
  if (!body || !('customPath' in body)) {
    return c.json({ error: '缺少 customPath 字段(string 或 null)' }, 400);
  }

  let customPath: string | null = null;
  if (body.customPath !== null) {
    const parsed = customPathSchema.safeParse(body.customPath);
    if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
    if (!user.subdomain_prefix) {
      return c.json({ error: '请先在个人设置领取子域前缀' }, 400);
    }
    customPath = parsed.data;
    // 配额（契约 §3.12 三级解析：admin 豁免 → 覆盖 → 档位默认；0 = 不限）
    const limit = effectiveQuota(user, 'customPaths');
    if (limit > 0) {
      const used = await pool.query<{ count: string }>(
        'select count(*) as count from artifacts where user_id = $1 and custom_path is not null and id <> $2',
        [user.id, id]
      );
      if (!withinQuota(Number.parseInt(used.rows[0].count, 10), limit)) {
        return c.json({ error: `自定义路径数量已达上限（${limit} 个）` }, 403);
      }
    }
  }

  try {
    const updated = await pool.query<{ id: string }>(
      'update artifacts set custom_path = $1, updated_at = now() where id = $2 and user_id = $3 returning id',
      [customPath, id, user.id]
    );
    if (!updated.rows[0]) return c.json({ error: '作品不存在' }, 404);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return c.json({ error: '该路径已被你的其他作品使用' }, 409);
    }
    throw err;
  }

  const row = await pool.query<ArtifactWithAuthorRow>(
    `select a.*, u.username as author_username, u.display_name as author_display_name,
            u.subdomain_prefix as author_subdomain_prefix
     from artifacts a join users u on u.id = a.user_id where a.id = $1`,
    [id]
  );
  return c.json({ artifact: serializeArtifact(row.rows[0], { includeCode: false }) });
});

// 删除：严格校验作者；204。不可逆动作，拒 Bearer（契约 §3.8）
artifactsRouter.delete('/artifacts/:id', requireAuth, denyBearer(), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const owned = await pool.query<{ user_id: string }>(
    'select user_id from artifacts where id = $1',
    [id]
  );
  if (!owned.rows[0]) return c.json({ error: '作品不存在' }, 404);
  if (owned.rows[0].user_id !== user.id) return c.json({ error: '无权操作该作品' }, 403);
  await pool.query('delete from artifacts where id = $1', [id]);
  return c.body(null, 204);
});

/** 广场排序白名单（契约 §3）：order by 只从常量映射取值，绝不拼接用户输入 */
const EXPLORE_ORDER_BY: Record<'latest' | 'hot', string> = {
  latest: 'a.created_at desc',
  hot: 'a.views desc, a.created_at desc',
};

// 广场：仅 public 且未下架；分页 + 搜索 + 类型筛选 + 排序（latest 默认 / hot）
artifactsRouter.get('/explore', async (c) => {
  const typeParsed = listQueryTypeSchema.safeParse(c.req.query('type') || undefined);
  if (!typeParsed.success) return c.json({ error: '类型必须是 react 或 html' }, 400);
  const sortParsed = exploreSortSchema.safeParse(c.req.query('sort') || undefined);
  if (!sortParsed.success) return c.json({ error: '排序必须是 latest 或 hot' }, 400);
  const q = c.req.query('q')?.trim();
  const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1);
  const pageSizeRaw = Number.parseInt(c.req.query('pageSize') ?? '24', 10) || 24;
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw));

  const conds: string[] = [`a.visibility = 'public'`, 'a.is_taken_down = false', `a.review_status = 'approved'`];
  const params: unknown[] = [];
  if (q) {
    params.push(`%${q}%`);
    conds.push(`(a.title ilike $${params.length} or a.description ilike $${params.length})`);
  }
  if (typeParsed.data) {
    params.push(typeParsed.data);
    conds.push(`a.type = $${params.length}`);
  }
  const where = conds.join(' and ');

  const totalResult = await pool.query<{ count: string }>(
    `select count(*) as count from artifacts a where ${where}`,
    params
  );
  const total = Number.parseInt(totalResult.rows[0].count, 10);

  const listParams = [...params, pageSize, (page - 1) * pageSize];
  const result = await pool.query<ArtifactWithAuthorRow>(
    `${ARTIFACT_SELECT} where ${where}
     order by ${EXPLORE_ORDER_BY[sortParsed.data ?? 'latest']}
     limit $${params.length + 1} offset $${params.length + 2}`,
    listParams
  );

  return c.json({
    items: result.rows.map((row) => serializeArtifact(row)),
    total,
    page,
    pageSize,
  });
});

// 用户公开主页：{user, artifacts}（仅 public 未下架，不含 email / code）
artifactsRouter.get('/users/:username', async (c) => {
  const username = c.req.param('username');
  const userResult = await pool.query<UserRow>('select * from users where username = $1', [
    username,
  ]);
  const user = userResult.rows[0];
  if (!user) return c.json({ error: '用户不存在' }, 404);

  const artifacts = await pool.query<ArtifactWithAuthorRow>(
    `${ARTIFACT_SELECT}
     where a.user_id = $1 and a.visibility = 'public' and a.is_taken_down = false and a.review_status = 'approved'
     order by a.created_at desc`,
    [user.id]
  );
  return c.json({
    user: serializeUser(user),
    artifacts: artifacts.rows.map((row) => serializeArtifact(row)),
  });
});

// 举报：可选鉴权；201
artifactsRouter.post('/artifacts/:id/report', rateLimit('report', 5, 60_000), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const body = await readJson(c);
  if (body === null) return c.json({ error: '请求体不是合法的 JSON' }, 400);
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);

  const exists = await pool.query('select 1 from artifacts where id = $1', [id]);
  if (!exists.rows[0]) return c.json({ error: '作品不存在' }, 404);

  await pool.query(
    'insert into reports (artifact_id, reporter_id, reason) values ($1, $2, $3)',
    [id, user?.id ?? null, parsed.data.reason]
  );
  return c.json({ ok: true }, 201);
});
