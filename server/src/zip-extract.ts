// ZIP 站点安全解压（契约 §3.9，核心安全模块，纯逻辑可测）
// 防护：路径穿越 / 绝对路径 / 符号链接 / 扩展名白名单 / zip 炸弹（声称值与实际写入双重计量熔断）
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';

/** ZIP 文件本体上限：10MB（路由层校验） */
export const SITE_ZIP_MAX_BYTES = 10 * 1024 * 1024;

export interface ZipLimits {
  /** 文件数上限 */
  maxFiles: number;
  /** 解压后总字节上限 */
  maxTotalBytes: number;
  /** 位图张数上限 */
  maxImages: number;
  /** 位图总字节上限 */
  maxImageBytes: number;
}

/** 站点默认限额（契约 §3.9）：≤200 个文件、解压后 ≤30MB、位图 ≤20 张且 ≤5MB */
export const SITE_ZIP_LIMITS: ZipLimits = {
  maxFiles: 200,
  maxTotalBytes: 30 * 1024 * 1024,
  maxImages: 20,
  maxImageBytes: 5 * 1024 * 1024,
};

/**
 * 计入图片配额的扩展名（契约 §3.9，2026-08-28 增补）。
 *
 * 为什么要有这道上限：战略不做清单里「图床与批量图片上传」是明确不做的方向，但此前
 * 它只是《服务条款》里的一句软约束——技术上没有任何东西拦得住把 30MB 额度全填成图片。
 * 「ZIP 二进制图片按张机审」在 2026-07-26 对标盘点里被判 defer（阿里云消费告警仍是
 * 站长阻塞项，接按量计费等于排入一次可预见的账单事故），当时定的**替代方案就是本上限**：
 * 用结构性封顶把禁令变成代码硬约束，且零机审成本。
 *
 * 刻意不含 `svg` 与 `ico`：
 * - `svg` 是文本格式，已在 SITE_TEXT_EXTENSIONS 里逐字过机审，且典型用途是图标与插画，
 *   一个正经站点带几十个 svg 图标很常见——计入配额是纯误伤；
 * - `ico` 是 favicon，单站点一两个、每个几 KB。
 * 图床载荷的形态是**大量位图**，配额只需要盯住位图。
 */
export const SITE_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/** 扩展名白名单（契约 §3.9）：仅前端静态资源 */
export const SITE_EXTENSION_WHITELIST = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'json',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico',
  'woff', 'woff2', 'ttf', 'otf',
  'mp3', 'mp4', 'webm',
  'txt', 'xml', 'map', 'wasm',
]);

/** 机审文本文件扩展名（契约 §3.9）：svg 为浏览器可直接渲染的文本格式（可承载文字与脚本），必须纳入 */
export const SITE_TEXT_EXTENSIONS = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'json', 'svg', 'txt', 'xml',
]);

/** 校验失败（→ 路由层 400）；其余错误按 500 处理 */
export class ZipValidationError extends Error {}

export interface ExtractResult {
  fileCount: number;
  totalBytes: number;
  /** （唯一顶层目录剥离后）根目录是否含 index.html */
  hasRootIndex: boolean;
}

/** 人类可读容量：整 MB 显示 MB，否则显示字节 */
function describeBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return Number.isInteger(mb) ? `${mb}MB` : `${bytes} 字节`;
}

/** 取小写扩展名（无点），无扩展名返回 '' */
function extOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/** entry 名安全校验（yauzl decodeStrings 已兜底 ../ 与绝对路径，这里再验一遍） */
function assertSafeEntryName(name: string): void {
  if (name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(name)) {
    throw new ZipValidationError(`压缩包内文件路径非法（绝对路径）：${name}`);
  }
  const segments = name.split('/');
  if (segments.some((s) => s === '..' || s === '.' || (s === '' && !name.endsWith('/')))) {
    throw new ZipValidationError(`压缩包内文件路径非法（含 ../ 等相对段）：${name}`);
  }
}

/** 符号链接判定：externalFileAttributes 高 16 位为 Unix mode，S_IFLNK = 0o120000 */
function isSymlink(entry: yauzl.Entry): boolean {
  return ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000;
}

/** 遍历读取全部 entry 元数据（lazyEntries 逐条），过程中做名称/类型/声称体积校验 */
function readAndValidateEntries(zipfile: yauzl.ZipFile, limits: ZipLimits): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = [];
    let fileCount = 0;
    let claimedTotal = 0;
    let imageCount = 0;
    let imageBytes = 0;
    zipfile.on('entry', (entry: yauzl.Entry) => {
      try {
        assertSafeEntryName(entry.fileName);
        if (isSymlink(entry)) {
          throw new ZipValidationError(`压缩包内不允许包含符号链接：${entry.fileName}`);
        }
        const isDirectory = entry.fileName.endsWith('/');
        if (!isDirectory) {
          const ext = extOf(entry.fileName);
          if (!SITE_EXTENSION_WHITELIST.has(ext)) {
            throw new ZipValidationError(`不支持的文件类型：${entry.fileName}（仅允许常见前端静态资源）`);
          }
          fileCount += 1;
          if (fileCount > limits.maxFiles) {
            throw new ZipValidationError(`文件数量超过上限（${limits.maxFiles} 个）`);
          }
          // 声称值计量（zip 炸弹第一道熔断）：解压前即按 header 声称体积拒绝
          claimedTotal += entry.uncompressedSize;
          if (claimedTotal > limits.maxTotalBytes) {
            throw new ZipValidationError(`解压后总大小超过限制（${describeBytes(limits.maxTotalBytes)}）`);
          }
          // 图片配额（同样走声称值，解压前熔断；声称与实际不符由 validateEntrySizes 兜底）
          if (SITE_IMAGE_EXTENSIONS.has(ext)) {
            imageCount += 1;
            if (imageCount > limits.maxImages) {
              throw new ZipValidationError(
                `图片数量超过上限（${limits.maxImages} 张）。本平台不提供图床服务，` +
                  `请把大量图片放在图片托管服务上并以外链引用`
              );
            }
            imageBytes += entry.uncompressedSize;
            if (imageBytes > limits.maxImageBytes) {
              throw new ZipValidationError(
                `图片总大小超过限制（${describeBytes(limits.maxImageBytes)}）。` +
                  `本平台不提供图床服务，请压缩图片或改用外链引用`
              );
            }
          }
        }
        entries.push(entry);
        zipfile.readEntry();
      } catch (err) {
        reject(err);
      }
    });
    zipfile.on('end', () => resolve(entries));
    zipfile.on('error', (err: Error) => {
      // yauzl decodeStrings 校验失败（../、绝对路径、非法字符）→ 统一转中文校验错误
      if (/invalid relative path|absolute path|invalid characters/i.test(err.message)) {
        reject(new ZipValidationError(`压缩包内文件路径非法（含 ../ 或绝对路径）`));
      } else {
        reject(new ZipValidationError('ZIP 文件解析失败，请确认是有效的 ZIP 压缩包'));
      }
    });
    zipfile.readEntry();
  });
}

/**
 * 唯一顶层目录剥离判定（契约 §3.9）：所有文件 entry 共享同一顶层目录
 * （即每个文件都在该目录下，无根级散文件）时返回 `<dir>/` 前缀，否则返回 ''。
 */
export function resolveStripPrefix(fileNames: string[]): string {
  if (fileNames.length === 0) return '';
  const tops = new Set<string>();
  for (const name of fileNames) {
    const slash = name.indexOf('/');
    if (slash === -1) return ''; // 有根级文件 → 不剥离
    tops.add(name.slice(0, slash));
  }
  return tops.size === 1 ? `${[...tops][0]}/` : '';
}

/**
 * 安全解压 zip buffer 到 destDir（契约 §3.9）。
 * - 任何校验失败抛 ZipValidationError（中文、指明具体项），并清理 destDir；
 * - 实际写入字节第二道计量熔断（yauzl validateEntrySizes 同时兜底声称值与实际不符的构造包）；
 * - 唯一顶层目录自动剥离后落盘。
 */
export async function extractZip(
  buffer: Buffer,
  destDir: string,
  limits: ZipLimits = SITE_ZIP_LIMITS
): Promise<ExtractResult> {
  let zipfile: yauzl.ZipFile | null = null;
  try {
    try {
      zipfile = await yauzl.fromBufferPromise(buffer, { lazyEntries: true, autoClose: false });
    } catch {
      throw new ZipValidationError('ZIP 文件解析失败，请确认是有效的 ZIP 压缩包');
    }
    const entries = await readAndValidateEntries(zipfile, limits);
    const fileEntries = entries.filter((e) => !e.fileName.endsWith('/'));
    const strip = resolveStripPrefix(fileEntries.map((e) => e.fileName));
    const hasRootIndex = fileEntries.some(
      (e) => (strip ? e.fileName.slice(strip.length) : e.fileName) === 'index.html'
    );

    await mkdir(destDir, { recursive: true });
    let totalBytes = 0;
    for (const entry of fileEntries) {
      const rel = strip ? entry.fileName.slice(strip.length) : entry.fileName;
      if (!rel) continue;
      const target = join(destDir, rel);
      // 双保险：拼接后必须仍落在 destDir 内
      if (target !== destDir && !target.startsWith(destDir + sep)) {
        throw new ZipValidationError(`压缩包内文件路径非法（含 ../ 等相对段）：${entry.fileName}`);
      }
      await mkdir(dirname(target), { recursive: true });
      const source = await zipfile.openReadStreamPromise(entry);
      // 实际写入计量（zip 炸弹第二道熔断）：超限立即中止
      const meter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          totalBytes += chunk.length;
          if (totalBytes > limits.maxTotalBytes) {
            cb(new ZipValidationError(`解压后总大小超过限制（${describeBytes(limits.maxTotalBytes)}）`));
          } else {
            cb(null, chunk);
          }
        },
      });
      try {
        await pipeline(source, meter, createWriteStream(target));
      } catch (err) {
        // yauzl validateEntrySizes（AssertByteCountStream）：entry 声称大小与实际字节不符
        // 抛普通 Error（"too many bytes..." / "not enough bytes... expected N"）——
        // 属恶意构造或损坏的包，转校验错误按 400 处理而非 500
        if (
          err instanceof Error &&
          !(err instanceof ZipValidationError) &&
          (err.message.includes('too many bytes') || err.message.includes('expected'))
        ) {
          throw new ZipValidationError('ZIP 文件损坏或声称大小不符');
        }
        throw err;
      }
    }
    return { fileCount: fileEntries.length, totalBytes, hasRootIndex };
  } catch (err) {
    // 失败清理：不残留半成品目录
    await rm(destDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  } finally {
    zipfile?.close();
  }
}

/** 递归收集目录内全部文本文件内容（机审输入，契约 §3.9）；站点 ≤30MB，全量读入可接受 */
export async function collectSiteTexts(dir: string): Promise<string[]> {
  const texts: string[] = [];
  const walk = async (current: string): Promise<void> => {
    const items = await readdir(current, { withFileTypes: true });
    for (const item of items) {
      const full = join(current, item.name);
      if (item.isDirectory()) {
        await walk(full);
      } else if (item.isFile() && SITE_TEXT_EXTENSIONS.has(extOf(item.name))) {
        texts.push(await readFile(full, 'utf8'));
      }
    }
  };
  await walk(dir);
  return texts;
}
