// 白名单依赖清单 —— 契约文档 §4 的唯一实现来源。
// scripts/build-vendor.mjs（构建 vendor 包）与 src/import-map.ts（运行时 import map / 白名单校验）共用本文件。
// 修改白名单时只改这里，两侧自动保持一致。

/** react 全家桶必须全局单例：任何依赖 react 的 vendor 包都把这些留作 external，经 import map 指回同一份 */
export const REACT_EXTERNALS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom/client",
];

/**
 * 白名单 npm 包。
 * name: 用户代码里的 import 名（同时也是 import map 的 key）
 * file: public/vendor/ 下的产物文件名
 * external: 构建该包时保留为裸导入的依赖（由 import map 解析，保证共享同一实例）
 */
export const VENDOR_PACKAGES = [
  { name: "react", file: "react.js", external: [] },
  { name: "react/jsx-runtime", file: "react-jsx-runtime.js", external: ["react"] },
  { name: "react/jsx-dev-runtime", file: "react-jsx-dev-runtime.js", external: ["react"] },
  { name: "react-dom", file: "react-dom.js", external: ["react"] },
  { name: "react-dom/client", file: "react-dom-client.js", external: ["react", "react-dom"] },
  { name: "recharts", file: "recharts.js", external: REACT_EXTERNALS },
  { name: "lucide-react", file: "lucide-react.js", external: REACT_EXTERNALS },
  { name: "framer-motion", file: "framer-motion.js", external: REACT_EXTERNALS },
  { name: "d3", file: "d3.js", external: [] },
  { name: "lodash", file: "lodash.js", external: [] },
  { name: "date-fns", file: "date-fns.js", external: [] },
  { name: "clsx", file: "clsx.js", external: [] },
  { name: "tailwind-merge", file: "tailwind-merge.js", external: [] },
  { name: "class-variance-authority", file: "class-variance-authority.js", external: ["clsx"] },
  { name: "papaparse", file: "papaparse.js", external: [] },
  { name: "xlsx", file: "xlsx.js", external: [] },
  { name: "mathjs", file: "mathjs.js", external: [] },
  { name: "zod", file: "zod.js", external: [] },
];

/**
 * shadcn/ui 组件清单（契约 §4 列出的 26 个）。
 * 用户代码通过 `@/components/ui/<name>` 导入；源码在 vendor-src/ui/（复制自主仓库），
 * 各自打成独立 ESM 包（radix 依赖打进包内部，react / 白名单包 / @/* 保持 external）。
 */
export const UI_COMPONENTS = [
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
  "tooltip",
];
