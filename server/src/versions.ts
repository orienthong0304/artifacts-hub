// 版本快照（契约 §3.7）：内容落库后自动记版本，每作品保留最近 20 版
import { pool } from './db.js';

/** 每作品保留的最大版本数（契约 §3.7） */
export const MAX_VERSIONS_PER_ARTIFACT = 20;

/**
 * 记一个新版本：version = 当前最大 + 1（unique 冲突重试一次），插入后裁剪最旧。
 * 快照是增值能力（契约 §3.7 容错语义）：任何失败仅 console.error，绝不抛出影响主流程。
 */
export async function snapshotVersion(
  artifactId: string,
  content: { title: string; description: string | null; code: string }
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await pool.query(
        `insert into artifact_versions (artifact_id, version, title, description, code)
         values (
           $1,
           (select coalesce(max(version), 0) + 1 from artifact_versions where artifact_id = $1),
           $2, $3, $4
         )`,
        [artifactId, content.title, content.description, content.code]
      );
      // 裁剪：只留最近 MAX_VERSIONS_PER_ARTIFACT 版（按 version 序）
      await pool.query(
        `delete from artifact_versions
         where artifact_id = $1
           and version <= (select max(version) from artifact_versions where artifact_id = $1) - $2`,
        [artifactId, MAX_VERSIONS_PER_ARTIFACT]
      );
      return;
    } catch (err) {
      const pgErr = err as { code?: string };
      // 并发导致 (artifact_id, version) 唯一冲突：重试一次
      if (pgErr.code === '23505' && attempt === 0) continue;
      console.error('[versions] 版本快照失败（不影响主流程）:', err);
      return;
    }
  }
}
