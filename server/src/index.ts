// 入口：初始化 schema、启动 HTTP 服务（默认 8091）；路由组装见 app.ts
import { serve } from '@hono/node-server';
import { env } from './env.js';
import { initSchema } from './db.js';
import { resolveJwtSecret } from './auth.js';
import { app } from './app.js';

async function main(): Promise<void> {
  // 启动即校验 JWT 密钥配置（生产缺失直接失败）
  resolveJwtSecret();
  await initSchema();
  serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
    console.log(`[server] Artifacts API 已启动: http://${info.address}:${info.port}`);
  });
}

main().catch((err) => {
  console.error('[server] 启动失败:', err);
  process.exit(1);
});
