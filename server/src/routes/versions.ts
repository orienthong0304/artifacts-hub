// 版本历史路由（契约 §3.7）：列表 / 详情 / 一键恢复（全部 ✓作者）
// 恢复复用 applyArtifactUpdate ——与 PUT 完全相同的闸门顺序（敏感词 → 云审 → 审核门 → 更新 → 快照），
// 不能借恢复绕审；恢复本身也是一次内容变更，成功后会再记一个新版本。
import { Hono } from 'hono';
import { pool, type ArtifactVersionRow } from '../db.js';
import { type AuthVariables, requireAuth } from '../auth.js';
import { rateLimit } from '../ratelimit.js';
import { applyArtifactUpdate } from './artifacts.js';

export const versionsRouter = new Hono<{ Variables: AuthVariables }>();

/** 校验作品归属（与 PUT 的 404/403 语义一致） */
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

/** 解析 :version 参数：正整数返回数值，否则 null（按「版本不存在」处理） */
function parseVersionParam(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// 列表（✓作者）：{items: [{id, version, title, createdAt}]} 按 version 倒序，不含 code
versionsRouter.get('/artifacts/:id/versions', requireAuth, async (c) => {
  const user = c.get('user')!;
  const artifactId = c.req.param('id');

  const ownership = await checkOwnership(artifactId, user.id);
  if (ownership === 'not-found') return c.json({ error: '作品不存在' }, 404);
  if (ownership === 'forbidden') return c.json({ error: '无权操作该作品' }, 403);

  const result = await pool.query<Pick<ArtifactVersionRow, 'id' | 'version' | 'title' | 'created_at'>>(
    `select id, version, title, created_at from artifact_versions
     where artifact_id = $1 order by version desc`,
    [artifactId]
  );
  return c.json({
    items: result.rows.map((row) => ({
      id: row.id,
      version: row.version,
      title: row.title,
      createdAt: row.created_at.toISOString(),
    })),
  });
});

// 详情（✓作者）：{version: {id, version, title, description, code, createdAt}}
versionsRouter.get('/artifacts/:id/versions/:version', requireAuth, async (c) => {
  const user = c.get('user')!;
  const artifactId = c.req.param('id');

  const ownership = await checkOwnership(artifactId, user.id);
  if (ownership === 'not-found') return c.json({ error: '作品不存在' }, 404);
  if (ownership === 'forbidden') return c.json({ error: '无权操作该作品' }, 403);

  const versionNum = parseVersionParam(c.req.param('version'));
  if (versionNum === null) return c.json({ error: '版本不存在' }, 404);
  const result = await pool.query<ArtifactVersionRow>(
    'select * from artifact_versions where artifact_id = $1 and version = $2',
    [artifactId, versionNum]
  );
  const row = result.rows[0];
  if (!row) return c.json({ error: '版本不存在' }, 404);

  return c.json({
    version: {
      id: row.id,
      version: row.version,
      title: row.title,
      description: row.description,
      code: row.code,
      createdAt: row.created_at.toISOString(),
    },
  });
});

// 恢复（✓作者）：以该版本内容执行一次标准更新（复用 PUT 全部闸门），成功后同样记新版本。
// 与 PUT 同款限流 20 次/分/IP（含内容变更会触发云端机审计费调用）
versionsRouter.post(
  '/artifacts/:id/versions/:version/restore',
  rateLimit('restore', 20, 60_000),
  requireAuth,
  async (c) => {
    const user = c.get('user')!;
    const artifactId = c.req.param('id');

    const ownership = await checkOwnership(artifactId, user.id);
    if (ownership === 'not-found') return c.json({ error: '作品不存在' }, 404);
    if (ownership === 'forbidden') return c.json({ error: '无权操作该作品' }, 403);

    const versionNum = parseVersionParam(c.req.param('version'));
    if (versionNum === null) return c.json({ error: '版本不存在' }, 404);
    const result = await pool.query<ArtifactVersionRow>(
      'select * from artifact_versions where artifact_id = $1 and version = $2',
      [artifactId, versionNum]
    );
    const snapshot = result.rows[0];
    if (!snapshot) return c.json({ error: '版本不存在' }, 404);

    const updated = await applyArtifactUpdate(user, artifactId, {
      title: snapshot.title,
      description: snapshot.description,
      code: snapshot.code,
    });
    return c.json(updated.body, updated.status);
  }
);
