#!/usr/bin/env node
/**
 * 白名单单点生成（能力波次 1 · W1-5）。
 *
 * 唯一真值：runner/vendor.config.mjs（契约 §4 的实现来源）。
 * 版本号真值：runner/package.json 的 dependencies。
 *
 * 生成物：mcp/src/generated/whitelist.ts —— 供 MCP 的 get_platform_capabilities
 * 与 artifacts://runtime/whitelist resource 消费，让 Agent **动笔之前**就知道能用什么，
 * 而不是写完发布再撞一次 IMPORT_NOT_ALLOWED。
 *
 * 为什么必须生成而不是手抄：白名单此前在四个地方各有一份（vendor.config.mjs、
 * runner 的 supportedListText、guides-data.json 两处、契约文档），四份不可能长期一致。
 * 一致性由 mcp/test/whitelist.test.ts 断言守住——生成物与 vendor.config.mjs 不符即失败。
 *
 * 用法：node scripts/gen-whitelist.mjs [--check]
 *   --check 只校验生成物是否最新（CI/部署前用），不写文件；不一致时 exit 1。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'mcp/src/generated/whitelist.ts');

const { VENDOR_PACKAGES, UI_COMPONENTS } = await import(
  'file://' + path.join(ROOT, 'runner/vendor.config.mjs')
);
const runnerPkg = JSON.parse(await readFile(path.join(ROOT, 'runner/package.json'), 'utf8'));

/** 子路径导入（react/jsx-runtime 等）不单独列版本，版本随主包 */
function rootPackageOf(name) {
  if (name.startsWith('@')) return name.split('/').slice(0, 2).join('/');
  return name.split('/')[0];
}

/** 依赖版本：去掉 ^ ~ 等范围前缀，取声明值 */
function versionOf(name) {
  const raw = runnerPkg.dependencies?.[rootPackageOf(name)];
  return raw ? String(raw).replace(/^[\^~>=<\s]+/, '') : null;
}

const packages = VENDOR_PACKAGES.map((p) => ({
  name: p.name,
  version: versionOf(p.name),
  /** 子路径条目（含 /）在展示清单里合并进主包，不单独罗列 */
  subpath: p.name.includes('/') && !p.name.startsWith('@'),
}));

const body = `// ⚠️ 本文件由 scripts/gen-whitelist.mjs 生成，请勿手改。
// 真值：runner/vendor.config.mjs（白名单）+ runner/package.json（版本）。
// 改白名单后运行：node scripts/gen-whitelist.mjs
// 一致性由 mcp/test/whitelist.test.ts 守住。

/** 白名单 npm 包（name 即用户代码里的 import 名） */
export interface WhitelistPackage {
  name: string;
  /** 声明版本（子路径条目随主包） */
  version: string | null;
  /** 是否为子路径导入（react/jsx-runtime 等），展示清单里合并进主包 */
  subpath: boolean;
}

export const WHITELIST_PACKAGES: WhitelistPackage[] = ${JSON.stringify(packages, null, 2)};

/** shadcn/ui 组件名，导入形如 \`@/components/ui/<name>\` */
export const UI_COMPONENTS: string[] = ${JSON.stringify(UI_COMPONENTS, null, 2)};

/** 平台硬约束——Agent 生成代码前必须知道的规则 */
export const PLATFORM_RULES: string[] = [
  '单文件：不支持相对路径 import，所有代码必须在同一个文件里',
  'react 类型必须有 export default 导出根组件',
  '只能用下方白名单内的依赖，其它 npm 包一律报 IMPORT_NOT_ALLOWED',
  '不能引用本地图片/字体等资源；图片用完整 URL 或 data: URI',
  '代码上限 500KB',
  'Tailwind 工具类直接可用（runner 内置 runtime），无需引入',
  '沙箱为 opaque origin：localStorage / sessionStorage / cookie 不可用，跨域 fetch 受限',
  '多文件项目请改用 ZIP 站点托管，而不是把文件拼进单文件',
];

/** 人类可读的白名单摘要（进 tool description 与 MCP resource） */
export function whitelistSummary(): string {
  const names = WHITELIST_PACKAGES.filter((p) => !p.subpath).map((p) => p.name);
  return (
    names.join('、') +
    '（含 react-dom/client、react/jsx-runtime 等子路径），' +
    \`以及 shadcn/ui 组件 @/components/ui/{\${UI_COMPONENTS.join(',')}} 与 @/lib/utils\`
  );
}
`;

if (process.argv.includes('--check')) {
  if (!existsSync(OUT)) {
    console.error('[gen-whitelist] 生成物不存在，请运行 node scripts/gen-whitelist.mjs');
    process.exit(1);
  }
  const cur = await readFile(OUT, 'utf8');
  if (cur !== body) {
    console.error('[gen-whitelist] 生成物已过期，请运行 node scripts/gen-whitelist.mjs 后重新提交');
    process.exit(1);
  }
  console.log('[gen-whitelist] 生成物与 vendor.config.mjs 一致 ✓');
} else {
  await writeFile(OUT, body);
  console.log(
    `[gen-whitelist] 已生成 ${path.relative(ROOT, OUT)}：` +
      `${packages.filter((p) => !p.subpath).length} 个包 + ${UI_COMPONENTS.length} 个 UI 组件`
  );
}
