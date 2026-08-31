// 内存滑动窗口限流（契约：注册/登录 10 次/分/IP）
import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

/**
 * 滑动窗口限流器：为每个 key 记录窗口内的请求时间戳。
 * now 可注入，便于单测。
 */
export class SlidingWindowRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * 尝试放行一次请求：窗口内已达上限返回 false。
   * limit 可按调用覆盖（契约 §3.12：日发布配额随用户档位/覆盖而变），缺省用构造值。
   */
  allow(key: string, limit = this.limit): boolean {
    const t = this.now();
    const cutoff = t - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }

  /** 清理已完全过期的 key，防止内存无限增长 */
  prune(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [key, timestamps] of this.hits) {
      const recent = timestamps.filter((ts) => ts > cutoff);
      if (recent.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, recent);
      }
    }
  }

  /** 当前跟踪的 key 数量（测试用） */
  get size(): number {
    return this.hits.size;
  }
}

/** 取客户端 IP：优先反代注入的 X-Forwarded-For 首个地址，其次 TCP 远端地址 */
export function clientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 生成限流中间件：默认 10 次/分钟/IP，超限返回 429 */
export function rateLimit(
  name: string,
  limit = 10,
  windowMs = 60_000
): MiddlewareHandler {
  const limiter = new SlidingWindowRateLimiter(limit, windowMs);
  // 定期清理过期 key；unref 避免阻塞进程退出
  const timer = setInterval(() => limiter.prune(), windowMs);
  timer.unref?.();
  return async (c, next) => {
    const key = `${name}:${clientIp(c)}`;
    if (!limiter.allow(key)) {
      return c.json({ error: '请求过于频繁，请稍后再试' }, 429);
    }
    await next();
  };
}
