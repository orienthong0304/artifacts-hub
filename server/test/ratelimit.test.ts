// 滑动窗口限流器单测（注入时钟）
import { describe, it, expect } from 'vitest';
import { SlidingWindowRateLimiter } from '../src/ratelimit.js';

describe('SlidingWindowRateLimiter', () => {
  it('窗口内放行 limit 次，第 limit+1 次拒绝', () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(10, 60_000, () => now);
    for (let i = 0; i < 10; i++) {
      expect(limiter.allow('ip-1')).toBe(true);
    }
    expect(limiter.allow('ip-1')).toBe(false);
  });

  it('不同 key 互不影响', () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(2, 60_000, () => now);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
    expect(limiter.allow('b')).toBe(true);
  });

  it('窗口滑动后旧请求过期，重新放行', () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(3, 60_000, () => now);
    limiter.allow('ip');
    now = 30_000;
    limiter.allow('ip');
    limiter.allow('ip');
    expect(limiter.allow('ip')).toBe(false);
    // 第一条记录（t=0）在 t=60_001 过期，腾出一个名额
    now = 60_001;
    expect(limiter.allow('ip')).toBe(true);
    expect(limiter.allow('ip')).toBe(false);
  });

  it('prune 清理完全过期的 key', () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(5, 60_000, () => now);
    limiter.allow('old');
    now = 120_000;
    limiter.allow('fresh');
    limiter.prune();
    expect(limiter.size).toBe(1);
  });
});
