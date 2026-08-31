// pg 连接池 + schema 初始化（启动时执行 schema.sql，幂等）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

export const pool = new Pool({ connectionString: env.DATABASE_URL });

/** 数据库行类型（snake_case，与 schema.sql 对应） */
export interface UserRow {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  display_name: string | null;
  bio: string | null;
  is_admin: boolean;
  is_trusted: boolean;
  /** 用户前缀(契约 §3.10):null=未领取;一经设置不可改 */
  subdomain_prefix: string | null;
  /** 档位标签(契约 §3.12):'free'|'member';应用层校验,DB 无 check */
  plan: string;
  /** 逐项配额覆盖(契约 §3.12):缺键回落档位默认 */
  quota_overrides: Partial<Record<'customPaths' | 'sites' | 'apiTokens' | 'dailyCreates', number>>;
  created_at: Date;
}

export interface ArtifactRow {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  description: string | null;
  type: 'react' | 'html';
  code: string;
  visibility: 'public' | 'unlisted' | 'private';
  access_password_hash: string | null;
  views: number;
  is_taken_down: boolean;
  review_status: 'approved' | 'pending';
  /** 生成合成内容声明(契约 §3.11):true=AI 生成/辅助生成,需显著标识 */
  ai_generated: boolean;
  /** 自定义路径(契约 §3.10):null=未设置;用户内唯一 */
  custom_path: string | null;
  created_at: Date;
  updated_at: Date;
}

/** artifact 联查作者后的行（列表/详情通用） */
export interface ArtifactWithAuthorRow extends ArtifactRow {
  author_username: string;
  author_display_name: string | null;
  /** 作者前缀(联查 users.subdomain_prefix;老查询未选出时为 undefined,序列化按 null 处理) */
  author_subdomain_prefix?: string | null;
}

/** 版本历史行（契约 §3.7） */
export interface ArtifactVersionRow {
  id: string;
  artifact_id: string;
  version: number;
  title: string;
  description: string | null;
  code: string;
  created_at: Date;
}

/** API Token 行（契约 §3.8）：只存 sha256 哈希，绝无明文 */
export interface ApiTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  label: string;
  last_four: string;
  last_used_at: Date | null;
  created_at: Date;
  revoked_at: Date | null;
}

/** 站点行（契约 §3.9）：size_bytes 为 bigint，pg 返回 string */
export interface SiteRow {
  id: string;
  user_id: string;
  slug: string;
  /** 自定义子域前缀（§3.9 修订）：URL 与磁盘布局的唯一标识 */
  subdomain: string;
  title: string;
  size_bytes: string;
  file_count: number;
  created_at: Date;
  updated_at: Date;
}

/** 临时链接行（契约 §3.6） */
export interface TempLinkRow {
  id: string;
  artifact_id: string;
  token: string;
  expires_at: Date;
  note: string | null;
  created_at: Date;
  revoked_at: Date | null;
}

/**
 * 幂等迁移语句：存量库跳过 schema.sql 全量执行，但每次启动都要补齐这些增量列。
 * 与 schema.sql 末尾的迁移段保持一致（契约 §3.1）。
 */
const MIGRATIONS: string[] = [
  'alter table artifacts add column if not exists access_password_hash text',
  'alter table users add column if not exists is_trusted boolean not null default false',
  `alter table artifacts add column if not exists review_status text not null default 'approved'
  check (review_status in ('approved','pending'))`,
  `create table if not exists consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  terms_version text not null,
  context text not null check (context in ('register','publish')),
  created_at timestamptz not null default now(),
  unique (user_id, terms_version, context)
)`,
  `create table if not exists artifact_view_daily (
  artifact_id uuid not null references artifacts(id) on delete cascade,
  day date not null default current_date,
  views integer not null default 0,
  primary key (artifact_id, day)
)`,
  `create table if not exists temporary_links (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references artifacts(id) on delete cascade,
  token text unique not null,
  expires_at timestamptz not null,
  note text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
)`,
  `create table if not exists artifact_versions (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references artifacts(id) on delete cascade,
  version integer not null,
  title text not null,
  description text,
  code text not null,
  created_at timestamptz not null default now(),
  unique (artifact_id, version)
)`,
  `create table if not exists api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text unique not null,
  label text not null,
  last_four text not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
)`,
  'create index if not exists artifacts_hot_idx on artifacts (views desc, created_at desc)',
  `create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  slug text unique not null,
  subdomain text unique not null,
  title text not null,
  size_bytes bigint not null,
  file_count integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)`,
  // §3.9 子域修订：生产 sites 表已存在但零行——可空加列 + 唯一索引（服务端插入必填，无回填问题）。
  // 新建表走上面的 create table（not null unique，其唯一约束索引名恰为 sites_subdomain_key，下句幂等跳过）
  'alter table sites add column if not exists subdomain text',
  'create unique index if not exists sites_subdomain_key on sites (subdomain)',
  // §3.10 用户前缀子域:前缀列 + 自定义路径列 + 子域统一命名空间
  'alter table users add column if not exists subdomain_prefix text',
  'create unique index if not exists users_subdomain_prefix_key on users (subdomain_prefix)',
  'alter table artifacts add column if not exists custom_path text',
  // §3.11 生成合成内容标识：带默认值加列，存量行按「AI 生成」处理（本平台定位如此，
  // 且对存量内容按需要标识处理是合规上的安全侧）。非约束型迁移，不重写表
  'alter table artifacts add column if not exists ai_generated boolean not null default true',
  // §3.12 会员与配额：plan 档位标签 + 逐项覆盖。刻意不加 check（收紧型迁移在生产失败
  // 会让 API 容器起不来），合法性由应用层 zod 把关
  "alter table users add column if not exists plan text not null default 'free'",
  `alter table users add column if not exists quota_overrides jsonb not null default '{}'`,
  `create unique index if not exists artifacts_custom_path_key
  on artifacts (user_id, custom_path) where custom_path is not null`,
  `create table if not exists subdomain_registry (
  name text primary key,
  kind text not null check (kind in ('site','user')),
  ref uuid not null,
  created_at timestamptz not null default now()
)`,
  // 存量站点子域幂等回填(仅新库/旧库首次补齐时生效)
  `insert into subdomain_registry (name, kind, ref)
  select subdomain, 'site', id from sites where subdomain is not null
  on conflict (name) do nothing`,
];

/**
 * 初始化 schema：若 users 表已存在则只执行幂等迁移；否则全量执行 schema.sql。
 * schema.sql 与契约文档第 2 节保持一致，不要在此处改表结构。
 */
export async function initSchema(): Promise<void> {
  const check = await pool.query(
    "select to_regclass('public.users') as existing"
  );
  if (check.rows[0]?.existing) {
    for (const stmt of MIGRATIONS) {
      await pool.query(stmt);
    }
    console.log('[db] 幂等迁移已执行');
    return;
  }
  const schemaPath = fileURLToPath(new URL('../schema.sql', import.meta.url));
  const sql = readFileSync(schemaPath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
    console.log('[db] schema 初始化完成');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
