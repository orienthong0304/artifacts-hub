/** 时间与数字展示工具 */

/** 相对时间：刚刚 / n 分钟前 / n 小时前 / n 天前 / 具体日期 */
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return '刚刚';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`;
  if (diffMs < 30 * day) return `${Math.floor(diffMs / day)} 天前`;
  return formatDate(iso);
}

/** 完整日期：2026年7月20日 */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' }).format(date);
}

/** 完整日期时间：2026年7月22日 14:30（临时链接到期时间等场景） */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

/**
 * 临时链接到期：**绝对时间在前，剩余时长在后**（能力波次 2 · W2-4）。
 *
 * 此前只给「7 天后失效」。作者要把链接连同截止时间一起发给客户时，
 * 得自己去算那是几号；第二天再打开又变成「6 天后失效」，同一条链接每天换个说法，
 * 没有一个可以复述的截止点。绝对时间才是能写进消息里的东西。
 *
 * 形如：`8月3日 14:30 失效（还有 7 天）`
 */
export function formatExpiry(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return '已过期';

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const rest =
    diffMs < hour
      ? `还有 ${Math.max(1, Math.floor(diffMs / minute))} 分钟`
      : diffMs < day
        ? `还有 ${Math.floor(diffMs / hour)} 小时`
        : `还有 ${Math.floor(diffMs / day)} 天`;

  const sameYear = date.getFullYear() === new Date().getFullYear();
  const absolute = new Intl.DateTimeFormat('zh-CN', {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);

  return `${absolute} 失效（${rest}）`;
}

/** 浏览量：1.2k / 3.4w */
export function formatViews(views: number): string {
  if (views >= 10000) return `${(views / 10000).toFixed(1).replace(/\.0$/, '')}w`;
  if (views >= 1000) return `${(views / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(views);
}
