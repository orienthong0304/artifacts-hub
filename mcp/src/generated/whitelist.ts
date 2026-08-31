// ⚠️ 本文件由 scripts/gen-whitelist.mjs 生成，请勿手改。
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

export const WHITELIST_PACKAGES: WhitelistPackage[] = [
  {
    "name": "react",
    "version": "18.3.1",
    "subpath": false
  },
  {
    "name": "react/jsx-runtime",
    "version": "18.3.1",
    "subpath": true
  },
  {
    "name": "react/jsx-dev-runtime",
    "version": "18.3.1",
    "subpath": true
  },
  {
    "name": "react-dom",
    "version": "18.3.1",
    "subpath": false
  },
  {
    "name": "react-dom/client",
    "version": "18.3.1",
    "subpath": true
  },
  {
    "name": "recharts",
    "version": "2.15.0",
    "subpath": false
  },
  {
    "name": "lucide-react",
    "version": "0.408.0",
    "subpath": false
  },
  {
    "name": "framer-motion",
    "version": "12.0.1",
    "subpath": false
  },
  {
    "name": "d3",
    "version": "7.9.0",
    "subpath": false
  },
  {
    "name": "lodash",
    "version": "4.17.21",
    "subpath": false
  },
  {
    "name": "date-fns",
    "version": "3.6.0",
    "subpath": false
  },
  {
    "name": "clsx",
    "version": "2.1.1",
    "subpath": false
  },
  {
    "name": "tailwind-merge",
    "version": "2.4.0",
    "subpath": false
  },
  {
    "name": "class-variance-authority",
    "version": "0.7.0",
    "subpath": false
  },
  {
    "name": "papaparse",
    "version": "5.4.1",
    "subpath": false
  },
  {
    "name": "xlsx",
    "version": "0.18.5",
    "subpath": false
  },
  {
    "name": "mathjs",
    "version": "13.2.0",
    "subpath": false
  },
  {
    "name": "zod",
    "version": "3.23.8",
    "subpath": false
  }
];

/** shadcn/ui 组件名，导入形如 `@/components/ui/<name>` */
export const UI_COMPONENTS: string[] = [
  "accordion",
  "alert",
  "alert-dialog",
  "avatar",
  "badge",
  "button",
  "card",
  "checkbox",
  "dialog",
  "dropdown-menu",
  "input",
  "label",
  "popover",
  "progress",
  "radio-group",
  "scroll-area",
  "select",
  "separator",
  "skeleton",
  "slider",
  "switch",
  "table",
  "tabs",
  "textarea",
  "toggle",
  "tooltip"
];

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
    `以及 shadcn/ui 组件 @/components/ui/{${UI_COMPONENTS.join(',')}} 与 @/lib/utils`
  );
}
