// zip-extract 单元测试（契约 §3.9）：路径穿越 / 顶层目录剥离 / 白名单 / 符号链接 / 计量熔断
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { extractZip, ZipValidationError } from '../src/zip-extract.js';

/** 构造真实 zip：entryName → 内容 */
function makeZip(files: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, typeof content === 'string' ? Buffer.from(content) : content);
  }
  return zip.toBuffer();
}

/**
 * adm-zip 会在 addFile 时归一化掉 ../ 与开头的 /，
 * 构造恶意 entry 名需在成品字节里做同长度替换（local header 与 central directory 各一处）。
 */
function patchEntryName(buf: Buffer, from: string, to: string): Buffer {
  if (from.length !== to.length) throw new Error('替换名必须与占位名等长');
  const fromBytes = Buffer.from(from);
  const toBytes = Buffer.from(to);
  let idx = buf.indexOf(fromBytes);
  while (idx !== -1) {
    toBytes.copy(buf, idx);
    idx = buf.indexOf(fromBytes, idx + 1);
  }
  return buf;
}

const dirs: string[] = [];
function newDest(): string {
  const d = mkdtempSync(join(tmpdir(), 'zip-extract-test-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const LIMITS = {
  maxFiles: 200,
  maxTotalBytes: 30 * 1024 * 1024,
  maxImages: 20,
  maxImageBytes: 5 * 1024 * 1024,
};

/** 造 n 张位图 entry（内容长度可指定），文件名 img-0.png … */
function bitmaps(n: number, bytesEach = 16): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  for (let i = 0; i < n; i++) files[`img-${i}.png`] = Buffer.alloc(bytesEach, 0x41);
  return files;
}

describe('extractZip（契约 §3.9）', () => {
  it('合法 zip：解压落盘，返回 fileCount/totalBytes/hasRootIndex', async () => {
    const dest = newDest();
    const zip = makeZip({
      'index.html': '<h1>hello</h1>',
      'assets/app.css': 'body{color:red}',
    });
    const result = await extractZip(zip, dest, LIMITS);
    expect(result.fileCount).toBe(2);
    expect(result.totalBytes).toBe(
      Buffer.byteLength('<h1>hello</h1>') + Buffer.byteLength('body{color:red}')
    );
    expect(result.hasRootIndex).toBe(true);
    expect(readFileSync(join(dest, 'index.html'), 'utf8')).toBe('<h1>hello</h1>');
    expect(readFileSync(join(dest, 'assets/app.css'), 'utf8')).toBe('body{color:red}');
  });

  it('唯一顶层目录剥离：dist/index.html → index.html，hasRootIndex=true', async () => {
    const dest = newDest();
    const zip = makeZip({
      'dist/index.html': '<h1>dist</h1>',
      'dist/assets/app.js': 'console.log(1)',
    });
    const result = await extractZip(zip, dest, LIMITS);
    expect(result.hasRootIndex).toBe(true);
    expect(readFileSync(join(dest, 'index.html'), 'utf8')).toBe('<h1>dist</h1>');
    expect(existsSync(join(dest, 'assets/app.js'))).toBe(true);
    expect(existsSync(join(dest, 'dist'))).toBe(false);
  });

  it('多个顶层目录不剥离：a/index.html + b/page.html → hasRootIndex=false', async () => {
    const dest = newDest();
    const zip = makeZip({
      'a/index.html': '<h1>a</h1>',
      'b/page.html': '<h1>b</h1>',
    });
    const result = await extractZip(zip, dest, LIMITS);
    expect(result.hasRootIndex).toBe(false);
    expect(existsSync(join(dest, 'a/index.html'))).toBe(true);
  });

  it('路径穿越（../ entry）拒绝', async () => {
    const dest = newDest();
    const zip = patchEntryName(makeZip({ 'AA/evil.html': 'x' }), 'AA/evil.html', '../evil.html');
    await expect(extractZip(zip, dest, LIMITS)).rejects.toThrow(ZipValidationError);
    await expect(extractZip(zip, newDest(), LIMITS)).rejects.toThrow(/路径非法/);
  });

  it('绝对路径 entry 拒绝', async () => {
    const dest = newDest();
    const zip = patchEntryName(makeZip({ 'Xabs.html': 'x' }), 'Xabs.html', '/abs.html');
    await expect(extractZip(zip, dest, LIMITS)).rejects.toThrow(/路径非法/);
  });

  it('符号链接拒绝（externalFileAttributes S_IFLNK）', async () => {
    const dest = newDest();
    const adm = new AdmZip();
    adm.addFile('index.html', Buffer.from('<h1>ok</h1>'));
    adm.addFile('link.html', Buffer.from('target'));
    const entry = adm.getEntries().find((e) => e.entryName === 'link.html')!;
    entry.attr = (0o120755 << 16) >>> 0;
    await expect(extractZip(adm.toBuffer(), dest, LIMITS)).rejects.toThrow(/符号链接/);
  });

  it('扩展名白名单：.php 拒绝并指明文件', async () => {
    const dest = newDest();
    const zip = makeZip({ 'index.html': '<h1>ok</h1>', 'evil.php': '<?php ?>' });
    await expect(extractZip(zip, dest, LIMITS)).rejects.toThrow(/不支持的文件类型.*evil\.php/);
  });

  it('无扩展名文件拒绝', async () => {
    const dest = newDest();
    const zip = makeZip({ 'index.html': '<h1>ok</h1>', LICENSE: 'MIT' });
    await expect(extractZip(zip, dest, LIMITS)).rejects.toThrow(/不支持的文件类型/);
  });

  it('文件数熔断：超过 maxFiles 拒绝', async () => {
    const dest = newDest();
    const zip = makeZip({
      'index.html': '<h1>ok</h1>',
      'a.css': 'a',
      'b.css': 'b',
    });
    await expect(
      extractZip(zip, dest, { maxFiles: 2, maxTotalBytes: LIMITS.maxTotalBytes })
    ).rejects.toThrow(/文件数量超过上限/);
  });

  it('总字节熔断：超过 maxTotalBytes 拒绝并清理已写文件', async () => {
    const dest = newDest();
    const zip = makeZip({
      'index.html': '<h1>ok</h1>',
      'big.txt': 'x'.repeat(200),
    });
    await expect(
      extractZip(zip, dest, { maxFiles: 200, maxTotalBytes: 100 })
    ).rejects.toThrow(/解压后总大小超过限制/);
    // 熔断后清理：目标目录内不残留任何已解压文件
    expect(existsSync(join(dest, 'index.html'))).toBe(false);
    expect(existsSync(join(dest, 'big.txt'))).toBe(false);
  });

  it('声称大小与实际字节不符：转中文校验错误（400 而非 500）', async () => {
    const dest = newDest();
    const zip = makeZip({ 'index.html': `<h1>${'内容 '.repeat(50)}</h1>` });
    // central directory 头（PK\x01\x02）偏移 24 处为 uncompressedSize：改小 →
    // yauzl validateEntrySizes 的 AssertByteCountStream 抛 "too many bytes" 普通 Error
    const cdIdx = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(cdIdx).toBeGreaterThan(-1);
    zip.writeUInt32LE(1, cdIdx + 24);
    await expect(extractZip(zip, dest, LIMITS)).rejects.toThrow(ZipValidationError);
    const dest2 = newDest();
    const zip2 = makeZip({ 'index.html': `<h1>${'内容 '.repeat(50)}</h1>` });
    zip2.writeUInt32LE(1, zip2.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
    await expect(extractZip(zip2, dest2, LIMITS)).rejects.toThrow(/ZIP 文件损坏或声称大小不符/);
  });

  it('非 zip 内容：中文解析错误', async () => {
    const dest = newDest();
    await expect(extractZip(Buffer.from('not a zip'), dest, LIMITS)).rejects.toThrow(
      /ZIP 文件解析失败/
    );
  });
});

describe('图片结构性上限（契约 §3.9，2026-08-28 增补：把「不做图床」从条款软约束变成代码硬约束）', () => {
  it('位图张数超上限 → 中文校验错误，指明具体上限', async () => {
    const dest = newDest();
    const zip = makeZip({ 'index.html': '<h1>x</h1>', ...bitmaps(21) });
    await expect(extractZip(zip, dest, LIMITS)).rejects.toThrow(/图片数量超过上限（20 张）/);
  });

  it('位图总体积超上限 → 中文校验错误（张数未超也拦）', async () => {
    const dest = newDest();
    // 3 张 × 2MB = 6MB > 5MB，而张数 3 远未触及 20
    const zip = makeZip({ 'index.html': '<h1>x</h1>', ...bitmaps(3, 2 * 1024 * 1024) });
    await expect(extractZip(zip, dest, LIMITS)).rejects.toThrow(/图片总大小超过限制（5MB）/);
  });

  it('上限内的位图正常解压——阈值本身不误伤（20 张恰好放行）', async () => {
    const dest = newDest();
    const zip = makeZip({ 'index.html': '<h1>x</h1>', ...bitmaps(20) });
    const result = await extractZip(zip, dest, LIMITS);
    expect(result.fileCount).toBe(21);
    expect(existsSync(join(dest, 'img-19.png'))).toBe(true);
  });

  it('svg 与 ico 不计入图片配额——它们是图标与矢量资源，不是图床载荷', async () => {
    const dest = newDest();
    const icons: Record<string, string> = { 'index.html': '<h1>x</h1>' };
    for (let i = 0; i < 30; i++) icons[`icon-${i}.svg`] = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    icons['favicon.ico'] = 'x';
    const result = await extractZip(makeZip(icons), dest, LIMITS);
    expect(result.fileCount).toBe(32);
  });
});
