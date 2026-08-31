// 集成测试公共设施：连接本地 Docker Postgres（docker compose --profile dev up -d db）
// 必须在 import src 之前设置环境变量（db.ts 在模块加载时创建连接池）
// 注：本机宿主机 5432 端口已被其它项目的 langchat-pgvector 容器占用，
// docker-compose.yml 的 db 服务已改绑宿主机 5433（见该文件注释）；此处默认值同步为 5433，
// 可用 DATABASE_URL_TEST 覆盖回 5432 或其它连接串。
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgres://postgres:postgres@localhost:5433/artifacts_platform_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
process.env.ADMIN_EMAIL = 'admin@test.local';
// 显式置空阿里云密钥：env.ts 的 .env 加载器仅在变量 undefined 时生效，
// 置空可阻止其读入 server/.env 里的真实 AK → cloudModerate 恒返回 'disabled'，
// 集成测试绝不打真实审核接口（行为与 Task 5 断言一致）
process.env.ALIYUN_AK_ID = '';
process.env.ALIYUN_AK_SECRET = '';
process.env.ALIYUN_GREEN_ENDPOINT = '';
process.env.ALIYUN_GREEN_SERVICE = '';
// 渲染器源（契约 §3.10 子域 shell）：测试内固定为生产默认值，断言可依赖
process.env.RUNNER_ORIGIN = 'https://run.artifacts.orienthong.cn';
// 站点文件根目录（契约 §3.9）：每个测试文件独立临时目录，避免互相污染磁盘
const { mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
export const sitesRoot = mkdtempSync(join(tmpdir(), 'artifacts-sites-test-'));
process.env.SITES_ROOT = sitesRoot;

const db = await import('../../src/db.js');
const appModule = await import('../../src/app.js');

export const pool = db.pool;
export const initSchema = db.initSchema;
export const app = appModule.app;

/** 清空全部业务表（保留 schema；动态枚举避免新表遗漏） */
export async function resetDb(): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'"
  );
  if (rows.length) {
    await pool.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(', ')} cascade`);
  }
}

/** 每次注册用不同伪造 IP，绕开注册限流（10 次/分/IP） */
let ipCounter = 0;

/** 注册并返回携带登录 cookie 的值（`artifacts_token=...`） */
export async function registerUser(
  username: string,
  email = `${username}@test.local`
): Promise<{ cookie: string }> {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.0.0.${++ipCounter}`,
    },
    body: JSON.stringify({ email, username, password: 'password123', agreeTerms: true }),
  });
  if (res.status !== 201) {
    throw new Error(`注册失败: ${res.status} ${await res.text()}`);
  }
  return { cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] };
}
