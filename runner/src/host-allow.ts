// 父窗口 origin 白名单判定（能力波次 1 · W1-2；OS-3 参数化抽出）
//
// 为什么参数化：此前 HOST_SUFFIX/HOST_EXACT 写死生产域埋在 main.ts 里——自托管者
// 换域后主站 postMessage 会被 runner 直接拒绝，全站不渲染且无报错指向这里
// （dual-track roadmap OS-3 点名的两处「换域即挂」之一）。
//
// 放行规则（必须覆盖全部合法嵌入方，否则等于把渲染打坏）：
//  - https://<mainHost> 与任意 https://<sub>.<mainHost>（子域 shell 就地渲染，契约 §3.10）
//  - 开发环境 http://localhost:* 与 http://127.0.0.1:*
//  - origin 为 "null" 或空：opaque origin 的嵌入方（srcdoc / 沙箱页）无法给出 origin，
//    放行以保持既有路径——白名单收紧的是「可命名的第三方站点」。

/** 主域（不带协议），构建期由 VITE_MAIN_HOST 注入；缺省保持生产域（SaaS 零影响） */
export const MAIN_HOST: string =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_MAIN_HOST ||
  "artifacts.orienthong.cn";

export function isAllowedHost(origin: string | undefined, mainHost: string = MAIN_HOST): boolean {
  // opaque / 未知 origin：维持既有行为（见上方注释），不在收紧范围内
  if (!origin || origin === "null") return true;
  try {
    const u = new URL(origin);
    if (u.protocol === "https:" && (u.hostname === mainHost || u.hostname.endsWith(`.${mainHost}`))) {
      return true;
    }
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
