// 条款版本与同意记录（契约 §3.4）
import { pool } from './db.js';

/** 当前服务条款/隐私政策版本；发布新版条款时更新此常量并同步 src/app/config.ts 与 /terms /privacy 页面 */
export const TERMS_VERSION = '2026-07-22';

export type ConsentContext = 'register' | 'publish';

/** 支持 query 的执行器：缺省用连接池，传入事务 client 则随事务提交/回滚 */
interface Queryable {
  query: (text: string, params: unknown[]) => Promise<unknown>;
}

/**
 * 幂等写入同意记录：同用户同版本同场景只记一次。
 * 传入 client（pool.connect 得到的连接）时随所在事务提交/回滚；缺省用连接池独立执行。
 */
export async function recordConsent(
  userId: string,
  context: ConsentContext,
  client?: Queryable
): Promise<void> {
  const executor: Queryable = client ?? pool;
  await executor.query(
    `insert into consent_records (user_id, terms_version, context)
     values ($1, $2, $3) on conflict (user_id, terms_version, context) do nothing`,
    [userId, TERMS_VERSION, context]
  );
}
