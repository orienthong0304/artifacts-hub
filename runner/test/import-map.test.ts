// 白名单校验与 import map（契约 §4）
//
// checkImports 此前「命中首个即 return」——W1-2 已改为收集全部越界项并附替代建议，
// 让人类与 Agent 都能一轮改完，而不是「改一个再撞下一个」。
// 相对路径与白名单外分开归类：前者要合并进同一文件或改用 ZIP 站点，后者换个库即可——
// 两类的可操作动作完全不同，不该混在一句话里。
import { describe, it, expect } from 'vitest';
import { checkImports, supportedListText, buildImportMap } from '../src/import-map';
import { VENDOR_PACKAGES, UI_COMPONENTS } from '../vendor.config.mjs';

/** 构造一份与生产同形的 allowed 映射（buildImportMap 依赖 document，此处手工组装） */
function allowedMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pkg of VENDOR_PACKAGES as Array<{ name: string; file: string }>) {
    map[pkg.name] = 'https://run.example/vendor/' + pkg.file;
  }
  map['@/lib/utils'] = 'https://run.example/vendor/lib/utils.js';
  for (const name of UI_COMPONENTS as string[]) {
    map[`@/components/ui/${name}`] = `https://run.example/vendor/ui/${name}.js`;
  }
  return map;
}

const ALLOWED = allowedMap();

describe('checkImports', () => {
  it('全部合法时返回 null', () => {
    expect(checkImports(['react', 'zod', '@/components/ui/button'], ALLOWED)).toBeNull();
  });

  it('相对路径导入被拒，归类 RELATIVE_IMPORT，且提示要合并进同一文件', () => {
    const r = checkImports(['./Button'], ALLOWED)!;
    expect(r.code).toBe('RELATIVE_IMPORT');
    expect(r.message).toContain('相对路径');
    expect(r.message).toContain('单文件');
    expect(r.offenders.map((o) => o.source)).toEqual(['./Button']);
    expect(checkImports(['../lib/x'], ALLOWED)!.code).toBe('RELATIVE_IMPORT');
    expect(checkImports(['/abs/x'], ALLOWED)!.code).toBe('RELATIVE_IMPORT');
  });

  it('白名单外依赖被拒，归类 IMPORT_NOT_ALLOWED，报错里带出可用清单', () => {
    const r = checkImports(['echarts'], ALLOWED)!;
    expect(r.code).toBe('IMPORT_NOT_ALLOWED');
    expect(r.message).toContain('echarts');
    expect(r.message).toContain('当前支持的库');
  });

  it('react 子路径在白名单内（react-dom/client、react/jsx-runtime）', () => {
    expect(ALLOWED['react-dom/client']).toBeTruthy();
    expect(ALLOWED['react/jsx-runtime']).toBeTruthy();
    expect(checkImports(['react-dom/client', 'react/jsx-runtime'], ALLOWED)).toBeNull();
  });

  it('多个越界项一次全部报出（W1-2 核心改动：避免「改一个再撞下一个」的往返）', () => {
    const r = checkImports(['echarts', 'antd', 'axios'], ALLOWED)!;
    expect(r.code).toBe('IMPORT_NOT_ALLOWED');
    expect(r.offenders.map((o) => o.source)).toEqual(['echarts', 'antd', 'axios']);
    // message 里三个都要出现——旧消费方只读 message，不能只看到第一个
    expect(r.message).toContain('echarts');
    expect(r.message).toContain('antd');
    expect(r.message).toContain('axios');
  });

  it('每个越界项带替代建议（确定性映射，零模型调用）', () => {
    const r = checkImports(['echarts', 'antd', 'moment'], ALLOWED)!;
    const byName = Object.fromEntries(r.offenders.map((o) => [o.source, o.suggestion]));
    expect(byName['echarts']).toContain('recharts');
    expect(byName['antd']).toContain('@/components/ui');
    expect(byName['moment']).toContain('date-fns');
  });

  it('子路径导入也能命中建议（lodash-es/debounce 形态）', () => {
    const r = checkImports(['@mui/material/Button'], ALLOWED)!;
    expect(r.offenders[0].suggestion).toContain('@/components/ui');
  });

  it('同一 specifier 重复导入只报一次', () => {
    const r = checkImports(['echarts', 'echarts', 'echarts'], ALLOWED)!;
    expect(r.offenders).toHaveLength(1);
  });

  it('相对路径优先于白名单判定（它的修复动作更结构性）', () => {
    const r = checkImports(['./x', 'echarts'], ALLOWED)!;
    expect(r.code).toBe('RELATIVE_IMPORT');
    expect(r.offenders[0].suggestion).toContain('ZIP 站点');
  });
});

describe('supportedListText', () => {
  it('包名列表部分不含带斜杠的子路径条目（子路径只在括注里以散文提及一次）', () => {
    const text = supportedListText();
    // 「（含 … 等子路径）」之前的顿号列表才是逐项罗列的包名
    const listPart = text.split('（含')[0];
    expect(listPart).toContain('react');
    expect(listPart).toContain('recharts');
    expect(listPart).not.toContain('/');
    // 括注与后半段仍应给出子路径与 shadcn 的可用性说明
    expect(text).toContain('react/jsx-runtime');
    expect(text).toContain('@/lib/utils');
    expect(text).toContain('@/components/ui/');
  });
});

describe('vendor.config 一致性', () => {
  it('VENDOR_PACKAGES 每项都有 name 与 file，且 name 无重复', () => {
    const pkgs = VENDOR_PACKAGES as Array<{ name: string; file: string }>;
    expect(pkgs.length).toBeGreaterThan(0);
    for (const p of pkgs) {
      expect(p.name, JSON.stringify(p)).toBeTruthy();
      expect(p.file, JSON.stringify(p)).toBeTruthy();
    }
    const names = pkgs.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('UI_COMPONENTS 非空且无重复', () => {
    const ui = UI_COMPONENTS as string[];
    expect(ui.length).toBeGreaterThan(0);
    expect(new Set(ui).size).toBe(ui.length);
  });

  it('buildImportMap 是纯映射构造，导出存在（浏览器内依赖 document.baseURI，此处只断言可调用性）', () => {
    expect(typeof buildImportMap).toBe('function');
  });
});
