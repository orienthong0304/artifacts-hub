// ZIP 站点托管路由（契约 §3.9）：上传发布 / 列表 / 原子替换更新 / 删除
import { Hono } from 'hono';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pool, type SiteRow, type UserRow } from '../db.js';
import { effectiveQuota, withinQuota } from '../quota.js';
import { env } from '../env.js';
import { type AuthVariables, denyBearer, requireAuth } from '../auth.js';
import { SlidingWindowRateLimiter } from '../ratelimit.js';
import { generateSiteSlug } from '../slug.js';
import { siteSubdomainSchema, siteTitleSchema, zodMessage, UUID_PATTERN } from '../validation.js';
import { violatesPolicy, cloudModerate } from '../moderation.js';
import {
  extractZip,
  collectSiteTexts,
  ZipValidationError,
  SITE_ZIP_MAX_BYTES,
} from '../zip-extract.js';

/** 上传限流（契约 §3.9）：5 次/时/用户，POST 与 PUT 共用（两者都触发云审计费） */
const uploadLimiter = new SlidingWindowRateLimiter(5, 60 * 60 * 1000);

/** uuid 形态校验：非 uuid 直接按不存在处理，避免 pg 类型错误 500 */

/** 请求体预检上限（契约 §3.9）：10MB zip + 1MB multipart 边界/字段开销余量 */
const SITE_UPLOAD_MAX_CONTENT_LENGTH = SITE_ZIP_MAX_BYTES + 1024 * 1024;

/**
 * Content-Length 预检（契约 §3.9）：formData() 会把请求体全量缓冲进内存，
 * 必须在读取之前按请求头拒绝超大 body（防内存 DoS）。
 * 缺失（含 chunked 编码）或超限一律 400；通过后仍以 file.size 复核 10MB。
 */
function contentLengthError(req: { header: (name: string) => string | undefined }): string | null {
  const raw = req.header('content-length');
  const length = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isInteger(length) || length < 0 || length > SITE_UPLOAD_MAX_CONTENT_LENGTH) {
    return '上传体积超过限制（ZIP 最大 10MB）';
  }
  return null;
}

/** site 出参（契约 §3.9 修订）：url = https://<subdomain>.<SITES_DOMAIN_SUFFIX>/；size_bytes 为 bigint（pg 返回 string） */
function serializeSite(row: SiteRow): Record<string, unknown> {
  return {
    id: row.id,
    slug: row.slug,
    subdomain: row.subdomain,
    title: row.title,
    url: `https://${row.subdomain}.${env.SITES_DOMAIN_SUFFIX}/`,
    sizeBytes: Number(row.size_bytes),
    fileCount: row.file_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** multipart 解析结果 */
interface UploadPayload {
  buffer: Buffer;
  /** title 字段原文；未提供为 null */
  title: string | null;
  /** subdomain 字段原文（POST 必填校验；PUT 一律忽略）；未提供为 null */
  subdomain: string | null;
}

/** 解析 multipart 上传：file 必填 zip ≤10MB */
async function parseUpload(
  c: { req: { formData: () => Promise<FormData> } }
): Promise<UploadPayload | { error: string }> {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return { error: '请求需要 multipart/form-data 格式并包含 file 字段' };
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return { error: '请上传 ZIP 文件（file 字段）' };
  }
  if (file.size > SITE_ZIP_MAX_BYTES) {
    return { error: 'ZIP 文件不能超过 10MB' };
  }
  const title = form.get('title');
  const subdomain = form.get('subdomain');
  return {
    buffer: Buffer.from(await file.arrayBuffer()),
    title: typeof title === 'string' ? title : null,
    subdomain: typeof subdomain === 'string' ? subdomain : null,
  };
}

/** 解压 + 校验 + 机审的公共流程；成功返回 tmpDir（调用方负责 swap 或清理） */
async function extractAndModerate(
  buffer: Buffer,
  user: UserRow
): Promise<
  | { ok: true; tmpDir: string; fileCount: number; totalBytes: number }
  | { ok: false; status: 400 | 503; error: string }
> {
  const tmpRoot = join(env.SITES_ROOT, '.tmp');
  await mkdir(tmpRoot, { recursive: true });
  const tmpDir = join(tmpRoot, `extract-${Date.now()}-${generateSiteSlug()}`);
  /** 失败统一出口：先清理 tmp 再返回 */
  const fail = async (status: 400 | 503, error: string) => {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    return { ok: false as const, status, error };
  };
  try {
    const result = await extractZip(buffer, tmpDir);
    if (!result.hasRootIndex) {
      return fail(400, 'ZIP 根目录缺少 index.html（构建产物需以 index.html 为入口）');
    }
    // 机审（契约 §3.9）：本地敏感词 → 云端分块送审；站点面大从严，high/medium 一律拒绝
    const texts = await collectSiteTexts(tmpDir);
    if (violatesPolicy(texts)) {
      return fail(400, '站点内容未通过机器审核，无法发布');
    }
    const cloud = user.is_admin ? ('pass' as const) : await cloudModerate(texts);
    if (cloud === 'reject' || cloud === 'review') {
      return fail(400, '站点内容未通过机器审核，无法发布');
    }
    if (cloud === 'unavailable') {
      // fail-closed（契约 §3.9）：审核服务不可用时不放行发布
      return fail(503, '内容审核服务暂不可用，请稍后重试');
    }
    return { ok: true, tmpDir, fileCount: result.fileCount, totalBytes: result.totalBytes };
  } catch (err) {
    if (err instanceof ZipValidationError) {
      // extractZip 失败已自清理 tmpDir（fail 再清一次幂等）
      return fail(400, err.message);
    }
    // 磁盘等意外错误：清理 tmp 后按 500 抛出
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/** 归属校验：站点不存在 404；非本人 403 */
async function loadOwnedSite(
  id: string,
  user: UserRow
): Promise<{ row: SiteRow } | { status: 403 | 404; error: string }> {
  if (!UUID_PATTERN.test(id)) return { status: 404, error: '站点不存在' };
  const result = await pool.query<SiteRow>('select * from sites where id = $1', [id]);
  const row = result.rows[0];
  if (!row) return { status: 404, error: '站点不存在' };
  if (row.user_id !== user.id) return { status: 403, error: '无权操作该站点' };
  return { row };
}

export const sitesRouter = new Hono<{ Variables: AuthVariables }>();

// 我的站点列表：updated_at 倒序
sitesRouter.get('/sites', requireAuth, async (c) => {
  const user = c.get('user')!;
  const result = await pool.query<SiteRow>(
    'select * from sites where user_id = $1 order by updated_at desc',
    [user.id]
  );
  return c.json({ items: result.rows.map(serializeSite) });
});

// 发布站点：配额 → 限流 → zip 校验 → 机审 → 落库 + 落盘
sitesRouter.post('/sites', requireAuth, async (c) => {
  const user = c.get('user')!;
  // 配额（契约 §3.12 三级解析：admin 豁免 → 覆盖 → 档位默认；free 档默认走 env）
  const quota = effectiveQuota(user, 'sites');
  if (quota > 0) {
    const count = await pool.query<{ n: number }>(
      'select count(*)::int as n from sites where user_id = $1',
      [user.id]
    );
    if (!withinQuota(count.rows[0].n, quota)) {
      return c.json({ error: `站点数量已达上限（${quota} 个）` }, 400);
    }
  }
  if (!uploadLimiter.allow(user.id)) {
    return c.json({ error: '上传过于频繁，请稍后再试（每小时最多 5 次）' }, 429);
  }
  const lengthError = contentLengthError(c.req);
  if (lengthError) return c.json({ error: lengthError }, 400);

  const upload = await parseUpload(c);
  if ('error' in upload) return c.json({ error: upload.error }, 400);
  const titleParsed = siteTitleSchema.safeParse(upload.title ?? undefined);
  if (!titleParsed.success) return c.json({ error: zodMessage(titleParsed.error) }, 400);
  // 子域前缀（契约 §3.9 修订）：格式/保留字 400；唯一性先快查（省一次云审计费），并发兜底靠唯一索引
  const subdomainParsed = siteSubdomainSchema.safeParse(upload.subdomain ?? undefined);
  if (!subdomainParsed.success) return c.json({ error: zodMessage(subdomainParsed.error) }, 400);
  const subdomain = subdomainParsed.data;
  const taken = await pool.query('select 1 from sites where subdomain = $1', [subdomain]);
  if (taken.rowCount) return c.json({ error: '该前缀已被使用' }, 409);

  const prepared = await extractAndModerate(upload.buffer, user);
  if (!prepared.ok) return c.json({ error: prepared.error }, prepared.status);

  // slug 唯一冲突时重试（先入库占 slug/subdomain，再落盘；落盘失败回滚记录）
  // 子域统一命名空间（契约 §3.10）：sites 与 subdomain_registry('site') 同事务写入，
  // registry.name 主键冲突（同名站点或用户前缀）→ 409
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateSiteSlug();
    let row: SiteRow;
    const client = await pool.connect();
    try {
      await client.query('begin');
      const inserted = await client.query<SiteRow>(
        `insert into sites (user_id, slug, subdomain, title, size_bytes, file_count)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [user.id, slug, subdomain, titleParsed.data, prepared.totalBytes, prepared.fileCount]
      );
      row = inserted.rows[0];
      await client.query(
        "insert into subdomain_registry (name, kind, ref) values ($1, 'site', $2)",
        [subdomain, row.id]
      );
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => {});
      const pgErr = err as { code?: string; constraint?: string };
      // slug 冲突（sites_slug_key）重试；不含 'subdomain' 故先判
      if (pgErr.code === '23505' && pgErr.constraint?.includes('slug')) {
        client.release();
        continue;
      }
      // 前缀占用：sites_subdomain_key 或 subdomain_registry_pkey（含 'subdomain'）→ 409
      if (pgErr.code === '23505' && pgErr.constraint?.includes('subdomain')) {
        client.release();
        await rm(prepared.tmpDir, { recursive: true, force: true }).catch(() => {});
        return c.json({ error: '该前缀已被使用' }, 409);
      }
      client.release();
      await rm(prepared.tmpDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
    client.release();
    try {
      await mkdir(join(env.SITES_ROOT, subdomain), { recursive: true });
      await rename(prepared.tmpDir, join(env.SITES_ROOT, subdomain, 'current'));
    } catch (err) {
      // 落盘失败：同事务回滚数据库记录（registry 先删，风格对齐删除路径 b6b2069）并清理磁盘，
      // 避免出现空站点或半删状态；回滚失败仅记录，不掩盖原始磁盘错误
      const cleanup = await pool.connect();
      try {
        await cleanup.query('begin');
        await cleanup.query("delete from subdomain_registry where kind = 'site' and ref = $1", [
          row.id,
        ]);
        await cleanup.query('delete from sites where id = $1', [row.id]);
        await cleanup.query('commit');
      } catch (rollbackErr) {
        await cleanup.query('rollback').catch(() => {});
        console.error('[sites] 落盘失败后的记录回滚失败:', rollbackErr);
      } finally {
        cleanup.release();
      }
      await rm(join(env.SITES_ROOT, subdomain), { recursive: true, force: true }).catch(() => {});
      await rm(prepared.tmpDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
    return c.json({ site: serializeSite(row) }, 201);
  }
  await rm(prepared.tmpDir, { recursive: true, force: true }).catch(() => {});
  return c.json({ error: '生成站点链接失败，请重试' }, 500);
});

// 更新站点：重新上传原子替换（tmp 解压 → 校验/机审 → rename swap，失败回滚保留旧版）。
// subdomain 与 URL 不变（契约 §3.9：PUT 不允许改 subdomain，请求带该字段一律忽略）
sitesRouter.put('/sites/:id', requireAuth, async (c) => {
  const user = c.get('user')!;
  const owned = await loadOwnedSite(c.req.param('id'), user);
  if ('error' in owned) return c.json({ error: owned.error }, owned.status);
  if (!uploadLimiter.allow(user.id)) {
    return c.json({ error: '上传过于频繁，请稍后再试（每小时最多 5 次）' }, 429);
  }
  const lengthError = contentLengthError(c.req);
  if (lengthError) return c.json({ error: lengthError }, 400);

  const upload = await parseUpload(c);
  if ('error' in upload) return c.json({ error: upload.error }, 400);
  let title: string | null = null;
  if (upload.title !== null) {
    const titleParsed = siteTitleSchema.safeParse(upload.title);
    if (!titleParsed.success) return c.json({ error: zodMessage(titleParsed.error) }, 400);
    title = titleParsed.data;
  }

  const prepared = await extractAndModerate(upload.buffer, user);
  if (!prepared.ok) return c.json({ error: prepared.error }, prepared.status);

  // 原子替换：current → .old-*，tmp → current；第二步失败把旧版归位
  const siteDir = join(env.SITES_ROOT, owned.row.subdomain);
  const currentDir = join(siteDir, 'current');
  const oldDir = join(siteDir, `.old-${Date.now()}`);
  await mkdir(siteDir, { recursive: true });
  let hadOld = false;
  try {
    try {
      await rename(currentDir, oldDir);
      hadOld = true;
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') throw err;
    }
    await rename(prepared.tmpDir, currentDir);
  } catch (err) {
    if (hadOld) {
      await rename(oldDir, currentDir).catch((rollbackErr) => {
        console.error('[sites] 更新回滚失败（旧版目录残留在 .old-*）:', rollbackErr);
      });
    }
    await rm(prepared.tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
  // 旧版清理失败不影响响应（残留目录不可公开访问）
  if (hadOld) {
    await rm(oldDir, { recursive: true, force: true }).catch((err) => {
      console.error('[sites] 旧版目录清理失败:', err);
    });
  }

  const updated = await pool.query<SiteRow>(
    `update sites set title = coalesce($2, title), size_bytes = $3, file_count = $4, updated_at = now()
     where id = $1 returning *`,
    [owned.row.id, title, prepared.totalBytes, prepared.fileCount]
  );
  return c.json({ site: serializeSite(updated.rows[0]) });
});

// 删除站点：磁盘目录 + 数据库记录（先删盘再删库，失败可重试）。不可逆动作，拒 Bearer（契约 §3.8）
sitesRouter.delete('/sites/:id', requireAuth, denyBearer(), async (c) => {
  const user = c.get('user')!;
  const owned = await loadOwnedSite(c.req.param('id'), user);
  if ('error' in owned) return c.json({ error: owned.error }, owned.status);

  await rm(join(env.SITES_ROOT, owned.row.subdomain), { recursive: true, force: true });
  // sites 行与 registry 占用同事务删除（契约 §3.10）：registry 先删（幂等），
  // 若中途失败回滚后站点仍在，重试 DELETE 可恢复，避免子域永久滞留 registry
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("delete from subdomain_registry where kind = 'site' and ref = $1", [
      owned.row.id,
    ]);
    await client.query('delete from sites where id = $1', [owned.row.id]);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return c.body(null, 204);
});
