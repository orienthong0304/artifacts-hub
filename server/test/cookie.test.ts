// __Host- cookie 命名规则单测（契约 §3：生产前缀化，开发保持旧名）
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { cookieNameFor, subSessionCookieNameFor, LEGACY_COOKIE_NAME } from '../src/auth.js';

describe('cookieNameFor', () => {
  it('生产使用 __Host- 前缀', () => {
    expect(cookieNameFor(true)).toBe('__Host-artifacts_token');
  });
  it('开发保持旧名（http 环境无法满足 __Host- 的 Secure 要求）', () => {
    expect(cookieNameFor(false)).toBe('artifacts_token');
  });
  it('旧名常量仅用于登出清除（兼容读取已于 2026-07-26 移除）', () => {
    expect(LEGACY_COOKIE_NAME).toBe('artifacts_token');
  });
});

describe('subSessionCookieNameFor（契约 §3.10）', () => {
  it('生产使用 __Host- 前缀：该 cookie 只应对签发它的那一个子域生效', () => {
    expect(subSessionCookieNameFor(true)).toBe('__Host-sub_session');
  });
  it('开发保持旧名', () => {
    expect(subSessionCookieNameFor(false)).toBe('sub_session');
  });
});

describe('__Host- cookie 删除头', () => {
  it('deleteCookie 带 secure 时输出 Secure 属性（__Host- 删除头的浏览器强制要求）', async () => {
    const app = new Hono();
    app.post('/logout', (c) => {
      deleteCookie(c, '__Host-artifacts_token', { path: '/', secure: true });
      return c.json({ ok: true });
    });
    const res = await app.request('/logout', { method: 'POST' });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('__Host-artifacts_token=;');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Max-Age=0');
  });
});
