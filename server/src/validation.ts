// zod 请求校验（错误信息全部中文）
import { z } from 'zod';

/** 代码体积上限：500KB（按 UTF-8 字节数计） */
export const CODE_MAX_BYTES = 500 * 1024;

/** 用户名规则：3-20 位，[a-z0-9_-]（契约文档第 2 节） */
export const USERNAME_PATTERN = /^[a-z0-9_-]{3,20}$/;

export const registerSchema = z.object({
  email: z
    .string({ required_error: '邮箱不能为空', invalid_type_error: '邮箱格式不正确' })
    .trim()
    .email('邮箱格式不正确')
    .max(254, '邮箱过长'),
  password: z
    .string({ required_error: '密码不能为空', invalid_type_error: '密码格式不正确' })
    .min(8, '密码至少 8 位')
    .max(72, '密码不能超过 72 位'),
  username: z
    .string({ required_error: '用户名不能为空', invalid_type_error: '用户名格式不正确' })
    .regex(USERNAME_PATTERN, '用户名需为 3-20 位小写字母、数字、下划线或连字符'),
  agreeTerms: z.literal(true, {
    errorMap: () => ({ message: '请先阅读并同意服务条款与隐私政策' }),
  }),
});

export const loginSchema = z.object({
  email: z
    .string({ required_error: '邮箱不能为空', invalid_type_error: '邮箱格式不正确' })
    .trim()
    .min(1, '邮箱不能为空'),
  password: z
    .string({ required_error: '密码不能为空', invalid_type_error: '密码格式不正确' })
    .min(1, '密码不能为空'),
});

const titleSchema = z
  .string({ required_error: '标题不能为空', invalid_type_error: '标题格式不正确' })
  .trim()
  .min(1, '标题不能为空')
  .max(120, '标题不能超过 120 字');

const descriptionSchema = z
  .string({ invalid_type_error: '描述格式不正确' })
  .max(1000, '描述不能超过 1000 字')
  .nullish();

const codeSchema = z
  .string({ required_error: '代码不能为空', invalid_type_error: '代码格式不正确' })
  .min(1, '代码不能为空')
  .refine(
    (v) => Buffer.byteLength(v, 'utf8') <= CODE_MAX_BYTES,
    '代码不能超过 500KB'
  );

const typeSchema = z.enum(['react', 'html'], {
  errorMap: () => ({ message: '类型必须是 react 或 html' }),
});

const visibilitySchema = z.enum(['public', 'unlisted', 'private'], {
  errorMap: () => ({ message: '可见性必须是 public、unlisted 或 private' }),
});

/** 访问密码（契约 §3.1）：4-64 位字符串 = 设置/更换；null = 清除；缺省 = 不变 */
const accessPasswordSchema = z
  .string({ invalid_type_error: '访问密码格式不正确' })
  .min(4, '访问密码至少 4 位')
  .max(64, '访问密码不能超过 64 位')
  .nullish();

export const createArtifactSchema = z.object({
  title: titleSchema,
  description: descriptionSchema,
  type: typeSchema,
  code: codeSchema,
  visibility: visibilitySchema.default('public'),
  accessPassword: accessPasswordSchema,
  // 生成合成内容声明（契约 §3.11）：缺省 true——本平台定位就是承载 AI 生成的页面，
  // 未声明时按「需要标识」处理是合规上的安全侧；作者可显式声明为 false
  aiGenerated: z.boolean().default(true),
});

/** 更新：仅允许改 title/description/code/visibility/accessPassword/aiGenerated，至少提供一项 */
export const updateArtifactSchema = z
  .object({
    title: titleSchema.optional(),
    description: descriptionSchema,
    code: codeSchema.optional(),
    visibility: visibilitySchema.optional(),
    accessPassword: accessPasswordSchema,
    aiGenerated: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.description !== undefined ||
      v.code !== undefined ||
      v.visibility !== undefined ||
      v.accessPassword !== undefined ||
      v.aiGenerated !== undefined,
    { message: '至少需要提供一个待更新字段' }
  );

/** 批量改可见性：{ids: string[], visibility}，一次最多 200 个 */
export const batchVisibilitySchema = z.object({
  ids: z
    .array(z.string().uuid('作品 id 格式不正确'))
    .min(1, '请至少选择一个作品')
    .max(200, '一次最多批量操作 200 个作品'),
  visibility: visibilitySchema,
});

/** 解锁请求（契约 §3.1）：{password} */
export const unlockSchema = z.object({
  password: z
    .string({ required_error: '访问密码不能为空', invalid_type_error: '访问密码格式不正确' })
    .min(1, '访问密码不能为空')
    .max(64, '访问密码不能超过 64 位'),
});

/** 临时链接有效期档位（小时，契约 §3.6） */
export const TEMP_LINK_EXPIRES_HOURS = [1, 6, 12, 24, 72, 168, 720] as const;

/** 创建临时链接（契约 §3.6）：{expiresInHours, note?}；有效期只认固定档位 */
export const createTempLinkSchema = z.object({
  expiresInHours: z.union(
    [
      z.literal(1),
      z.literal(6),
      z.literal(12),
      z.literal(24),
      z.literal(72),
      z.literal(168),
      z.literal(720),
    ],
    { errorMap: () => ({ message: '有效期不合法' }) }
  ),
  note: z
    .string({ invalid_type_error: '备注格式不正确' })
    .trim()
    .max(200, '备注不能超过 200 字')
    .optional(),
});

/** 创建 API Token（契约 §3.8）：{label? ≤50 字}，缺省 "API Token" */
export const createApiTokenSchema = z.object({
  label: z
    .string({ invalid_type_error: 'Token 名称格式不正确' })
    .trim()
    .max(50, 'Token 名称不能超过 50 字')
    .optional(),
});

/** 站点标题（契约 §3.9）：与作品标题同规则，1-120 字 */
export const siteTitleSchema = titleSchema;

/** 站点子域前缀正则（契约 §3.9 修订）：小写字母/数字/连字符，首尾字母数字；长度由 min/max 收口到 3-30 */
export const SITE_SUBDOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{1,28})?[a-z0-9]$/;

/** 保留字黑名单（契约 §3.9 修订）：与平台/基础设施子域冲突或有钓鱼风险的前缀 */
export const SITE_SUBDOMAIN_RESERVED = new Set([
  'www', 'api', 'run', 'admin', 'mail', 'smtp', 'ftp', 'artifacts', 'static', 'cdn',
  'assets', 'app', 'dev', 'test', 'staging', 'beta', 'blog', 'docs', 'help', 'support',
  'status', 'm', 'wap', 'download', 'img', 'vpn', 'webmail', 'pay', 'login', 'auth',
  'account', 'user', 'root', 'system', 'official', 'ns1', 'ns2',
]);

const SITE_SUBDOMAIN_FORMAT_MESSAGE = '前缀需为 3-30 位小写字母/数字/连字符，且首尾为字母或数字';

/** 站点子域前缀（契约 §3.9 修订）：格式与保留字分别报错，全局唯一由数据库唯一索引保证（冲突 409） */
export const siteSubdomainSchema = z
  .string({
    required_error: SITE_SUBDOMAIN_FORMAT_MESSAGE,
    invalid_type_error: SITE_SUBDOMAIN_FORMAT_MESSAGE,
  })
  .min(3, SITE_SUBDOMAIN_FORMAT_MESSAGE)
  .max(30, SITE_SUBDOMAIN_FORMAT_MESSAGE)
  .regex(SITE_SUBDOMAIN_PATTERN, SITE_SUBDOMAIN_FORMAT_MESSAGE)
  .refine((v) => !SITE_SUBDOMAIN_RESERVED.has(v), '该前缀为保留字，不能使用');

/** 用户前缀(契约 §3.10):与站点子域同规则、同保留字、同一命名空间(subdomain_registry) */
export const userPrefixSchema = siteSubdomainSchema;


/** 路径段:小写字母/数字/连字符 1-64 位——字符集天然排除 __ 保留段与带点文件名 */
const CUSTOM_PATH_SEGMENT = /^[a-z0-9-]{1,64}$/;
const CUSTOM_PATH_MESSAGE =
  '路径需为 1-3 段、每段 1-64 位小写字母/数字/连字符(以 / 分隔),总长不超过 128';

/** 自定义路径(契约 §3.10) */
export const customPathSchema = z
  .string({ required_error: CUSTOM_PATH_MESSAGE, invalid_type_error: CUSTOM_PATH_MESSAGE })
  .max(128, CUSTOM_PATH_MESSAGE)
  .refine((v) => {
    const segments = v.split('/');
    return (
      segments.length >= 1 &&
      segments.length <= 3 &&
      segments.every((s) => CUSTOM_PATH_SEGMENT.test(s))
    );
  }, CUSTOM_PATH_MESSAGE);

export const reportSchema = z.object({
  reason: z
    .string({ required_error: '举报理由不能为空', invalid_type_error: '举报理由格式不正确' })
    .trim()
    .min(1, '举报理由不能为空')
    .max(1000, '举报理由不能超过 1000 字'),
});

export const takedownSchema = z.object({
  takenDown: z.boolean({
    required_error: 'takenDown 不能为空',
    invalid_type_error: 'takenDown 必须是布尔值',
  }),
});

/** 管理员审核（契约 §3.3）：approve 过审并信任作者；reject 下架 */
export const reviewSchema = z.object({
  action: z.enum(['approve', 'reject'], {
    errorMap: () => ({ message: 'action 必须是 approve 或 reject' }),
  }),
});

/** 列表筛选：type 可选，非法值直接报错 */
export const listQueryTypeSchema = typeSchema.optional();

/** 广场排序（契约 §3）：latest = created_at 倒序（默认）；hot = views 倒序，并列按 created_at 倒序 */
export const exploreSortSchema = z
  .enum(['latest', 'hot'], {
    errorMap: () => ({ message: '排序必须是 latest 或 hot' }),
  })
  .optional();

/** 取 zod 错误的第一条中文信息 */
export function zodMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? '请求参数不合法';
}

/** Admin 用户调整（契约 §3.12）：plan / trusted / 逐项配额覆盖（null = 删除该项回落档位默认） */
const overrideValueSchema = z.number().int().min(0).nullable();
export const adminUserUpdateSchema = z
  .object({
    plan: z.enum(['free', 'member'], { message: 'plan 需为 free 或 member' }).optional(),
    isTrusted: z.boolean().optional(),
    quotaOverrides: z
      .object({
        customPaths: overrideValueSchema.optional(),
        sites: overrideValueSchema.optional(),
        apiTokens: overrideValueSchema.optional(),
        dailyCreates: overrideValueSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .refine(
    (v) => v.plan !== undefined || v.isTrusted !== undefined || v.quotaOverrides !== undefined,
    { message: '至少需要提供一个待更新字段' }
  );

/** UUID v4 形状校验：非法 id 在查库前拒掉，防 PG 类型错 500（原三处路由各持一份副本，2026-08-31 收编） */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
