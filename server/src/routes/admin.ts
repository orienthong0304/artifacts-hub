// 管理员路由：举报列表 / 下架恢复（契约文档第 3 节）
import { Hono } from 'hono';
import { pool, type ArtifactWithAuthorRow, type UserRow } from '../db.js';
import { sanitizeOverrides, type QuotaOverrides } from '../quota.js';
import { type AuthVariables, requireAdmin } from '../auth.js';
import { reviewSchema, takedownSchema, adminUserUpdateSchema, zodMessage, UUID_PATTERN } from '../validation.js';
import { serializeArtifact } from '../serialize.js';

interface ReportListRow {
  id: string;
  reason: string;
  created_at: Date;
  reporter_username: string | null;
  artifact_id: string;
  slug: string;
  title: string;
  type: 'react' | 'html';
  visibility: string;
  is_taken_down: boolean;
  author_username: string;
  author_display_name: string | null;
}

export const adminRouter = new Hono<{ Variables: AuthVariables }>();

adminRouter.use('*', requireAdmin);

// 未处理举报列表（含 artifact 摘要）
adminRouter.get('/reports', async (c) => {
  const result = await pool.query<ReportListRow>(
    `select r.id, r.reason, r.created_at,
            ru.username as reporter_username,
            a.id as artifact_id, a.slug, a.title, a.type, a.visibility, a.is_taken_down,
            au.username as author_username, au.display_name as author_display_name
     from reports r
     join artifacts a on a.id = r.artifact_id
     join users au on au.id = a.user_id
     left join users ru on ru.id = r.reporter_id
     where r.resolved = false
     order by r.created_at desc`
  );
  return c.json({
    items: result.rows.map((row) => ({
      id: row.id,
      reason: row.reason,
      createdAt: row.created_at.toISOString(),
      reporter: row.reporter_username ? { username: row.reporter_username } : null,
      artifact: {
        id: row.artifact_id,
        slug: row.slug,
        title: row.title,
        type: row.type,
        visibility: row.visibility,
        isTakenDown: row.is_taken_down,
        author: {
          username: row.author_username,
          displayName: row.author_display_name,
        },
      },
    })),
  });
});

// 下架 / 恢复：{takenDown: boolean}；下架时顺带把该作品的未处理举报标记为已处理
adminRouter.post('/artifacts/:id/takedown', async (c) => {
  const id = c.req.param('id');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: '请求体不是合法的 JSON' }, 400);
  }
  const parsed = takedownSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);

  const updated = await pool.query(
    'update artifacts set is_taken_down = $1, updated_at = now() where id = $2 returning id',
    [parsed.data.takenDown, id]
  );
  if (!updated.rows[0]) return c.json({ error: '作品不存在' }, 404);

  if (parsed.data.takenDown) {
    await pool.query('update reports set resolved = true where artifact_id = $1', [id]);
  }

  const detail = await pool.query<ArtifactWithAuthorRow>(
    `select a.*, u.username as author_username, u.display_name as author_display_name,
            u.subdomain_prefix as author_subdomain_prefix
     from artifacts a join users u on u.id = a.user_id where a.id = $1`,
    [id]
  );
  return c.json({ artifact: serializeArtifact(detail.rows[0]) });
});

// 待审核作品：public + pending + 未下架（契约 §3.3），按创建时间正序
adminRouter.get('/pending', async (c) => {
  const result = await pool.query<ArtifactWithAuthorRow>(
    `select a.*, u.username as author_username, u.display_name as author_display_name,
            u.subdomain_prefix as author_subdomain_prefix
     from artifacts a join users u on u.id = a.user_id
     where a.visibility = 'public' and a.review_status = 'pending' and a.is_taken_down = false
     order by a.created_at asc`
  );
  return c.json({ items: result.rows.map((row) => serializeArtifact(row)) });
});

// 审核：approve = 过审 + 作者永久 trusted；reject = 下架（未处理举报同步 resolved）
adminRouter.post('/artifacts/:id/review', async (c) => {
  const id = c.req.param('id');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: '请求体不是合法的 JSON' }, 400);
  }
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);

  const owned = await pool.query<{ user_id: string }>('select user_id from artifacts where id = $1', [id]);
  if (!owned.rows[0]) return c.json({ error: '作品不存在' }, 404);

  if (parsed.data.action === 'approve') {
    await pool.query(`update artifacts set review_status = 'approved', updated_at = now() where id = $1`, [id]);
    await pool.query('update users set is_trusted = true where id = $1', [owned.rows[0].user_id]);
  } else {
    await pool.query('update artifacts set is_taken_down = true, updated_at = now() where id = $1', [id]);
    await pool.query('update reports set resolved = true where artifact_id = $1', [id]);
  }

  const detail = await pool.query<ArtifactWithAuthorRow>(
    `select a.*, u.username as author_username, u.display_name as author_display_name,
            u.subdomain_prefix as author_subdomain_prefix
     from artifacts a join users u on u.id = a.user_id where a.id = $1`,
    [id]
  );
  return c.json({ artifact: serializeArtifact(detail.rows[0]) });
});

// ---------- 用户管理（契约 §3.12）：会员与配额的手工运营底座 ----------

interface AdminUserRow {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  plan: string;
  is_trusted: boolean;
  quota_overrides: QuotaOverrides;
  created_at: Date;
  artifacts_count: number;
  sites_count: number;
  custom_paths_count: number;
  active_tokens_count: number;
}

function serializeAdminUser(row: AdminUserRow): Record<string, unknown> {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    plan: row.plan,
    isTrusted: row.is_trusted,
    quotaOverrides: row.quota_overrides ?? {},
    stats: {
      artifacts: row.artifacts_count,
      sites: row.sites_count,
      customPaths: row.custom_paths_count,
      activeTokens: row.active_tokens_count,
    },
    createdAt: row.created_at.toISOString(),
  };
}

/** 用户行 + 四项统计的联查（lateral 聚合避免 N+1；用户量级下无性能顾虑） */
const ADMIN_USER_SELECT = `
  select u.id, u.email, u.username, u.display_name, u.plan, u.is_trusted, u.quota_overrides, u.created_at,
         (select count(*)::int from artifacts a where a.user_id = u.id) as artifacts_count,
         (select count(*)::int from sites s where s.user_id = u.id) as sites_count,
         (select count(*)::int from artifacts a where a.user_id = u.id and a.custom_path is not null) as custom_paths_count,
         (select count(*)::int from api_tokens t where t.user_id = u.id and t.revoked_at is null) as active_tokens_count
  from users u
`;

// 用户列表：分页 + username/email 模糊搜索，created_at 倒序
adminRouter.get('/users', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(c.req.query('pageSize') ?? '20', 10) || 20));
  const where = q ? `where u.username ilike $1 or u.email ilike $1` : '';
  const params: unknown[] = q ? [`%${q}%`] : [];
  const total = await pool.query<{ n: number }>(
    `select count(*)::int as n from users u ${where}`,
    params
  );
  const rows = await pool.query<AdminUserRow>(
    `${ADMIN_USER_SELECT} ${where} order by u.created_at desc limit ${pageSize} offset ${(page - 1) * pageSize}`,
    params
  );
  return c.json({
    items: rows.rows.map(serializeAdminUser),
    total: total.rows[0].n,
    page,
    pageSize,
  });
});

// 调整用户：plan / isTrusted / 逐项配额覆盖（与既存合并，null 删除该项）。
// 无缓存层，effectiveQuota 每请求现算 → 调整立即生效
adminRouter.put('/users/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID_PATTERN.test(id)) return c.json({ error: '用户不存在' }, 404);
  const body = await c.req.json().catch(() => null);
  if (body === null) return c.json({ error: '请求体不是合法的 JSON' }, 400);
  const parsed = adminUserUpdateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
  const { plan, isTrusted, quotaOverrides } = parsed.data;

  const existing = await pool.query<Pick<UserRow, 'quota_overrides'>>(
    'select quota_overrides from users where id = $1',
    [id]
  );
  if (!existing.rows[0]) return c.json({ error: '用户不存在' }, 404);

  const sets: string[] = [];
  const params: unknown[] = [];
  if (plan !== undefined) {
    params.push(plan);
    sets.push(`plan = $${params.length}`);
  }
  if (isTrusted !== undefined) {
    params.push(isTrusted);
    sets.push(`is_trusted = $${params.length}`);
  }
  if (quotaOverrides !== undefined) {
    params.push(
      JSON.stringify(sanitizeOverrides(existing.rows[0].quota_overrides ?? {}, quotaOverrides))
    );
    sets.push(`quota_overrides = $${params.length}::jsonb`);
  }
  params.push(id);
  await pool.query(`update users set ${sets.join(', ')} where id = $${params.length}`, params);

  const updated = await pool.query<AdminUserRow>(`${ADMIN_USER_SELECT} where u.id = $1`, [id]);
  return c.json({ user: serializeAdminUser(updated.rows[0]) });
});
