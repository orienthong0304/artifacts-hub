import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    // 集成测试共享同一数据库，文件级串行执行避免互相清库
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
