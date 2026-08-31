// 敏感词扫描单测（契约 §3.3）
import { describe, it, expect } from 'vitest';
import { parseWordList, scanText } from '../src/moderation.js';

describe('parseWordList', () => {
  it('跳过空行与注释，去重并小写化', () => {
    const words = parseWordList('# 注释\n\nFooBar\nfoobar\n词甲\n  词乙  \n');
    expect(words).toEqual(['foobar', '词甲', '词乙']);
  });
});

describe('scanText', () => {
  const words = ['badword', '违禁词'];
  it('命中返回敏感词（大小写不敏感）', () => {
    expect(scanText('This has a BadWord inside', words)).toBe('badword');
  });
  it('中文子串命中', () => {
    expect(scanText('标题里有违禁词出现', words)).toBe('违禁词');
  });
  it('未命中返回 null', () => {
    expect(scanText('干净的内容', words)).toBeNull();
    expect(scanText('', words)).toBeNull();
  });
});
