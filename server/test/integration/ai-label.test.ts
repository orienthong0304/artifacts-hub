// 生成合成内容标识（契约 §3.11）
//
// 《人工智能生成合成内容标识办法》（2025-09-01 施行）第 6 条要求内容传播服务提供者
// 为生成合成内容添加显著提示标识，第 10 条要求用户主动声明并使用平台提供的标识功能。
// 本平台的产品定位就是「把 AI 生成的页面变成可分享的作品」——绝大多数作品是 AI 生成的，
// 故 `aiGenerated` 默认为 true，作者可显式声明为非 AI 生成。
import { describe, it, expect, beforeAll } from 'vitest';
import { app, initSchema, resetDb, registerUser } from './helpers.js';

const HTML = '<h1>标识测试</h1>';

async function create(cookie: string, body: Record<string, unknown>) {
  return app.request('/api/artifacts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ title: '标识测试作品', type: 'html', code: HTML, ...body }),
  });
}

describe('生成合成内容标识（契约 §3.11）', () => {
  let cookie: string;

  beforeAll(async () => {
    await initSchema();
    await resetDb();
    cookie = (await registerUser('ailabel')).cookie;
  });

  it('缺省视为 AI 生成——产品定位如此，不声明即按需要标识处理', async () => {
    const res = await create(cookie, {});
    expect(res.status).toBe(201);
    const { artifact } = await res.json();
    expect(artifact.aiGenerated).toBe(true);
  });

  it('作者可声明为非 AI 生成，详情接口原样回传该声明', async () => {
    const res = await create(cookie, { aiGenerated: false });
    expect(res.status).toBe(201);
    const { artifact } = await res.json();
    expect(artifact.aiGenerated).toBe(false);

    const detail = await app.request(`/api/artifacts/${artifact.slug}`, { headers: { cookie } });
    expect(detail.status).toBe(200);
    expect((await detail.json()).artifact.aiGenerated).toBe(false);
  });

  it('PUT 可改声明——声明错了必须改得回来，否则标识功能形同虚设', async () => {
    const created = await (await create(cookie, { aiGenerated: false })).json();
    const res = await app.request(`/api/artifacts/${created.artifact.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ aiGenerated: true }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).artifact.aiGenerated).toBe(true);
  });

  it('列表接口带出声明——广场卡片要据此决定是否显示 AI 标识', async () => {
    await create(cookie, { aiGenerated: false });
    const res = await app.request('/api/artifacts', { headers: { cookie } });
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i: { aiGenerated?: boolean }) => typeof i.aiGenerated === 'boolean')).toBe(
      true
    );
  });
});
