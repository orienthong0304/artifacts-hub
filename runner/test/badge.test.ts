// 角标文案（契约 §4 / §3.11）
//
// 角标是全站唯一「用户代码无法移除」的位置：它由 runner 在**外层文档**渲染，
// 作品跑在无 allow-same-origin 的内层 iframe 里，够不到它。
// 《人工智能生成合成内容标识办法》第 6 条要求传播平台给生成合成内容加显著提示标识，
// 而「显著且不可移除」正是角标的既有性质——所以标识挂在这里，而不是另起一个可被
// 浮层遮住的元素。
import { describe, it, expect } from 'vitest';
import { badgeText } from '../src/badge';

describe('badgeText', () => {
  it('声明为 AI 生成 → 文案含生成合成内容标识', () => {
    expect(badgeText(true)).toBe('⚡ AI 生成 · 用 Artifacts 制作');
  });

  it('作者声明为非 AI 生成 → 回到原文案，不给非生成内容贴标识', () => {
    expect(badgeText(false)).toBe('⚡ 用 Artifacts 制作');
  });

  it('缺省（旧调用方不传该字段）按 AI 生成处理——漏标的代价大于误标', () => {
    expect(badgeText(undefined)).toBe('⚡ AI 生成 · 用 Artifacts 制作');
  });
});
