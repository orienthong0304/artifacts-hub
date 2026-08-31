# Artifacts Runner（渲染器子系统）

Artifacts 平台的渲染器，独立 Vite 静态子项目，生产部署在 `https://run.artifacts.orienthong.cn`。
实现契约文档 §4（`docs/superpowers/specs/2026-07-20-artifacts-platform-contracts.md`）：
主站通过沙箱 iframe 嵌入本页面，postMessage 下发用户代码，runner 在浏览器端完成转译、
白名单校验与沙箱执行，并把结果回报主站。

## 工作原理

```
主站 <iframe sandbox="allow-scripts allow-forms allow-popups allow-modals" src=RUNNER_ORIGIN>
 │  { __artifacts, type:'render', payload:{ kind:'react'|'html', code } }
 ▼
runner（src/main.ts）
 ├─ react：@babel/standalone（presets: typescript+react）转译 TSX → 收集 import（AST 层）
 │         → 白名单校验 → 构建内层 srcdoc iframe：
 │         import map（白名单 → /vendor/*.js 绝对 URL）+ 自托管 Tailwind runtime
 │         + shadcn 主题变量 + 内联 module（用户代码 + ErrorBoundary 挂载引导）
 ├─ html ：完整文档写入内层无特权 srcdoc iframe，仅注入 Tailwind runtime 与 resize 上报
 └─ 每次 render 全量重建内层 iframe（无状态残留）；内层经 __artifacts_inner 消息回报，
    runner 转换为 { __artifacts, type:'rendered'|'error'|'resize' } 发回主站
```

关键点：

- **react 全局单例**：所有依赖 react 的 vendor 包构建时把 `react`/`react-dom`/`react/jsx-runtime`
  留作 external，运行时经 import map 全部指向同一份 `vendor/react.js`。
- **CJS require 垫片**：CJS 包（react-dom 等）对 external 依赖的 `require()` 在 ESM 产物中
  会走 esbuild 的 `__require` 兜底并抛错，`build-vendor` 为每个包注入 banner：静态 import
  全部 external 并定义模块级 `require` 返回其 CJS 形态（default）。
- **import 白名单**：Babel 插件在 **Program enter** 阶段扫描原始 AST 收集 import
  （preset-typescript 会删除未使用 import，晚了会漏检），白名单外/相对路径 import 直接报中文
  error 并列出完整支持清单。
- **default export 检测**：同一插件检测并把 default export 改写挂到
  `globalThis.__ARTIFACT_DEFAULT__`，缺失时报中文错误。
- **错误捕获**：内层文档最先注入错误上报脚本（window error 捕获 + 资源加载失败 + unhandledrejection），
  React 侧再包 ErrorBoundary；渲染超时（20s）由 runner 兜底。

## 目录结构

```
runner/
├── index.html            runner 页面（生产入口）
├── test-host.html        宿主测试页（模拟主站，本地验证用）
├── src/
│   ├── main.ts           协议主逻辑（ready/render/rendered/error/resize）
│   ├── transpile.ts      Babel 转译 + import 收集 + export 改写
│   ├── import-map.ts     运行时 import map / 白名单校验
│   ├── sandbox.ts        内层 srcdoc 构建（react/html）
│   ├── theme.ts          shadcn CSS 变量 + Tailwind config（注入内层文档）
│   ├── protocol.ts       消息类型定义
│   └── test-host.ts      宿主测试页脚本
├── vendor.config.mjs     白名单唯一清单（构建脚本与运行时共用）
├── scripts/build-vendor.mjs   esbuild 打包全部白名单库 → public/vendor/
├── vendor-src/           shadcn/ui 组件源码（复制自主仓库 src/components/ui）+ @/lib/utils
├── assets/tailwind-3.4.16.js  自托管 Tailwind Play CDN runtime（checked-in，离线可构建）
├── examples/             3 个测试样例（dashboard.tsx / motion.tsx / page.html）
└── public/vendor/        构建产物（gitignore，npm run build:vendor 生成）
```

## 本地验证

```bash
cd runner
npm install
npm run dev        # 先构建 vendor，再起 vite dev（端口 5174，strictPort）
```

打开 <http://localhost:5174/test-host.html>：

1. 页面左侧为模拟主站控制台，右侧 iframe 以与生产一致的 sandbox 属性嵌入 runner（`/`）；
2. 日志出现 `← ready` 后，点击三个样例按钮之一即自动下发 render：
   - **仪表盘 (recharts+shadcn)** —— 验证 recharts、`@/components/ui/*`、lucide-react、Tailwind；
   - **动画 (framer-motion)** —— 验证 framer-motion 与交互；
   - **完整 HTML** —— 验证 html 类型渲染与 Tailwind runtime 注入；
3. 也可在文本框粘贴任意单文件 TSX / HTML，选类型后点「渲染」；
4. 错误路径验证：粘贴 `import x from "three"`（白名单外）、去掉 default export、
   或在组件里 throw，日志应出现对应中文 `← error`。

构建与产物预览：

```bash
npm run build      # build:vendor → tsc --noEmit → vite build
npm run preview    # 5174 端口预览 dist（含 test-host.html）
```

## Vendor 产物体积（minified，未 gzip；`public/vendor/manifest.json` 有完整清单）

合计 **4.29 MB**（46 个文件）。按需加载：内层文档只拉取用户代码实际 import 的模块。

| 模块 | 文件 | 体积 |
|---|---|---|
| lucide-react | lucide-react.js | 780.0 KB |
| mathjs | mathjs.js | 774.7 KB |
| recharts | recharts.js | 512.6 KB |
| Tailwind runtime | tailwind.js | 440.6 KB |
| xlsx | xlsx.js | 423.1 KB |
| d3 | d3.js | 307.4 KB |
| framer-motion | framer-motion.js | 206.8 KB |
| react-dom | react-dom.js | 132.5 KB |
| lodash | lodash.js | 89.5 KB |
| date-fns | date-fns.js | 85.7 KB |
| zod | zod.js | 64.9 KB |
| papaparse | papaparse.js | 21.0 KB |
| tailwind-merge | tailwind-merge.js | 20.8 KB |
| react | react.js | 9.6 KB |
| clsx / cva / jsx-runtime / react-dom-client 等 | — | 各 < 1 KB |
| shadcn/ui 26 个组件（radix 打进各组件内部） | ui/*.js | 0.2 – 84.9 KB，合计约 520 KB |

runner 页面自身 bundle（含 @babel/standalone）约 2.99 MB（gzip 688 KB）。

## 部署要点（生产）

1. `npm run build` 后把 `dist/` 部署为 `run.artifacts.orienthong.cn` 静态站
   （1Panel/OpenResty；需 DNS A 记录 + SSL）。
2. **必须为该站点所有静态资源加响应头 `Access-Control-Allow-Origin: *`**：
   runner 运行在主站的沙箱 iframe 中（无 `allow-same-origin`，origin 为 opaque），
   其自身的 module script 与内层 import map 加载 vendor 均以 `Origin: null` 发起 CORS 请求，
   缺少该头会全部加载失败。dev/preview 已通过 vite `cors: true` 放开。
3. vendor 文件名当前不带 hash，更新白名单后建议配合较短的缓存时间或整体刷新 CDN 缓存。
4. 生产不需要 `test-host.html`，可从发布产物中剔除（保留也无害，页面不含敏感信息）。

## 已知限制

- **tailwindcss-animate 不可用**：Play runtime 无法加载该插件，shadcn 组件的
  `animate-in/fade-in/zoom-in` 等过渡类静默失效（不影响功能）；accordion 展开动画所需
  keyframes 已在注入的 tailwind.config 中手动补齐。
- **主站 → runner 的 targetOrigin 只能为 `'*'`**：runner iframe 无 `allow-same-origin`，
  origin 为 opaque，任何具体 targetOrigin 都无法匹配（契约中「targetOrigin 明确指定」仅对
  runner → 主站方向可行，runner 已按首个 render 消息的 `event.origin` 回发）。render 消息
  不含敏感数据，风险可控。
- **html 类型不回报运行时错误**：按契约仅保证渲染与 resize；文档 `load` 即回报 `rendered`。
- `rendered` 表示挂载指令已提交（React 18 并发提交），首帧之后的异步错误仍会以 `error` 补报。
