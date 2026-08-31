// callApi 单测：Bearer 头组装 / 错误映射 / 网络失败提示（注入 fake fetch，不打真实网络）
import { describe, expect, it } from 'vitest';
import { callApi, resolveConfig, siteOrigin, DEFAULT_API_BASE } from '../src/api.js';

/** 构造捕获请求的 fake fetch */
function makeFakeFetch(status: number, body: unknown, opts: { rawText?: string } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    const text = opts.rawText ?? JSON.stringify(body);
    return new Response(status === 204 ? null : text, {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const ctx = { baseUrl: DEFAULT_API_BASE, token: 'ak_test_token_1234' };

describe('callApi', () => {
  it('携带 Bearer 头与 JSON 请求体，URL 由 baseUrl + path 拼接', async () => {
    const { fetchFn, calls } = makeFakeFetch(201, { artifact: { slug: 's' } });
    await callApi('/artifacts', { ...ctx, method: 'POST', body: { title: 't' }, fetchFn });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://artifacts.orienthong.cn/api/artifacts');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ak_test_token_1234');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ title: 't' });
    expect(calls[0].init.method).toBe('POST');
  });

  it('GET 请求不带请求体与 Content-Type', async () => {
    const { fetchFn, calls } = makeFakeFetch(200, { items: [] });
    await callApi('/artifacts', { ...ctx, fetchFn });
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.body).toBeUndefined();
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('成功时返回解析后的 JSON', async () => {
    const { fetchFn } = makeFakeFetch(200, { items: [{ id: '1' }] });
    const data = await callApi('/artifacts', { ...ctx, fetchFn });
    expect(data).toEqual({ items: [{ id: '1' }] });
  });

  it('非 2xx 且响应含 {error}：中文错误原样透传', async () => {
    const { fetchFn } = makeFakeFetch(400, { error: '内容疑似包含违禁内容，无法保存。' });
    await expect(callApi('/artifacts', { ...ctx, method: 'POST', body: {}, fetchFn })).rejects.toThrow(
      '内容疑似包含违禁内容，无法保存。'
    );
  });

  it('401 时附加检查 ARTIFACTS_TOKEN 的可操作提示', async () => {
    const { fetchFn } = makeFakeFetch(401, { error: '请先登录' });
    await expect(callApi('/me', { ...ctx, fetchFn })).rejects.toThrow(/ARTIFACTS_TOKEN/);
  });

  it('非 2xx 且响应不是 JSON：按状态码提示', async () => {
    const { fetchFn } = makeFakeFetch(502, null, { rawText: '<html>Bad Gateway</html>' });
    await expect(callApi('/artifacts', { ...ctx, fetchFn })).rejects.toThrow('请求失败（HTTP 502）');
  });

  it('网络失败：给出检查网络 / ARTIFACTS_API_BASE 的可操作提示', async () => {
    const fetchFn = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(callApi('/artifacts', { ...ctx, fetchFn })).rejects.toThrow(
      /无法连接.*ARTIFACTS_API_BASE/s
    );
  });
});

describe('siteOrigin', () => {
  it('默认 API base → 生产站点 origin', () => {
    expect(siteOrigin(DEFAULT_API_BASE)).toBe('https://artifacts.orienthong.cn');
  });

  it('本地 API base → 本地 origin（去掉尾部 /api 与斜杠）', () => {
    expect(siteOrigin('http://localhost:8091/api')).toBe('http://localhost:8091');
    expect(siteOrigin('http://localhost:8091/api/')).toBe('http://localhost:8091');
  });
});

describe('resolveConfig', () => {
  it('缺失 ARTIFACTS_TOKEN 时抛中文错误', () => {
    expect(() => resolveConfig({})).toThrow(/ARTIFACTS_TOKEN/);
  });

  it('默认 API base 为生产地址，可被 ARTIFACTS_API_BASE 覆盖', () => {
    expect(resolveConfig({ ARTIFACTS_TOKEN: 'ak_x' })).toEqual({
      baseUrl: DEFAULT_API_BASE,
      token: 'ak_x',
    });
    expect(
      resolveConfig({ ARTIFACTS_TOKEN: 'ak_x', ARTIFACTS_API_BASE: 'http://localhost:8091/api' })
    ).toEqual({ baseUrl: 'http://localhost:8091/api', token: 'ak_x' });
  });
});
