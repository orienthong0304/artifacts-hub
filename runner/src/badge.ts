// 角标文案（契约 §4 / §3.11）
//
// 角标由 runner 在**外层文档**渲染，作品跑在无 allow-same-origin 的内层 iframe 里够不到它
// ——「显著且用户代码不可移除」是它的既有性质，也正是《人工智能生成合成内容标识办法》
// 第 6 条对显著提示标识的要求。所以标识挂在这里，而不是另起一个能被浮层遮住的元素。

/**
 * 缺省（`undefined`）按 AI 生成处理：调用方漏传字段时，漏标一条生成内容的代价
 * 大于给一条非生成内容误标。作者的显式 `false` 才取消标识。
 */
export function badgeText(aiLabel?: boolean): string {
  return aiLabel === false ? '⚡ 用 Artifacts 制作' : '⚡ AI 生成 · 用 Artifacts 制作';
}
