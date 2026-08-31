// 工具 handler 单测：payload 组装 / URL 拼装 / pending 提醒文案分支 / 错误映射（注入 fake fetch）
import { describe, expect, it } from 'vitest';
import { DEFAULT_API_BASE } from '../src/api.js';
import {
  publishArtifact,
  updateArtifact,
  listMyArtifacts,
  createTempLink,
} from '../src/tools.js';

/** 构造捕获请求的 fake fetch，按序返回预置响应 */
function makeFakeFetch(...responses: { status: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const fetchFn = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i++, responses.length - 1)];
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchFn, calls };
}

function artifactFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    slug: 'abc123xy',
    title: '测试作品',
    description: null,
    type: 'html',
    visibility: 'unlisted',
    views: 0,
    reviewStatus: 'approved',
    isTakenDown: false,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    author: { username: 'tester', displayName: '测试' },
    ...overrides,
  };
}

const ctx = { baseUrl: DEFAULT_API_BASE, token: 'ak_test' };

describe('publish_artifact', () => {
  it('POST /artifacts；visibility 缺省补 unlisted；返回文本含 url/slug/reviewStatus', async () => {
    const { fetchFn, calls } = makeFakeFetch({ status: 201, body: { artifact: artifactFixture() } });
    const result = await publishArtifact(
      { ...ctx, fetchFn },
      { title: '测试作品', type: 'html', code: '<h1>hi</h1>' }
    );

    expect(calls[0].url).toBe('https://artifacts.orienthong.cn/api/artifacts');
    expect(calls[0].init.method).toBe('POST');
    const payload = JSON.parse(String(calls[0].init.body));
    expect(payload).toEqual({
      title: '测试作品',
      type: 'html',
      code: '<h1>hi</h1>',
      visibility: 'unlisted',
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain('https://artifacts.orienthong.cn/a/abc123xy');
    expect(text).toContain('abc123xy');
    expect(text).toContain('approved');
  });

  it('description 与显式 visibility 透传', async () => {
    const { fetchFn, calls } = makeFakeFetch({
      status: 201,
      body: { artifact: artifactFixture({ visibility: 'private' }) },
    });
    await publishArtifact(
      { ...ctx, fetchFn },
      { title: 't', type: 'react', code: 'export default () => null', description: '说明', visibility: 'private' }
    );
    const payload = JSON.parse(String(calls[0].init.body));
    expect(payload.description).toBe('说明');
    expect(payload.visibility).toBe('private');
  });

  it('public + pending：提醒「已发布，内容转人工复核中，通过后进入广场；链接即时可用」', async () => {
    const { fetchFn } = makeFakeFetch({
      status: 201,
      body: { artifact: artifactFixture({ visibility: 'public', reviewStatus: 'pending' }) },
    });
    const result = await publishArtifact(
      { ...ctx, fetchFn },
      { title: 't', type: 'html', code: '<p/>', visibility: 'public' }
    );
    expect(result.content[0].text).toContain('已发布，内容转人工复核中，通过后进入广场；链接即时可用');
  });

  it('public + approved：无 pending 提醒', async () => {
    const { fetchFn } = makeFakeFetch({
      status: 201,
      body: { artifact: artifactFixture({ visibility: 'public', reviewStatus: 'approved' }) },
    });
    const result = await publishArtifact(
      { ...ctx, fetchFn },
      { title: 't', type: 'html', code: '<p/>', visibility: 'public' }
    );
    expect(result.content[0].text).not.toContain('转人工复核中');
  });

  it('API 错误：isError=true 且中文错误透传', async () => {
    const { fetchFn } = makeFakeFetch({
      status: 400,
      body: { error: '内容疑似包含违禁内容，无法保存。如有疑问请联系站长。' },
    });
    const result = await publishArtifact(
      { ...ctx, fetchFn },
      { title: 't', type: 'html', code: '<p/>' }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('内容疑似包含违禁内容');
  });
});

describe('update_artifact', () => {
  it('PUT /artifacts/:id，只发送提供的字段；文本含同链接与 url', async () => {
    const a = artifactFixture({ title: '新标题' });
    const { fetchFn, calls } = makeFakeFetch({ status: 200, body: { artifact: a } });
    const result = await updateArtifact(
      { ...ctx, fetchFn },
      { id: a.id as string, title: '新标题' }
    );

    expect(calls[0].url).toBe(`https://artifacts.orienthong.cn/api/artifacts/${a.id}`);
    expect(calls[0].init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ title: '新标题' });
    expect(result.content[0].text).toContain('https://artifacts.orienthong.cn/a/abc123xy');
  });

  it('仅传 id 无任何待更新字段：前置校验直接报错，不发请求', async () => {
    const { fetchFn, calls } = makeFakeFetch({ status: 200, body: { artifact: artifactFixture() } });
    const result = await updateArtifact({ ...ctx, fetchFn }, { id: 'art-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      '至少需要提供一个待更新字段（title/description/code/visibility）'
    );
    expect(calls.length).toBe(0);
  });
});

describe('list_my_artifacts', () => {
  it('GET /artifacts 带 q/type 查询参数；输出精简列表含 url', async () => {
    const { fetchFn, calls } = makeFakeFetch({
      status: 200,
      body: { items: [artifactFixture(), artifactFixture({ id: 'b', slug: 'def456zz', title: '第二个' })] },
    });
    const result = await listMyArtifacts({ ...ctx, fetchFn }, { q: '测试', type: 'html' });

    expect(calls[0].url).toBe('https://artifacts.orienthong.cn/api/artifacts?q=%E6%B5%8B%E8%AF%95&type=html');
    const text = result.content[0].text;
    expect(text).toContain('https://artifacts.orienthong.cn/a/abc123xy');
    expect(text).toContain('https://artifacts.orienthong.cn/a/def456zz');
    expect(text).toContain('第二个');
  });

  it('空列表给出友好提示', async () => {
    const { fetchFn } = makeFakeFetch({ status: 200, body: { items: [] } });
    const result = await listMyArtifacts({ ...ctx, fetchFn }, {});
    expect(result.content[0].text).toContain('还没有作品');
  });
});

describe('create_temp_link', () => {
  it('POST /artifacts/:id/temp-links，expiresInHours 缺省 24；返回 /t/{token} URL 与到期时间', async () => {
    const { fetchFn, calls } = makeFakeFetch({
      status: 201,
      body: {
        tempLink: {
          id: 'tl-1',
          token: 'tok16tok16tok16t',
          expiresAt: '2026-07-23T00:00:00.000Z',
          note: null,
          expired: false,
          createdAt: '2026-07-22T00:00:00.000Z',
        },
      },
    });
    const result = await createTempLink({ ...ctx, fetchFn }, { artifactId: 'art-1' });

    expect(calls[0].url).toBe('https://artifacts.orienthong.cn/api/artifacts/art-1/temp-links');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ expiresInHours: 24 });
    const text = result.content[0].text;
    expect(text).toContain('https://artifacts.orienthong.cn/t/tok16tok16tok16t');
    expect(text).toContain('2026-07-23');
  });

  it('note 透传', async () => {
    const { fetchFn, calls } = makeFakeFetch({
      status: 201,
      body: {
        tempLink: {
          id: 'tl-2',
          token: 'x'.repeat(16),
          expiresAt: '2026-07-22T06:00:00.000Z',
          note: '给客户看',
          expired: false,
          createdAt: '2026-07-22T00:00:00.000Z',
        },
      },
    });
    await createTempLink({ ...ctx, fetchFn }, { artifactId: 'art-1', expiresInHours: 6, note: '给客户看' });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ expiresInHours: 6, note: '给客户看' });
  });
});

describe('生成合成内容声明（契约 §3.11）', () => {
  it('publish_artifact 不传 aiGenerated 时不塞该字段——由服务端缺省 true 决定', async () => {
    const { fetchFn, calls } = makeFakeFetch({ status: 201, body: { artifact: artifactFixture() } });
    await publishArtifact(
      { ...ctx, fetchFn },
      { title: 't', type: 'html', code: '<h1>x</h1>' }
    );
    expect(JSON.parse(String(calls[0].init.body))).not.toHaveProperty('aiGenerated');
  });

  it('显式声明为非 AI 生成时随请求发出——Agent 替手写代码发布时才用得上', async () => {
    const { fetchFn, calls } = makeFakeFetch({ status: 201, body: { artifact: artifactFixture() } });
    await publishArtifact(
      { ...ctx, fetchFn },
      { title: 't', type: 'html', code: '<h1>x</h1>', aiGenerated: false }
    );
    expect(JSON.parse(String(calls[0].init.body)).aiGenerated).toBe(false);
  });
});
