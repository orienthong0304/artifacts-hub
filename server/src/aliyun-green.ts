// 阿里云内容安全「文本审核增强版」客户端（契约 §3.3）
// 自实现 OpenAPI V3（ACS3-HMAC-SHA256）签名，零第三方依赖
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { env } from './env.js';

/** 单块文本上限（TextModerationPlus content 上限 1 万字符，留余量） */
export const CHUNK_SIZE = 9500;
/** 单次审核请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 5000;

export type RiskLevel = 'none' | 'low' | 'medium' | 'high';

/** 文本按 CHUNK_SIZE 切块（按字符）；空文本返回空数组 */
export function chunkText(text: string, size = CHUNK_SIZE): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacSha256Hex(key: string, data: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** 构造 ACS3-HMAC-SHA256 签名请求（导出供单测校验组装逻辑） */
export function buildSignedRequest(opts: {
  akId: string;
  akSecret: string;
  endpoint: string;
  action: string;
  body: string;
  /** ISO8601 无毫秒，如 2026-07-22T08:00:00Z */
  date: string;
  nonce: string;
}): SignedRequest {
  const { akId, akSecret, endpoint, action, body, date, nonce } = opts;
  const contentHash = sha256Hex(body);
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    host: endpoint,
    'x-acs-action': action,
    'x-acs-content-sha256': contentHash,
    'x-acs-date': date,
    'x-acs-signature-nonce': nonce,
    'x-acs-version': '2022-03-02',
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((k) => `${k}:${headers[k].trim()}`).join('\n') + '\n';
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, contentHash].join('\n');
  const stringToSign = `ACS3-HMAC-SHA256\n${sha256Hex(canonicalRequest)}`;
  const signature = hmacSha256Hex(akSecret, stringToSign);
  headers.authorization = `ACS3-HMAC-SHA256 Credential=${akId},SignedHeaders=${signedHeaders},Signature=${signature}`;
  return { url: `https://${endpoint}/`, headers, body };
}

/** 调用 TextModerationPlus 审核一段文本（≤CHUNK_SIZE），返回风险等级；异常抛错 */
export async function moderateChunk(content: string): Promise<RiskLevel> {
  const body = new URLSearchParams({
    Service: env.ALIYUN_GREEN_SERVICE,
    ServiceParameters: JSON.stringify({ content }),
  }).toString();
  const req = buildSignedRequest({
    akId: env.ALIYUN_AK_ID,
    akSecret: env.ALIYUN_AK_SECRET,
    endpoint: env.ALIYUN_GREEN_ENDPOINT,
    action: 'TextModerationPlus',
    body,
    date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    nonce: randomUUID(),
  });
  const res = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: req.body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = (await res.json()) as { Code?: number; Message?: string; Data?: { RiskLevel?: string } };
  if (!res.ok || data.Code !== 200) {
    throw new Error(`阿里云审核接口异常: http ${res.status}, code ${data.Code ?? '无'}, ${data.Message ?? ''}`);
  }
  const level = (data.Data?.RiskLevel ?? 'none').toLowerCase();
  return level === 'none' || level === 'low' || level === 'medium' || level === 'high'
    ? level
    : 'medium'; // 未知等级按需人工处理
}
