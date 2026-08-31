// 临时链接路由（契约 §3.6）：作者创建/列表/撤销 + 公开访问端点
// 语义：独立 token、到期即失效（惰性判断，无 cron）、可撤销、不影响原链接；
// 公开端点豁免可见性与访问密码（核心场景：把私密作品限时给某人看）；已下架一律 404（治理优先）
import { Hono } from 'hono';
import { pool, type ArtifactWithAuthorRow, type TempLinkRow } from '../db.js';
import { type AuthVariables, requireAuth } from '../auth.js';
import { rateLimit } from '../ratelimit.js';
import { createTempLinkSchema, zodMessage } from '../validation.js';
import { generateTempToken } from '../slug.js';
import { recordDailyView } from '../stats.js';
import { serializeArtifact } from '../serialize.js';

/** 每作品有效（未过期未撤销）临时链接上限（契约 §3.6） */
export const ACTIVE_TEMP_LINKS_LIMIT = 20;

/** tempLink 出参（契约 §3.6）：{id, token, expiresAt, note, expired, createdAt}，绝不含 revoked_at 等内部字段 */
function serializeTempLink(row: TempLinkRow): Record<string, unknown> {
  return {
    id: row.id,
    token: row.token,
    expiresAt: row.expires_at.toISOString(),
    note: row.note,
    expired: row.expires_at.getTime() <= Date.now(),
    createdAt: row.created_at.toISOString(),
  };
}

/** 读取 JSON 请求体，非法 JSON 返回 null */
async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

export const tempLinksRouter = new Hono<{ Variables: AuthVariables }>();

/** 校验作品归属：'not-found'（作品不存在）/ 'forbidden'（非本人）/ 'ok'（归属校验通过） */
async function checkOwnership(
  artifactId: string,
  userId: string
): Promise<'not-found' | 'forbidden' | 'ok'> {
  const owned = await pool.query<{ user_id: string }>(
    'select user_id from artifacts where id = $1',
    [artifactId]
  );
  if (!owned.rows[0]) return 'not-found';
  if (owned.rows[0].user_id !== userId) return 'forbidden';
  return 'ok';
}

// 创建（✓作者）：{expiresInHours: 1|6|12|24|72|168|720, note?≤200 字} → 201 {tempLink}
tempLinksRouter.post('/artifacts/:id/temp-links', requireAuth, async (c) => {
  const user = c.get('user')!;
  const artifactId = c.req.param('id');
  const body = await readJson(c);
  if (body === null) return c.json({ error: '请求体不是合法的 JSON' }, 400);
  const parsed = createTempLinkSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);

  const ownership = await checkOwnership(artifactId, user.id);
  if (ownership === 'not-found') return c.json({ error: '作品不存在' }, 404);
  if (ownership === 'forbidden') return c.json({ error: '无权操作该作品' }, 403);

  // 有效链接上限（未过期未撤销）：超限 400；过期/撤销的不占名额
  const active = await pool.query<{ count: string }>(
    `select count(*) as count from temporary_links
     where artifact_id = $1 and revoked_at is null and expires_at > now()`,
    [artifactId]
  );
  if (Number.parseInt(active.rows[0].count, 10) >= ACTIVE_TEMP_LINKS_LIMIT) {
    return c.json(
      { error: `该作品的有效临时链接已达上限（${ACTIVE_TEMP_LINKS_LIMIT} 个）` },
      400
    );
  }

  const { expiresInHours, note } = parsed.data;
  // token 唯一冲突时重试（16 位 nanoid 碰撞概率极低）
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateTempToken();
    try {
      const result = await pool.query<TempLinkRow>(
        `insert into temporary_links (artifact_id, token, expires_at, note)
         values ($1, $2, now() + make_interval(hours => $3), $4)
         returning *`,
        [artifactId, token, expiresInHours, note || null]
      );
      return c.json({ tempLink: serializeTempLink(result.rows[0]) }, 201);
    } catch (err) {
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === '23505' && pgErr.constraint?.includes('token')) continue;
      throw err;
    }
  }
  return c.json({ error: '生成临时链接失败，请重试' }, 500);
});

// 列表（✓作者）：未撤销的全部（含已过期，出参 expired），按 created_at 倒序
tempLinksRouter.get('/artifacts/:id/temp-links', requireAuth, async (c) => {
  const user = c.get('user')!;
  const artifactId = c.req.param('id');

  const ownership = await checkOwnership(artifactId, user.id);
  if (ownership === 'not-found') return c.json({ error: '作品不存在' }, 404);
  if (ownership === 'forbidden') return c.json({ error: '无权操作该作品' }, 403);

  const result = await pool.query<TempLinkRow>(
    `select * from temporary_links
     where artifact_id = $1 and revoked_at is null
     order by created_at desc`,
    [artifactId]
  );
  return c.json({ items: result.rows.map(serializeTempLink) });
});

// 撤销（✓作者，按 temp link id）→ 204；撤销 = 置 revoked_at（不物理删除，幂等）
tempLinksRouter.delete('/temp-links/:id', requireAuth, async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');

  const found = await pool.query<{ user_id: string }>(
    `select a.user_id from temporary_links tl
     join artifacts a on a.id = tl.artifact_id
     where tl.id = $1`,
    [id]
  );
  if (!found.rows[0]) return c.json({ error: '临时链接不存在' }, 404);
  if (found.rows[0].user_id !== user.id) return c.json({ error: '无权操作该链接' }, 403);

  await pool.query(
    'update temporary_links set revoked_at = coalesce(revoked_at, now()) where id = $1',
    [id]
  );
  return c.body(null, 204);
});

/** 公开访问端点联查行：artifact + 作者 + 临时链接状态 */
interface ResolveRow extends ArtifactWithAuthorRow {
  tl_expires_at: Date;
  tl_revoked_at: Date | null;
}

// 公开访问（限流 30 次/分/IP）：有效 → 与详情一致的 {artifact}（含 code；豁免 visibility 与密码；
// 计 views 与日计数）+ {tempLink: {expiresAt}}；过期/撤销/不存在/已下架 → 404「链接已过期或不存在」
tempLinksRouter.get('/t/:token', rateLimit('temp-link', 30, 60_000), async (c) => {
  const token = c.req.param('token');
  const result = await pool.query<ResolveRow>(
    `select a.*, u.username as author_username, u.display_name as author_display_name,
            u.subdomain_prefix as author_subdomain_prefix,
            tl.expires_at as tl_expires_at, tl.revoked_at as tl_revoked_at
     from temporary_links tl
     join artifacts a on a.id = tl.artifact_id
     join users u on u.id = a.user_id
     where tl.token = $1`,
    [token]
  );
  const row = result.rows[0];
  // 惰性过期：查询时判断；已下架治理优先，同样 404 不泄露存在性
  if (
    !row ||
    row.tl_revoked_at !== null ||
    row.tl_expires_at.getTime() <= Date.now() ||
    row.is_taken_down
  ) {
    return c.json({ error: '链接已过期或不存在' }, 404);
  }

  const updated = await pool.query<{ views: number }>(
    'update artifacts set views = views + 1 where id = $1 returning views',
    [row.id]
  );
  row.views = updated.rows[0].views;
  await recordDailyView(row.id);

  return c.json({
    artifact: serializeArtifact(row, { includeCode: true }),
    tempLink: { expiresAt: row.tl_expires_at.toISOString() },
  });
});
