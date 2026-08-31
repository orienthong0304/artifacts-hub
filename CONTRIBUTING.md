# 贡献指南

感谢你对 Artifacts 的兴趣！Issue 与 PR 都欢迎。

## 先了解：本仓库的发布方式

本仓库由维护者的私有主线**定期同步发布**（私有主线含运营部署配置，无法直接公开）。
这对你意味着：

- **Issue / 讨论**：直接开，这里就是主阵地。
- **PR**：我们会在这里 review；合入时由维护者移植到私有主线，随下一次同步出现在本仓库
  （你的署名以 `Co-authored-by` 保留在同步提交中）。PR 分支本身可能不会以 merge commit 形态出现，请知悉。
- 同步是单向的（私有主线 → 本仓库），所以**不要基于本仓库历史做长期分支**——每次同步都可能重铺文件。

## 开发环境

```bash
# 三个服务分别起（详见 README「开发」）
npm install && npm run dev              # 主站 :5173
cd runner && npm install && npm run dev # 渲染器 :5174
cd server && npm install && npm run dev # API :8091（需 DATABASE_URL）

# 集成测试数据库
docker compose up -d test-db            # localhost:5433
```

## 测试要求

四个包各自有测试，提交 PR 前请全部跑绿（CI 也会跑同样的矩阵）：

```bash
cd server && npm test && npm run test:integration
cd runner && npm test
cd mcp && npx vitest run
npx tsc --noEmit -p tsconfig.json && npm run build   # 主站前端：类型 + 构建
```

**改行为先改测试**：本项目按 TDD 维护——修 bug 先写复现用例看它失败，加特性先写断言。
没有对应测试变更的行为改动，review 时会被首先追问。

## 改动纪律（照做能让 PR 快速合入）

1. **`runner/` 是全站唯一「回归 = 所有作品同时不渲染」的组件**。改它必须带测试，
   涉及转译 / import 白名单 / srcdoc 注入的改动要格外说明动机。
2. **改接口先改契约**：API 形状、postMessage 协议的变更，PR 描述里写清楚新旧形状与兼容性。
3. **渲染安全模型不可破**：用户代码只能在无 `allow-same-origin` 的沙箱 iframe 中执行；
   任何往用户文档注入脚本、放宽 sandbox 属性、或让用户代码触及主站 origin 的改动都不会被接受。
4. **不往根 `package.json` 加测试依赖**：前端刻意不设测试栈（server/runner/mcp 各自有 vitest），
   UI 验证走浏览器目检。想为前端引入测试框架请先开 Issue 讨论。
5. 一个 PR 做一件事；提交信息说明「为什么」而不只是「做了什么」。

## 代码风格

- UI 文案与代码注释使用中文；技术术语与标识符保持英文
- React 函数组件 + hooks；组件 PascalCase、函数 camelCase、文件 kebab-case
- 路径别名 `@/*` 指向 `src/`；UI 组件优先复用 `src/components/ui/`（shadcn）
- 注释写「为什么」与约束，不复述代码

## 安全问题

请勿公开提交安全漏洞 Issue。通过仓库 Security → Report a vulnerability 私下报告，
或联系维护者（GitHub profile）。
