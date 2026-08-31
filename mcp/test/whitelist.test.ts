// 白名单单点生成的一致性守卫（能力波次 1 · W1-5）
//
// 白名单此前在四处各有一份（runner/vendor.config.mjs、runner 的 supportedListText、
// guides-data.json、契约文档）——四份不可能长期一致。现在 mcp 侧改为由
// scripts/gen-whitelist.mjs 从 vendor.config.mjs 生成，本文件守住「生成物没过期」。
//
// 改白名单后忘了重新生成 → 这里失败，而不是等 Agent 拿着过期清单写出发布不了的代码。
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WHITELIST_PACKAGES,
  UI_COMPONENTS,
  PLATFORM_RULES,
  whitelistSummary,
} from '../src/generated/whitelist.js';
import { platformCapabilitiesText } from '../src/tools.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('白名单生成物与 vendor.config.mjs 一致', () => {
  it('gen-whitelist --check 通过（生成物未过期）', () => {
    // --check 不写文件；不一致时非零退出，execFileSync 会抛
    const out = execFileSync('node', ['scripts/gen-whitelist.mjs', '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(out).toContain('一致');
  });

  it('逐项比对 vendor.config.mjs 的 VENDOR_PACKAGES 与 UI_COMPONENTS', async () => {
    const cfg = await import(/* @vite-ignore */ `file://${ROOT}/runner/vendor.config.mjs`);
    const configNames = (cfg.VENDOR_PACKAGES as { name: string }[]).map((p) => p.name);
    expect(WHITELIST_PACKAGES.map((p) => p.name)).toEqual(configNames);
    expect(UI_COMPONENTS).toEqual(cfg.UI_COMPONENTS);
  });
});

describe('白名单内容基本形状', () => {
  it('非空，且主要包带版本号', () => {
    expect(WHITELIST_PACKAGES.length).toBeGreaterThan(10);
    const byName = Object.fromEntries(WHITELIST_PACKAGES.map((p) => [p.name, p]));
    for (const name of ['react', 'recharts', 'lucide-react', 'zod']) {
      expect(byName[name], name).toBeTruthy();
      expect(byName[name].version, `${name} 缺版本号`).toMatch(/^\d+\./);
    }
  });

  it('子路径条目标记正确，且不进展示清单', () => {
    const sub = WHITELIST_PACKAGES.filter((p) => p.subpath).map((p) => p.name);
    expect(sub).toContain('react/jsx-runtime');
    expect(sub).toContain('react-dom/client');
    const summary = whitelistSummary();
    // 摘要里主包逐项罗列，子路径只在括注中散文提及一次
    const listPart = summary.split('（含')[0];
    expect(listPart).toContain('react');
    expect(listPart).not.toContain('react/jsx-runtime');
  });

  it('UI 组件清单非空且无重复', () => {
    expect(UI_COMPONENTS.length).toBeGreaterThan(20);
    expect(new Set(UI_COMPONENTS).size).toBe(UI_COMPONENTS.length);
  });

  it('硬约束覆盖 Agent 最容易踩的四条', () => {
    const all = PLATFORM_RULES.join('\n');
    expect(all).toContain('单文件');
    expect(all).toContain('export default');
    expect(all).toContain('500KB');
    expect(all).toContain('localStorage');
  });
});

describe('platformCapabilitiesText（get_platform_capabilities 的出参）', () => {
  it('含类型、约束、带版本的依赖清单与 shadcn 组件', () => {
    const t = platformCapabilitiesText();
    expect(t).toContain('react：单文件 React 组件');
    expect(t).toContain('html：完整 HTML 文档');
    expect(t).toContain('recharts@');
    expect(t).toContain('@/components/ui/<name>');
    expect(t).toContain('@/lib/utils');
    // 硬约束逐条在
    for (const r of PLATFORM_RULES) expect(t).toContain(r);
  });

  it('不含子路径条目的独立行（它们随主包，单列会让 Agent 以为要分别 import）', () => {
    const t = platformCapabilitiesText();
    expect(t).not.toContain('- react/jsx-runtime@');
    expect(t).not.toContain('- react-dom/client@');
  });
});
