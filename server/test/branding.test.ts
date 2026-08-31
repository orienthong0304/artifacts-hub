// 公示常量一致性（计划 W1-6 / W1-8）
//
// 为什么需要这个测试：公示信息有两份副本——前端 `src/app/config.ts`（页脚、/contact、
// /privacy、/terms）与服务端 `server/src/branding.ts`（子域直出的 404/403 页）。
// 服务端无法引用前端构建产物，副本不可避免；但两处漂移会让页脚公示与子域页公示
// 互相矛盾，而这类不一致没人会主动去比对。用测试锁住。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PRODUCT_NAME,
  ICP_NUMBER,
  OPERATOR_NAME,
  CONTACT_EMAIL,
  OPERATOR_LABEL,
} from '../src/branding.js';

/** 从前端 config.ts 源码里抽取字符串常量（前端不参与服务端构建，只能读源文件） */
function readFrontendConstant(name: string): string {
  const source = readFileSync(
    resolve(import.meta.dirname, '../../src/app/config.ts'),
    'utf8'
  );
  // OS-3 参数化后常量形如 `export const X = import.meta.env.VITE_X ?? '默认值';`
  // 一致性断言比对的是**默认值**——env 覆盖属部署者自担（两端各自注入）
  const match = new RegExp(
    `export const ${name} = (?:[^=;]*\\?\\? )?'([^']*)';`
  ).exec(source);
  if (!match) throw new Error(`src/app/config.ts 中未找到常量 ${name} 的默认值`);
  return match[1];
}

describe('公示常量与前端 config.ts 保持一致', () => {
  it.each([
    ['PRODUCT_NAME', PRODUCT_NAME],
    ['ICP_NUMBER', ICP_NUMBER],
    ['OPERATOR_NAME', OPERATOR_NAME],
    ['CONTACT_EMAIL', CONTACT_EMAIL],
  ])('%s 两处相同', (name, serverValue) => {
    expect(readFrontendConstant(name)).toBe(serverValue);
  });
});

// 公示完整性是「配置了就必须自洽 + 本站生产必须配置」的检查：
// OPERATOR_NAME 为空（开源自托管默认形态）时整段跳过——页面已做空值隐藏
describe.skipIf(OPERATOR_NAME === '')('公示信息完整性', () => {
  it('运营主体已填写——留空只是不损坏页面，不满足 PIPL 第 17 条的公示名称要求', () => {
    expect(OPERATOR_NAME).not.toBe('');
    // 退化分支（以备案号作标识）不应再出现在生产公示中
    expect(OPERATOR_LABEL).toBe(OPERATOR_NAME);
    expect(OPERATOR_LABEL).not.toContain('备案主体');
  });

  it('联系邮箱是可用形状', () => {
    expect(CONTACT_EMAIL).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });

  it('备案号形如 省ICP备…号', () => {
    expect(ICP_NUMBER).toMatch(/ICP备\d+号/);
  });
});
