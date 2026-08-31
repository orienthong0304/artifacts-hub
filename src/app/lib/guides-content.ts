/**
 * 使用指南内容（/guides 与 /guides/:slug 的数据源）
 * 面向零部署经验的读者：步骤对应真实产品流程（粘贴代码 → 发布 → 分享面板）。
 *
 * 数据体已抽到 ./guides-data.json —— 供构建期预渲染脚本
 * （scripts/prerender-guides.mjs）与本模块共享同一份内容，避免双写漂移。
 * 新增指南：在 guides-data.json 追加一项，并同步 public/sitemap.xml。
 */
import guidesData from './guides-data.json';

export interface GuideStep {
  title: string;
  body: string;
}

export interface GuideFaq {
  q: string;
  a: string;
}

export interface Guide {
  slug: string;
  title: string;
  intro: string;
  steps: GuideStep[];
  faq: GuideFaq[];
}

export const GUIDES: Guide[] = guidesData as Guide[];

/** 按 slug 查找指南（未找到返回 undefined，详情页据此渲染 404 卡片） */
export function findGuide(slug: string | undefined): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
