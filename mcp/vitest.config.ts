// 独立 vitest 配置：阻止 vitest 向上采用仓库根的 vite.config.ts
// （根 config 依赖根 node_modules——mcp 单独安装依赖时（Docker/CI/导出仓库）会因此炸掉）
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
