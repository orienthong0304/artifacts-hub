// ZIP 站点托管集成测试（契约 §3.9，2026-07-22 自定义子域修订）：
// 发布 / 子域校验 / 保留字 / 唯一冲突 / 机审 / 配额 / 原子替换 / 删除 / 归属
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { app, pool, initSchema, resetDb, registerUser, sitesRoot } from './helpers.js';

beforeAll(async () => {
  await initSchema();
});
beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await pool.end();
});

interface Site {
  id: string;
  slug: string;
  subdomain: string;
  title: string;
  url: string;
  sizeBytes: number;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 构造真实 zip：entryName → 内容 */
function makeZip(files: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content));
  }
  return zip.toBuffer();
}

/** adm-zip 会归一化 ../，恶意 entry 名需在成品字节里同长度替换 */
function patchEntryName(buf: Buffer, from: string, to: string): Buffer {
  const fromBytes = Buffer.from(from);
  const toBytes = Buffer.from(to);
  let idx = buf.indexOf(fromBytes);
  while (idx !== -1) {
    toBytes.copy(buf, idx);
    idx = buf.indexOf(fromBytes, idx + 1);
  }
  return buf;
}

/**
 * multipart 上传站点 zip。
 * app.request 构造的 Request 不会自带 content-length（fetch 规范在网络派发时才计算），
 * 而服务端按契约 §3.9 以 Content-Length 预检请求体——这里显式补一个贴近实际的值
 * （zip 字节数 + multipart 边界/字段开销余量），也可用 contentLength 伪造超限值。
 * subdomain：POST 必填（缺省不发，用于测缺字段）；PUT 传入则一并发送（用于测忽略语义）。
 */
async function uploadSite(
  cookie: string,
  zip: Buffer,
  opts: {
    title?: string;
    subdomain?: string;
    method?: 'POST' | 'PUT';
    path?: string;
    contentLength?: number;
  } = {}
): Promise<Response> {
  const fd = new FormData();
  fd.append('file', new File([new Uint8Array(zip)], 'site.zip', { type: 'application/zip' }));
  if (opts.title !== undefined) fd.append('title', opts.title);
  if (opts.subdomain !== undefined) fd.append('subdomain', opts.subdomain);
  return app.request(opts.path ?? '/api/sites', {
    method: opts.method ?? 'POST',
    headers: { cookie, 'content-length': String(opts.contentLength ?? zip.byteLength + 4096) },
    body: fd,
  });
}

const VALID_FILES = {
  'index.html': '<h1>你好，站点</h1>',
  'style.css': 'body{margin:0}',
};

describe('ZIP 站点托管（契约 §3.9 自定义子域）', () => {
  it('① 合法前缀发布 201：url = https://<sub>.artifacts.orienthong.cn/，磁盘落 <sub>/current', async () => {
    const { cookie } = await registerUser('siteowner1');
    const res = await uploadSite(cookie, makeZip(VALID_FILES), {
      title: '我的站点',
      subdomain: 'my-site01',
    });
    expect(res.status).toBe(201);
    const { site } = (await res.json()) as { site: Site };
    expect(site.title).toBe('我的站点');
    expect(site.subdomain).toBe('my-site01');
    expect(site.slug).toMatch(/^[0-9a-zA-Z_-]{8}$/);
    expect(site.url).toBe('https://my-site01.artifacts.orienthong.cn/');
    expect(site.fileCount).toBe(2);
    expect(site.sizeBytes).toBeGreaterThan(0);

    // 存储布局按 subdomain（slug 目录不再使用）
    const current = join(sitesRoot, 'my-site01', 'current');
    expect(readFileSync(join(current, 'index.html'), 'utf8')).toBe('<h1>你好，站点</h1>');
    expect(readFileSync(join(current, 'style.css'), 'utf8')).toBe('body{margin:0}');
    expect(existsSync(join(sitesRoot, site.slug))).toBe(false);

    // GET /api/sites 列表可见
    const list = await app.request('/api/sites', { headers: { cookie } });
    expect(list.status).toBe(200);
    const { items } = (await list.json()) as { items: Site[] };
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(site.id);
    expect(items[0].subdomain).toBe('my-site01');
  });

  it('①b 非法前缀（大写/下划线/太短/首尾连字符）400 中文', async () => {
    const { cookie } = await registerUser('siteownerbad');
    // 注意上传限流 5 次/时/用户：本用例恰好 5 次非法尝试
    for (const subdomain of ['MySite', 'my_site', 'ab', '-abc', 'abc-']) {
      const res = await uploadSite(cookie, makeZip(VALID_FILES), { title: '非法前缀', subdomain });
      expect(res.status, `subdomain=${subdomain}`).toBe(400);
      const { error } = (await res.json()) as { error: string };
      expect(error, `subdomain=${subdomain}`).toBe(
        '前缀需为 3-30 位小写字母/数字/连字符，且首尾为字母或数字'
      );
    }
    // 非法前缀不落盘不入库
    const count = await pool.query('select count(*)::int as n from sites');
    expect(count.rows[0].n).toBe(0);
  });

  it('①c 保留字前缀（api/www）400；缺 subdomain 字段 400', async () => {
    const { cookie } = await registerUser('siteownerres');
    for (const subdomain of ['api', 'www']) {
      const res = await uploadSite(cookie, makeZip(VALID_FILES), { title: '保留字', subdomain });
      expect(res.status, `subdomain=${subdomain}`).toBe(400);
      const { error } = (await res.json()) as { error: string };
      expect(error).toBe('该前缀为保留字，不能使用');
    }
    const missing = await uploadSite(cookie, makeZip(VALID_FILES), { title: '缺前缀' });
    expect(missing.status).toBe(400);
    const { error } = (await missing.json()) as { error: string };
    expect(error).toBe('前缀需为 3-30 位小写字母/数字/连字符，且首尾为字母或数字');
  });

  it('①d 重复前缀 409「该前缀已被使用」', async () => {
    const { cookie } = await registerUser('siteownerdupa');
    const { cookie: otherCookie } = await registerUser('siteownerdupb');
    const first = await uploadSite(cookie, makeZip(VALID_FILES), {
      title: '先到先得',
      subdomain: 'dup-site',
    });
    expect(first.status).toBe(201);
    const second = await uploadSite(otherCookie, makeZip(VALID_FILES), {
      title: '后来者',
      subdomain: 'dup-site',
    });
    expect(second.status).toBe(409);
    const { error } = (await second.json()) as { error: string };
    expect(error).toBe('该前缀已被使用');
    // 冲突不落库不覆盖磁盘
    const count = await pool.query('select count(*)::int as n from sites');
    expect(count.rows[0].n).toBe(1);
    const current = join(sitesRoot, 'dup-site', 'current');
    expect(readFileSync(join(current, 'index.html'), 'utf8')).toBe('<h1>你好，站点</h1>');
  });

  it('② 缺 index.html 400 中文', async () => {
    const { cookie } = await registerUser('siteowner2');
    const res = await uploadSite(cookie, makeZip({ 'page.html': '<h1>无入口</h1>' }), {
      title: '缺入口',
      subdomain: 'no-entry',
    });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain('index.html');
  });

  it('③ 含 ../evil entry 400', async () => {
    const { cookie } = await registerUser('siteowner3');
    const zip = patchEntryName(
      makeZip({ 'index.html': '<h1>ok</h1>', 'AA/evil.html': 'x' }),
      'AA/evil.html',
      '../evil.html'
    );
    const res = await uploadSite(cookie, zip, { title: '穿越', subdomain: 'traversal' });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain('路径非法');
  });

  it('④ 超文件数（201 个文件）400', async () => {
    const { cookie } = await registerUser('siteowner4');
    const files: Record<string, string> = { 'index.html': '<h1>ok</h1>' };
    for (let i = 0; i < 200; i++) files[`f${i}.txt`] = String(i);
    const res = await uploadSite(cookie, makeZip(files), { title: '文件太多', subdomain: 'too-many' });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain('文件数量超过上限');
  });

  it('⑤ 白名单外扩展名（.php）400', async () => {
    const { cookie } = await registerUser('siteowner5');
    const res = await uploadSite(
      cookie,
      makeZip({ 'index.html': '<h1>ok</h1>', 'shell.php': '<?php ?>' }),
      { title: '带后门', subdomain: 'backdoor' }
    );
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain('不支持的文件类型');
  });

  it('⑥ 含敏感词的 html 400（本地词表机审）', async () => {
    const { cookie } = await registerUser('siteowner6');
    const res = await uploadSite(
      cookie,
      makeZip({ 'index.html': '<h1>这里有测试违禁词内容</h1>' }),
      { title: '违规站点', subdomain: 'banned-words' }
    );
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toBe('站点内容未通过机器审核，无法发布');
    // 机审失败不落盘不入库
    const count = await pool.query('select count(*)::int as n from sites');
    expect(count.rows[0].n).toBe(0);
    expect(existsSync(join(sitesRoot, 'banned-words'))).toBe(false);
  });

  it('⑦ 配额：free 档默认 3 个(契约 §3.12)，第 4 个 400', async () => {
    const { cookie } = await registerUser('siteowner7');
    for (let i = 0; i < 3; i++) {
      const res = await uploadSite(cookie, makeZip(VALID_FILES), {
        title: `站点${i}`,
        subdomain: `quota-ok-${i}`,
      });
      expect(res.status).toBe(201);
    }
    const overflow = await uploadSite(cookie, makeZip(VALID_FILES), {
      title: '超限',
      subdomain: 'quota-overflow',
    });
    expect(overflow.status).toBe(400);
    const { error } = (await overflow.json()) as { error: string };
    expect(error).toBe('站点数量已达上限（3 个）');
  });

  it('⑧ PUT 原子替换：新内容生效且 subdomain/url 不变，旧文件清理；带 subdomain 字段被忽略', async () => {
    const { cookie } = await registerUser('siteowner8');
    const created = await uploadSite(cookie, makeZip(VALID_FILES), {
      title: '初版',
      subdomain: 'origin-sub',
    });
    expect(created.status).toBe(201);
    const { site } = (await created.json()) as { site: Site };

    const updated = await uploadSite(
      cookie,
      makeZip({ 'index.html': '<h1>第二版</h1>', 'app.js': 'console.log(2)' }),
      {
        title: '二版',
        // PUT 不允许改 subdomain（契约 §3.9）：带上一律忽略
        subdomain: 'changed-sub',
        method: 'PUT',
        path: `/api/sites/${site.id}`,
      }
    );
    expect(updated.status).toBe(200);
    const { site: next } = (await updated.json()) as { site: Site };
    expect(next.subdomain).toBe('origin-sub');
    expect(next.url).toBe(site.url);
    expect(next.slug).toBe(site.slug);
    expect(next.title).toBe('二版');
    expect(next.fileCount).toBe(2);

    const current = join(sitesRoot, 'origin-sub', 'current');
    expect(readFileSync(join(current, 'index.html'), 'utf8')).toBe('<h1>第二版</h1>');
    expect(existsSync(join(current, 'app.js'))).toBe(true);
    // 旧版文件不残留；忽略的 subdomain 不产生新目录
    expect(existsSync(join(current, 'style.css'))).toBe(false);
    expect(existsSync(join(sitesRoot, 'changed-sub'))).toBe(false);
  });

  it('⑧b PUT 校验失败：保留旧版内容', async () => {
    const { cookie } = await registerUser('siteowner8b');
    const created = await uploadSite(cookie, makeZip(VALID_FILES), {
      title: '初版',
      subdomain: 'keep-old',
    });
    const { site } = (await created.json()) as { site: Site };

    const bad = await uploadSite(cookie, makeZip({ 'page.html': '缺入口' }), {
      method: 'PUT',
      path: `/api/sites/${site.id}`,
    });
    expect(bad.status).toBe(400);
    // 旧版原样保留
    const current = join(sitesRoot, 'keep-old', 'current');
    expect(readFileSync(join(current, 'index.html'), 'utf8')).toBe('<h1>你好，站点</h1>');
  });

  it('⑨ DELETE 后记录与目录均消失', async () => {
    const { cookie } = await registerUser('siteowner9');
    const created = await uploadSite(cookie, makeZip(VALID_FILES), {
      title: '要删的',
      subdomain: 'to-delete',
    });
    const { site } = (await created.json()) as { site: Site };
    expect(existsSync(join(sitesRoot, 'to-delete'))).toBe(true);

    const del = await app.request(`/api/sites/${site.id}`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(204);
    expect(existsSync(join(sitesRoot, 'to-delete'))).toBe(false);
    const count = await pool.query('select count(*)::int as n from sites');
    expect(count.rows[0].n).toBe(0);
  });

  it('⑩ 非本人站点 PUT/DELETE：403；不存在：404', async () => {
    const { cookie } = await registerUser('siteowner10');
    const { cookie: otherCookie } = await registerUser('intruder10');
    const created = await uploadSite(cookie, makeZip(VALID_FILES), {
      title: '别人的',
      subdomain: 'not-yours',
    });
    const { site } = (await created.json()) as { site: Site };

    const put = await uploadSite(otherCookie, makeZip(VALID_FILES), {
      method: 'PUT',
      path: `/api/sites/${site.id}`,
    });
    expect(put.status).toBe(403);
    const del = await app.request(`/api/sites/${site.id}`, {
      method: 'DELETE',
      headers: { cookie: otherCookie },
    });
    expect(del.status).toBe(403);
    // 不存在 → 404
    const missing = await app.request('/api/sites/00000000-0000-4000-8000-000000000000', {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(missing.status).toBe(404);
    // 未登录 → 401
    const anon = await app.request('/api/sites');
    expect(anon.status).toBe(401);
  });

  it('⑪ Content-Length 超限：读体前 400，不解压不落库（内存 DoS 预检）', async () => {
    const { cookie } = await registerUser('siteowner11');
    // 小 body + 伪造超限 content-length：若预检缺失，该合法 zip 会走到解压并 201
    const res = await uploadSite(cookie, makeZip(VALID_FILES), {
      title: '声称超大',
      subdomain: 'claims-huge',
      contentLength: 12 * 1024 * 1024,
    });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toBe('上传体积超过限制（ZIP 最大 10MB）');
    // 预检拒绝：未触发解压/机审/落库
    const count = await pool.query('select count(*)::int as n from sites');
    expect(count.rows[0].n).toBe(0);

    // 缺失 content-length 同样拒绝（防 chunked 编码绕过预检）
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array(makeZip(VALID_FILES))], 'site.zip'));
    fd.append('subdomain', 'claims-huge');
    const missing = await app.request('/api/sites', { method: 'POST', headers: { cookie }, body: fd });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toBe(
      '上传体积超过限制（ZIP 最大 10MB）'
    );
  });

  it('⑫ svg 纳入机审文本：svg 内敏感词 400', async () => {
    const { cookie } = await registerUser('siteowner12');
    const res = await uploadSite(
      cookie,
      makeZip({
        'index.html': '<h1>正常内容</h1>',
        'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"><text>测试违禁词</text></svg>',
      }),
      { title: 'svg 逃逸', subdomain: 'svg-escape' }
    );
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toBe('站点内容未通过机器审核，无法发布');
    const count = await pool.query('select count(*)::int as n from sites');
    expect(count.rows[0].n).toBe(0);
  });
});
