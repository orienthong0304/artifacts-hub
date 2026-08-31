// 环境变量加载与集中读取（契约文档第 1 节）
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 极简 .env 加载器（无第三方依赖）：仅在变量未设置时生效 */
function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // 去掉成对引号
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

export const env = {
  /** Postgres 连接串（库名 artifacts_platform） */
  DATABASE_URL:
    process.env.DATABASE_URL ??
    'postgres://postgres:postgres@localhost:5432/artifacts_platform',
  /** JWT 签名密钥（生产必填） */
  JWT_SECRET: process.env.JWT_SECRET ?? '',
  /** 监听端口，默认 8091 */
  PORT: Number(process.env.PORT ?? 8091),
  /** 该邮箱注册的账号自动 is_admin */
  ADMIN_EMAIL: process.env.ADMIN_EMAIL ?? '',
  /** 敏感词词表路径（契约 §3.3）；缺省回退仓库示例词表 */
  SENSITIVE_WORDS_PATH: process.env.SENSITIVE_WORDS_PATH ?? '',
  /** 阿里云内容安全 AccessKey（契约 §3.3）；缺省关闭云端机审 */
  ALIYUN_AK_ID: process.env.ALIYUN_AK_ID ?? '',
  ALIYUN_AK_SECRET: process.env.ALIYUN_AK_SECRET ?? '',
  /** 内容安全接入点（默认上海） */
  ALIYUN_GREEN_ENDPOINT: process.env.ALIYUN_GREEN_ENDPOINT ?? 'green-cip.cn-shanghai.aliyuncs.com',
  /** 检测服务（文本审核增强版 Service 参数） */
  ALIYUN_GREEN_SERVICE: process.env.ALIYUN_GREEN_SERVICE ?? 'ugc_moderation_byllm',
  /** 站点文件存储根目录（契约 §3.9）；生产 /app/sites 卷挂载 */
  SITES_ROOT: process.env.SITES_ROOT ?? './sites-data',
  /** 站点子域后缀（契约 §3.9 修订）：拼 site.url = https://<subdomain>.<后缀>/（替代已废弃的 SITES_PUBLIC_BASE） */
  SITES_DOMAIN_SUFFIX: process.env.SITES_DOMAIN_SUFFIX ?? 'artifacts.orienthong.cn',
  /** free 档站点配额的 env 覆盖口（契约 §3.12）：默认 3（2026-08-31 放宽，原 1）；0 = 不限 */
  SITE_QUOTA_PER_USER: Number(process.env.SITE_QUOTA_PER_USER ?? 3),
  /** 渲染器源（契约 §3.10 子域 shell）：shell 内嵌 runner iframe 的 src；默认值即生产渲染子域 */
  RUNNER_ORIGIN: process.env.RUNNER_ORIGIN ?? 'https://run.artifacts.orienthong.cn',
  /**
   * 内容审核模式（dual-track roadmap OS-2）：
   * 'cloud'（默认）= SaaS 现行为（本地词表 + 云审 + trusted 闸门回退）；
   * 'off' = 全关（词表不拦、云审不调、一律 approved）——开源单用户实例用，
   * 自己对自己的内容负责，没有「转人工」的人。
   */
  MODERATION_MODE: process.env.MODERATION_MODE === 'off' ? 'off' : 'cloud',
  /**
   * 用户模型（dual-track roadmap OS-2）：'multi'（默认）= 开放注册；
   * 'single' = 单用户自托管——首个注册者即管理员，此后注册关闭。
   */
  AUTH_MODE: process.env.AUTH_MODE === 'single' ? 'single' : 'multi',
  /** 额外允许的 CSRF Origin 白名单（契约 §3 安全注记）：逗号分隔可追加多个 */
  EXTRA_ALLOWED_ORIGIN: process.env.EXTRA_ALLOWED_ORIGIN ?? '',
  /** 生产模式：cookie 加 Secure */
  isProd: process.env.NODE_ENV === 'production',
};
