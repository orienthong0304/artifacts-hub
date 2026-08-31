// 敏感词扫描（契约 §3.3）：词表每行一词，# 开头为注释；未配置路径时回退仓库示例词表
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
import { chunkText, moderateChunk, type RiskLevel } from './aliyun-green.js';

/** 解析词表文本 → 去重小写词数组 */
export function parseWordList(content: string): string[] {
  const words = new Set<string>();
  for (const line of content.split('\n')) {
    const w = line.trim().toLowerCase();
    if (!w || w.startsWith('#')) continue;
    words.add(w);
  }
  return [...words];
}

/** 扫描文本：返回首个命中的敏感词（大小写不敏感子串匹配），未命中返回 null */
export function scanText(text: string, words: string[]): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const w of words) {
    if (lower.includes(w)) return w;
  }
  return null;
}

let cachedWords: string[] | null = null;

/** 读取词表（进程内缓存）：优先 SENSITIVE_WORDS_PATH，缺省回退仓库示例词表 */
function getSensitiveWords(): string[] {
  if (cachedWords) return cachedWords;
  const examplePath = fileURLToPath(new URL('../sensitive-words.example.txt', import.meta.url));
  const path = env.SENSITIVE_WORDS_PATH || examplePath;
  if (!existsSync(path)) {
    console.warn(`[moderation] 敏感词词表不存在（${path}），扫描放行全部内容`);
    cachedWords = [];
    return cachedWords;
  }
  if (!env.SENSITIVE_WORDS_PATH) {
    console.warn('[moderation] 未设置 SENSITIVE_WORDS_PATH，使用仓库示例词表（生产请挂载真实词表）');
  }
  cachedWords = parseWordList(readFileSync(path, 'utf8'));
  return cachedWords;
}

/** 作品字段闸门：任一字段命中敏感词返回 true；MODERATION_MODE=off 恒 false */
export function violatesPolicy(fields: Array<string | null | undefined>): boolean {
  if (env.MODERATION_MODE === 'off') return false;
  const words = getSensitiveWords();
  if (words.length === 0) return false;
  return fields.some((f) => f != null && scanText(f, words) !== null);
}

/** 云端机审结论：disabled=未配置密钥；unavailable=调用失败（降级转人工） */
export type CloudVerdict = 'pass' | 'review' | 'reject' | 'disabled' | 'unavailable';

/** 云端机审是否已配置（batch-visibility 等不实际送审的路径也需要知道，以决定回退闸门） */
export function cloudModerationEnabled(): boolean {
  return !!(env.ALIYUN_AK_ID && env.ALIYUN_AK_SECRET);
}

/** 风险等级集合 → 处置（契约 §3.3）：high 拒绝；medium 转人工；low/none 放行 */
export function verdictFromRiskLevels(levels: RiskLevel[]): 'pass' | 'review' | 'reject' {
  if (levels.includes('high')) return 'reject';
  if (levels.includes('medium')) return 'review';
  return 'pass';
}

/** 云端机审整篇内容：分块全量送审，批次并发 10，任一 high 提前终止 */
export async function cloudModerate(
  fields: Array<string | null | undefined>
): Promise<CloudVerdict> {
  if (env.MODERATION_MODE === 'off') return 'disabled';
  if (!cloudModerationEnabled()) return 'disabled';
  const chunks = fields.filter((f): f is string => !!f).flatMap((f) => chunkText(f));
  if (chunks.length === 0) return 'pass';
  try {
    // 整体预算 15s：超时按待人工处理（unavailable → public 强制 pending），不无限阻塞请求
    const deadline = Date.now() + 15_000;
    const levels: RiskLevel[] = [];
    const BATCH = 10;
    for (let i = 0; i < chunks.length; i += BATCH) {
      if (Date.now() > deadline) return 'unavailable';
      const batch = await Promise.all(chunks.slice(i, i + BATCH).map((c) => moderateChunk(c)));
      levels.push(...batch);
      if (levels.includes('high')) break;
    }
    return verdictFromRiskLevels(levels);
  } catch (err) {
    console.error('[moderation] 云端机审失败（本次按待人工处理）:', err);
    return 'unavailable';
  }
}

/**
 * PUT 更新的云审字段选择（契约 §3.3）：
 * - pending 作品：对**合并后全量内容**重审（未改字段取库中现值），防局部/空 PUT 洗白；
 * - 转 public（含内容未变的纯可见性切换）：同样合并后全量重审——非公开保存不设广场门，
 *   medium 内容可带着 approved 状态存在，上广场必须以云审结论为依据（契约 §3.3 转公开补审）；
 * - 其余情形内容变更：仅送审变更字段；
 * - 内容未变且不转 public（仅改密码/降可见性）：返回 null，无需云审。
 * 管理员跳过由路由层处理。
 */
export function selectModerationFields(
  current: {
    review_status: string;
    visibility: string;
    title: string;
    description: string | null;
    code: string;
  },
  patch: { title?: string; description?: string | null; code?: string; visibility?: string }
): { fields: Array<string | null | undefined>; full: boolean } | null {
  const becomesPublic = patch.visibility === 'public' && current.visibility !== 'public';
  if (current.review_status === 'pending' || becomesPublic) {
    return {
      fields: [
        patch.title ?? current.title,
        patch.description === undefined ? current.description : patch.description,
        patch.code ?? current.code,
      ],
      full: true,
    };
  }
  const contentChanged =
    patch.title !== undefined || patch.description !== undefined || patch.code !== undefined;
  if (!contentChanged) return null;
  return { fields: [patch.title, patch.description, patch.code], full: false };
}

/**
 * 统一的审核状态判定（契约 §3.3，2026-07-27 修订：机审 pass 即 approved，取消新账号人工首审门）。
 * review/unavailable 转人工（trusted 也不豁免）；disabled 无机审依据，回退 trusted 闸门。
 */
export function resolveReviewStatus(opts: {
  visibility: string;
  isAdmin: boolean;
  isTrusted: boolean;
  cloud: CloudVerdict;
}): 'approved' | 'pending' {
  // off（开源单用户模式）：没有「转人工」的人，一律 approved
  if (env.MODERATION_MODE === 'off') return 'approved';
  if (opts.visibility !== 'public' || opts.isAdmin) return 'approved';
  if (opts.cloud === 'review' || opts.cloud === 'unavailable') return 'pending';
  if (opts.cloud === 'pass') return 'approved';
  return opts.isTrusted ? 'approved' : 'pending';
}
