// 访问日计数埋点（契约 §3.5）：聚合计数，不记录任何访客网络标识
import { pool } from './db.js';

/** upsert 当日访问计数；失败只记日志，绝不影响详情响应 */
export async function recordDailyView(artifactId: string): Promise<void> {
  try {
    await pool.query(
      `insert into artifact_view_daily (artifact_id, day, views)
       values ($1, current_date, 1)
       on conflict (artifact_id, day) do update set views = artifact_view_daily.views + 1`,
      [artifactId]
    );
  } catch (err) {
    console.error('[stats] 访问日计数写入失败:', err);
  }
}
