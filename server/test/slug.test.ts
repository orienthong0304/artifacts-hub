// slug 生成单测
import { describe, it, expect } from 'vitest';
import {
  generateApiToken,
  generateSlug,
  generateTempToken,
  SLUG_ALPHABET,
  SLUG_LENGTH,
  TEMP_TOKEN_LENGTH,
} from '../src/slug.js';

describe('generateSlug', () => {
  it('长度固定 8 位', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateSlug()).toHaveLength(SLUG_LENGTH);
    }
  });

  it('只包含 url-safe 字符', () => {
    const allowed = new Set(SLUG_ALPHABET.split(''));
    for (let i = 0; i < 100; i++) {
      for (const ch of generateSlug()) {
        expect(allowed.has(ch)).toBe(true);
      }
    }
  });

  it('多次生成基本不重复', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateSlug());
    expect(seen.size).toBe(1000);
  });
});

describe('generateApiToken（契约 §3.8）', () => {
  it('格式为 ak_ + 32 位 url-safe', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateApiToken()).toMatch(/^ak_[0-9a-zA-Z_-]{32}$/);
    }
  });

  it('多次生成基本不重复', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateApiToken());
    expect(seen.size).toBe(1000);
  });
});

describe('generateTempToken（契约 §3.6）', () => {
  it('长度固定 16 位且 url-safe', () => {
    for (let i = 0; i < 100; i++) {
      const token = generateTempToken();
      expect(token).toHaveLength(TEMP_TOKEN_LENGTH);
      expect(token).toMatch(/^[0-9a-zA-Z_-]{16}$/);
    }
  });

  it('多次生成基本不重复', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateTempToken());
    expect(seen.size).toBe(1000);
  });
});
