// 转译与 import 收集（契约 §4）
//
// 为什么这个文件必须存在：runner 是全站唯一「回归 = 所有作品同时不渲染」的组件，
// 而在本文件之前它有零个测试。transpileReact 里的两处设计尤其脆弱且难在浏览器里复现：
//   ① import 必须在 Program enter 阶段收集——preset-typescript 会在它自己的 Program 阶段
//      删除「未使用」的 import（当作潜在类型导入），若改用 ImportDeclaration 访问器，
//      未使用的白名单外 import 会静默漏检 → 越界依赖被放行。
//   ② export 改写要覆盖具名/匿名/表达式三种 default 形态，漏一种就是「未检测到 default export」。
import { describe, it, expect } from 'vitest';
import { transpileReact, TranspileError } from '../src/transpile';

describe('transpileReact · import 收集', () => {
  it('收集全部 import 来源，含 export-from 与 export-all', () => {
    const { imports } = transpileReact(`
      import React from 'react';
      import { z } from 'zod';
      export { helper } from 'lodash';
      export * from 'date-fns';
      export default function App() { return <div>{String(z)}{String(React)}</div>; }
    `);
    expect(imports).toContain('react');
    expect(imports).toContain('zod');
    expect(imports).toContain('lodash');
    expect(imports).toContain('date-fns');
  });

  it('未被使用的 import 也必须收集到——preset-typescript 会删掉它，漏检即等于放行越界依赖', () => {
    // echarts 导入后完全没用到：若收集逻辑依赖 ImportDeclaration 访问器就会漏掉
    const { imports } = transpileReact(`
      import echarts from 'echarts';
      export default function App() { return <div>hi</div>; }
    `);
    expect(imports).toContain('echarts');
  });

  it('type-only import 不计入白名单校验（它在运行时不存在）', () => {
    const { imports } = transpileReact(`
      import type { Foo } from 'some-types-only-pkg';
      export default function App() { return <div>ok</div>; }
    `);
    expect(imports).not.toContain('some-types-only-pkg');
  });
});

describe('transpileReact · default export 检测与改写', () => {
  it.each([
    ['具名函数', 'export default function App() { return <div>a</div>; }'],
    ['匿名函数', 'export default function () { return <div>b</div>; }'],
    ['箭头表达式', 'const A = () => <div>c</div>; export default A;'],
    ['类声明', 'export default class App { render() { return null; } }'],
  ])('%s 形态都能识别并挂到 globalThis.__ARTIFACT_DEFAULT__', (_label, src) => {
    const r = transpileReact(src);
    expect(r.hasDefaultExport).toBe(true);
    expect(r.code).toContain('__ARTIFACT_DEFAULT__');
    // 产物不得残留 export 语句——它会与内联 <script type="module"> 的拼接方式冲突
    expect(r.code).not.toMatch(/^\s*export\s/m);
  });

  it('无 default export 时 hasDefaultExport 为 false（调用方据此报中文错误）', () => {
    const r = transpileReact(`export const A = () => <div>x</div>;`);
    expect(r.hasDefaultExport).toBe(false);
  });

  it('export const / export function 保留声明本体，只去掉 export 关键字', () => {
    const r = transpileReact(`
      export const VALUE = 42;
      export function helper() { return VALUE; }
      export default function App() { return <div>{helper()}</div>; }
    `);
    expect(r.code).toContain('VALUE');
    expect(r.code).toContain('helper');
    expect(r.code).not.toMatch(/^\s*export\s/m);
  });
});

describe('transpileReact · 语法错误', () => {
  it('语法错误抛 TranspileError 且保留原始报错文本', () => {
    // 第 3 行缺一个右括号
    const bad = `export default function App() {\n  const x = 1;\n  return <div>{x</div>;\n}`;
    let caught: unknown;
    try {
      transpileReact(bad);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TranspileError);
    expect((caught as Error).message).toContain('代码转译失败');
  });

  it('TypeScript 类型语法可正常转译（用户粘的是 .tsx）', () => {
    const r = transpileReact(`
      interface Props { name: string }
      const A: React.FC<Props> = ({ name }) => <div>{name}</div>;
      export default A;
    `);
    expect(r.hasDefaultExport).toBe(true);
    expect(r.code).not.toContain('interface');
  });
});
