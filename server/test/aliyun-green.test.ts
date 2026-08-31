// 签名请求组装单测（签名正确性由 scripts/aliyun-smoke.ts 对真实接口验证）
import { describe, it, expect } from 'vitest';
import { buildSignedRequest, chunkText, CHUNK_SIZE } from '../src/aliyun-green.js';

const FIXED = {
  akId: 'testAkId',
  akSecret: 'testAkSecret',
  endpoint: 'green-cip.cn-shanghai.aliyuncs.com',
  action: 'TextModerationPlus',
  body: 'Service=ugc_moderation_byllm&ServiceParameters=%7B%22content%22%3A%22hi%22%7D',
  date: '2026-07-22T08:00:00Z',
  nonce: 'fixed-nonce',
};

describe('buildSignedRequest', () => {
  it('生成完整签名头集合与 authorization', () => {
    const req = buildSignedRequest(FIXED);
    expect(req.url).toBe('https://green-cip.cn-shanghai.aliyuncs.com/');
    for (const h of ['content-type', 'host', 'x-acs-action', 'x-acs-content-sha256', 'x-acs-date', 'x-acs-signature-nonce', 'x-acs-version']) {
      expect(req.headers[h]).toBeTruthy();
    }
    expect(req.headers['x-acs-version']).toBe('2022-03-02');
    expect(req.headers.authorization).toMatch(
      /^ACS3-HMAC-SHA256 Credential=testAkId,SignedHeaders=content-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version,Signature=[0-9a-f]{64}$/
    );
  });
  it('确定性：同输入同签名；改 body 则签名变化', () => {
    const a = buildSignedRequest(FIXED);
    const b = buildSignedRequest(FIXED);
    const c = buildSignedRequest({ ...FIXED, body: FIXED.body + 'x' });
    expect(a.headers.authorization).toBe(b.headers.authorization);
    expect(c.headers.authorization).not.toBe(a.headers.authorization);
  });
});

describe('chunkText', () => {
  it('空文本 → 空数组；超长按 CHUNK_SIZE 切块', () => {
    expect(chunkText('')).toEqual([]);
    const chunks = chunkText('a'.repeat(CHUNK_SIZE * 2 + 10));
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(CHUNK_SIZE);
    expect(chunks[2]).toHaveLength(10);
  });
});
