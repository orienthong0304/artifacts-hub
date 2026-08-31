// 父窗口 origin 白名单（能力波次 1 · W1-2；OS-3 参数化）
//
// 此前 HOST_SUFFIX/HOST_EXACT 写死生产域并埋在 main.ts 里：自托管者换域后，
// 主站的 postMessage 会被 runner 直接拒绝 → 全站不渲染，且没有任何报错指向这里。
// 抽为纯函数 + 构建期 VITE_MAIN_HOST 注入，缺省保持生产域（SaaS 零影响）。
import { describe, it, expect } from 'vitest';
import { isAllowedHost } from '../src/host-allow';

const HOST = 'artifacts.orienthong.cn';

describe('isAllowedHost（默认主域）', () => {
  it('主站与任意用户子域放行；无关站点拒绝', () => {
    expect(isAllowedHost(`https://${HOST}`, HOST)).toBe(true);
    expect(isAllowedHost(`https://someone.${HOST}`, HOST)).toBe(true);
    expect(isAllowedHost('https://evil.example.com', HOST)).toBe(false);
    // 后缀伪造：evilartifacts.orienthong.cn 不是子域
    expect(isAllowedHost(`https://evil${HOST}`, HOST)).toBe(false);
  });

  it('opaque/未知 origin 放行（srcdoc/沙箱页既有路径）；localhost 开发放行', () => {
    expect(isAllowedHost(undefined, HOST)).toBe(true);
    expect(isAllowedHost('null', HOST)).toBe(true);
    expect(isAllowedHost('http://localhost:5173', HOST)).toBe(true);
    expect(isAllowedHost('http://127.0.0.1:4000', HOST)).toBe(true);
  });

  it('换域即生效（OS-3 的核心诉求）：自托管域的主站与子域放行，原生产域反而拒绝', () => {
    expect(isAllowedHost('https://pages.example.dev', 'pages.example.dev')).toBe(true);
    expect(isAllowedHost('https://u1.pages.example.dev', 'pages.example.dev')).toBe(true);
    expect(isAllowedHost(`https://${HOST}`, 'pages.example.dev')).toBe(false);
  });

  it('http 的非 localhost 主域拒绝——白名单只认 https（防降级）', () => {
    expect(isAllowedHost(`http://${HOST}`, HOST)).toBe(false);
  });
});
