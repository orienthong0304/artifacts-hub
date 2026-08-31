-- Artifacts 平台数据模型（契约文档第 2 节，库名 artifacts_platform）
create extension if not exists citext;
create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext unique not null,
  username citext unique not null,        -- 3-20 位，[a-z0-9_-]
  password_hash text not null,            -- bcrypt
  display_name text,
  bio text,
  is_admin boolean not null default false,
  is_trusted boolean not null default false,
  plan text not null default 'free',            -- 档位标签（契约 §3.12）：free|member，应用层校验
  quota_overrides jsonb not null default '{}',  -- 逐项配额覆盖（契约 §3.12）
  created_at timestamptz not null default now()
);

create table artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  slug text unique not null,              -- nanoid 8 位 url-safe
  title text not null,
  description text,
  type text not null check (type in ('react','html')),
  code text not null,                     -- 上限 500KB，后端校验
  visibility text not null check (visibility in ('public','unlisted','private')) default 'public',
  access_password_hash text,               -- 可选访问密码（bcrypt），null = 无密码；private 下忽略
  views integer not null default 0,
  is_taken_down boolean not null default false,
  review_status text not null check (review_status in ('approved','pending')) default 'approved',
  ai_generated boolean not null default true,  -- 生成合成内容声明（契约 §3.11）；缺省 true，产品定位即 AI 生成
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on artifacts (user_id, created_at desc);
create index on artifacts (visibility, created_at desc) where visibility = 'public';

create table reports (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references artifacts(id) on delete cascade,
  reporter_id uuid references users(id) on delete set null,
  reason text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- 幂等迁移（存量库补列；db.ts 启动时对已有库单独执行 MIGRATIONS）
alter table artifacts add column if not exists access_password_hash text;
alter table users add column if not exists is_trusted boolean not null default false;
alter table artifacts add column if not exists review_status text not null default 'approved'
  check (review_status in ('approved','pending'));
create table if not exists consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  terms_version text not null,
  context text not null check (context in ('register','publish')),
  created_at timestamptz not null default now(),
  unique (user_id, terms_version, context)
);
-- 访问日计数（契约 §3.5）：仅聚合计数，绝不掺入任何访客标识
create table if not exists artifact_view_daily (
  artifact_id uuid not null references artifacts(id) on delete cascade,
  day date not null default current_date,
  views integer not null default 0,
  primary key (artifact_id, day)
);
-- 临时链接（契约 §3.6）：限时分享豁免可见性/密码；惰性过期（查询时判断，无 cron）
create table if not exists temporary_links (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references artifacts(id) on delete cascade,
  token text unique not null,
  expires_at timestamptz not null,
  note text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
-- 版本历史（契约 §3.7）：内容变更自动快照，每作品保留最近 20 版
create table if not exists artifact_versions (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references artifacts(id) on delete cascade,
  version integer not null,
  title text not null,
  description text,
  code text not null,
  created_at timestamptz not null default now(),
  unique (artifact_id, version)
);
-- API Token（契约 §3.8）：只存 sha256 哈希，明文只在创建响应出现一次；可撤销
create table if not exists api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text unique not null,
  label text not null,
  last_four text not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
-- explore hot 排序索引：按浏览量降序、创建时间降序
create index if not exists artifacts_hot_idx on artifacts (views desc, created_at desc);
-- ZIP 站点托管（契约 §3.9）：静态站点元数据，文件本体在磁盘 <SITES_ROOT>/<subdomain>/current/
create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  slug text unique not null,
  subdomain text unique not null,           -- §3.9 修订：用户自定义子域前缀（3-30 位，唯一）
  title text not null,
  size_bytes bigint not null,
  file_count integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- §3.9 子域修订迁移段（存量库补列；表已在生产存在但零行——可空加列 + 唯一索引即可，
-- not null 由新库建表语句与服务端插入必填保证；与 db.ts MIGRATIONS 双写保持一致）
alter table sites add column if not exists subdomain text;
create unique index if not exists sites_subdomain_key on sites (subdomain);
-- §3.10 用户前缀子域：前缀列 + 自定义路径列 + 子域统一命名空间（与 db.ts MIGRATIONS 双写保持一致）
alter table users add column if not exists subdomain_prefix text;
create unique index if not exists users_subdomain_prefix_key on users (subdomain_prefix);
alter table artifacts add column if not exists custom_path text;
create unique index if not exists artifacts_custom_path_key
  on artifacts (user_id, custom_path) where custom_path is not null;
create table if not exists subdomain_registry (
  name text primary key,
  kind text not null check (kind in ('site','user')),
  ref uuid not null,
  created_at timestamptz not null default now()
);
-- 存量站点子域幂等回填（仅新库/旧库首次补齐时生效）
insert into subdomain_registry (name, kind, ref)
  select subdomain, 'site', id from sites where subdomain is not null
  on conflict (name) do nothing;
