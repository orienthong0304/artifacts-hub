// API Token 路由（契约 §3.8）：创建（仅 cookie）/ 列表 / 撤销
// 安全语义：明文只在创建响应出现一次；服务端只存 sha256；列表绝不返回明文或哈希；
// Bearer 不能创建 token（防 token 自我繁殖）；撤销 = 置 revoked_at，Bearer 立即失效
import { Hono } from 'hono';
import { pool, type ApiTokenRow } from '../db.js';
import { effectiveQuota, withinQuota } from '../quota.js';
import { type AuthVariables, denyBearer, requireAuth, sha256Hex } from '../auth.js';
import { generateApiToken } from '../slug.js';
import { createApiTokenSchema, zodMessage, UUID_PATTERN } from '../validation.js';

/** 每用户有效（未撤销）token 上限（契约 §3.8） */
;

/** 缺省 label（契约 §3.8） */
export const DEFAULT_TOKEN_LABEL = 'API Token';

/** tokenInfo 出参：{id, label, lastFour, lastUsedAt, createdAt}——绝不含明文或哈希 */
function serializeTokenInfo(row: ApiTokenRow): Record<string, unknown> {
  return {
    id: row.id,
    label: row.label,
    lastFour: row.last_four,
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

/** uuid 形状校验：非 uuid 直接按不存在处理，避免 pg 22P02 抛 500 */

/** 读取 JSON 请求体；label 可选，无体/非法体按空对象处理 */
async function readJsonLenient(c: {
  req: { json: () => Promise<unknown> };
}): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

export const tokensRouter = new Hono<{ Variables: AuthVariables }>();

// 创建（✓登录，仅 cookie 鉴权）：{label?} → 201 {token（明文，仅此一次）, tokenInfo}
// 防 token 自我繁殖（契约 §3.8）：Bearer 不能创建 token
tokensRouter.post('/tokens', requireAuth, denyBearer('请在网页登录后创建 Token'), async (c) => {
  const user = c.get('user')!;

  const parsed = createApiTokenSchema.safeParse(await readJsonLenient(c));
  if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
  const label = parsed.data.label || DEFAULT_TOKEN_LABEL;

  // 有效（未撤销）上限（契约 §3.12）：超限 400；撤销的不占名额；0 = 不限
  const tokenLimit = effectiveQuota(user, 'apiTokens');
  if (tokenLimit > 0) {
    const active = await pool.query<{ count: string }>(
      'select count(*) as count from api_tokens where user_id = $1 and revoked_at is null',
      [user.id]
    );
    if (!withinQuota(Number.parseInt(active.rows[0].count, 10), tokenLimit)) {
      return c.json({ error: `有效 Token 已达上限（${tokenLimit} 个）` }, 400);
    }
  }

  // token_hash 唯一冲突时重试（32 位 nanoid 碰撞概率极低）
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateApiToken();
    try {
      const result = await pool.query<ApiTokenRow>(
        `insert into api_tokens (user_id, token_hash, label, last_four)
         values ($1, $2, $3, $4)
         returning *`,
        [user.id, sha256Hex(token), label, token.slice(-4)]
      );
      // 明文仅此一次返回，服务端只存哈希，之后无法再取回
      return c.json({ token, tokenInfo: serializeTokenInfo(result.rows[0]) }, 201);
    } catch (err) {
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === '23505' && pgErr.constraint?.includes('token_hash')) continue;
      throw err;
    }
  }
  return c.json({ error: '生成 Token 失败，请重试' }, 500);
});

// 列表（✓登录）：未撤销的全部，created_at 倒序；绝不返回明文或哈希
tokensRouter.get('/tokens', requireAuth, async (c) => {
  const user = c.get('user')!;
  const result = await pool.query<ApiTokenRow>(
    `select * from api_tokens
     where user_id = $1 and revoked_at is null
     order by created_at desc`,
    [user.id]
  );
  return c.json({ items: result.rows.map(serializeTokenInfo) });
});

// 撤销（✓登录，cookie 或 Bearer 均可）→ 204 置 revoked_at；他人 token / 不存在 → 404
tokensRouter.delete('/tokens/:id', requireAuth, async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  if (!UUID_PATTERN.test(id)) return c.json({ error: 'Token 不存在' }, 404);

  const result = await pool.query(
    `update api_tokens set revoked_at = coalesce(revoked_at, now())
     where id = $1 and user_id = $2
     returning id`,
    [id, user.id]
  );
  if (!result.rows[0]) return c.json({ error: 'Token 不存在' }, 404);
  return c.body(null, 204);
});
