// 路由组装（无启动副作用，供 index.ts 启动与集成测试直接调用）
import { Hono } from 'hono';
import { type AuthVariables, attachUser } from './auth.js';
import { csrfGuard } from './csrf.js';
import { authRouter, meRouter } from './routes/auth.js';
import { artifactsRouter } from './routes/artifacts.js';
import { versionsRouter } from './routes/versions.js';
import { tempLinksRouter } from './routes/temp-links.js';
import { tokensRouter } from './routes/tokens.js';
import { sitesRouter } from './routes/sites.js';
import { adminRouter } from './routes/admin.js';
import { subdomainGate, subauthRouter } from './routes/serve.js';
import { createMcpRouter } from './routes/mcp.js';

export const app = new Hono<{ Variables: AuthVariables }>();

// 子域网关（契约 §3.10）：最先挂载——子域请求不进任何主站 API 面（含 csrfGuard/attachUser）
app.use('*', subdomainGate);

// Origin 校验（契约 §3 安全注记）拦同 eTLD 子域 CSRF；挂在 attachUser 之前——纯请求头判定，
// 不依赖用户状态，且状态变更请求应在解析/使用登录态之前就被来源门挡下。
app.use('/api/*', csrfGuard);

// 所有 /api 路由先尝试解析登录态（可选鉴权，具体路由再按需 requireAuth/requireAdmin）
app.use('/api/*', attachUser);

// 健康检查（部署探活用）
app.get('/api/health', (c) => c.json({ ok: true }));

app.route('/api/auth', authRouter);
app.route('/api', meRouter);
app.route('/api', artifactsRouter);
app.route('/api', versionsRouter);
app.route('/api', tempLinksRouter);
app.route('/api', tokensRouter);
app.route('/api', subauthRouter);
app.route('/api', sitesRouter);
app.route('/api/admin', adminRouter);
// MCP Streamable HTTP 端点（契约 §3.13）：getApp 注入避免循环依赖
app.route('/api', createMcpRouter(() => app));

app.notFound((c) => c.json({ error: '接口不存在' }, 404));

app.onError((err, c) => {
  console.error('[server] 未捕获错误:', err);
  return c.json({ error: '服务器内部错误' }, 500);
});
