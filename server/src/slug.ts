// slug / token 生成：nanoid url-safe（契约文档第 2 节、§3.6）
import { customAlphabet } from 'nanoid';

/** url-safe 字母表：数字 + 大小写字母 + '-' '_' */
export const SLUG_ALPHABET =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';

export const SLUG_LENGTH = 8;

/** 生成 8 位 url-safe slug */
export const generateSlug: () => string = customAlphabet(SLUG_ALPHABET, SLUG_LENGTH);

/** 生成 8 位 url-safe 站点 slug（契约 §3.9：与 artifact slug 同风格但独立函数） */
export const generateSiteSlug: () => string = customAlphabet(SLUG_ALPHABET, SLUG_LENGTH);

/** 临时链接 token 长度（契约 §3.6）：16 位 url-safe */
export const TEMP_TOKEN_LENGTH = 16;

/** 生成 16 位 url-safe 临时链接 token */
export const generateTempToken: () => string = customAlphabet(SLUG_ALPHABET, TEMP_TOKEN_LENGTH);

/** API Token 前缀与随机段长度（契约 §3.8）：ak_ + 32 位 url-safe */
export const API_TOKEN_PREFIX = 'ak_';
export const API_TOKEN_LENGTH = 32;

const generateApiTokenBody = customAlphabet(SLUG_ALPHABET, API_TOKEN_LENGTH);

/** 生成 API Token 明文：ak_ + nanoid 32 位（高熵随机串，服务端只存 sha256） */
export function generateApiToken(): string {
  return `${API_TOKEN_PREFIX}${generateApiTokenBody()}`;
}
