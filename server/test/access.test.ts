// 访问密码（契约 §3.1）单测：accessPassword 校验、访问令牌往返、锁定形态序列化
import { describe, it, expect } from 'vitest';
import {
  createArtifactSchema,
  updateArtifactSchema,
  unlockSchema,
  zodMessage,
} from '../src/validation.js';
import {
  signToken,
  verifyToken,
  signArtifactAccessToken,
  verifyArtifactAccessToken,
} from '../src/auth.js';
import { serializeArtifact, serializeLockedArtifact } from '../src/serialize.js';
import type { ArtifactWithAuthorRow } from '../src/db.js';

const SECRET = 'test-secret-for-unit-tests';

describe('accessPassword 校验规则', () => {
  const base = { title: '测试作品', type: 'react', code: 'export default () => null' };

  it('缺省 / null / 4-64 位字符串均合法', () => {
    const absent = createArtifactSchema.safeParse(base);
    expect(absent.success).toBe(true);
    if (absent.success) expect(absent.data.accessPassword).toBeUndefined();

    const cleared = createArtifactSchema.safeParse({ ...base, accessPassword: null });
    expect(cleared.success).toBe(true);
    if (cleared.success) expect(cleared.data.accessPassword).toBeNull();

    expect(createArtifactSchema.safeParse({ ...base, accessPassword: '1234' }).success).toBe(true);
    expect(
      createArtifactSchema.safeParse({ ...base, accessPassword: 'a'.repeat(64) }).success
    ).toBe(true);
  });

  it('过短 / 过长 / 非字符串报中文错误', () => {
    const tooShort = createArtifactSchema.safeParse({ ...base, accessPassword: '123' });
    expect(tooShort.success).toBe(false);
    if (!tooShort.success) expect(zodMessage(tooShort.error)).toBe('访问密码至少 4 位');

    const tooLong = createArtifactSchema.safeParse({
      ...base,
      accessPassword: 'a'.repeat(65),
    });
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) expect(zodMessage(tooLong.error)).toBe('访问密码不能超过 64 位');

    expect(createArtifactSchema.safeParse({ ...base, accessPassword: 1234 }).success).toBe(false);
  });

  it('更新时仅提供 accessPassword 也满足「至少一个字段」', () => {
    expect(updateArtifactSchema.safeParse({ accessPassword: 'abcd' }).success).toBe(true);
    expect(updateArtifactSchema.safeParse({ accessPassword: null }).success).toBe(true);
    expect(updateArtifactSchema.safeParse({}).success).toBe(false);
  });

  it('unlockSchema：password 必填非空', () => {
    expect(unlockSchema.safeParse({}).success).toBe(false);
    expect(unlockSchema.safeParse({ password: '' }).success).toBe(false);
    expect(unlockSchema.safeParse({ password: '1234' }).success).toBe(true);
  });
});

describe('作品访问令牌签发 / 校验', () => {
  const artifactId = 'f0e1d2c3-0000-0000-0000-000000000042';

  it('签发后可校验并取回 artifactId', async () => {
    const token = await signArtifactAccessToken(artifactId, SECRET);
    expect(token.split('.')).toHaveLength(3);
    await expect(verifyArtifactAccessToken(token, SECRET)).resolves.toBe(artifactId);
  });

  it('密钥不符 / 被篡改校验失败', async () => {
    const token = await signArtifactAccessToken(artifactId, SECRET);
    await expect(verifyArtifactAccessToken(token, 'another-secret')).resolves.toBeNull();
    const tampered = token.slice(0, -4) + 'AAAA';
    await expect(verifyArtifactAccessToken(tampered, SECRET)).resolves.toBeNull();
    await expect(verifyArtifactAccessToken('not-a-jwt', SECRET)).resolves.toBeNull();
  });

  it('登录 token 与访问令牌不可互换（typ 隔离）', async () => {
    // 登录 token（无 typ）不能当访问令牌用
    const loginToken = await signToken('user-1', SECRET);
    await expect(verifyArtifactAccessToken(loginToken, SECRET)).resolves.toBeNull();
    // 访问令牌（typ=artifact-access）不能当登录态用
    const accessToken = await signArtifactAccessToken(artifactId, SECRET);
    await expect(verifyToken(accessToken, SECRET)).resolves.toBeNull();
  });
});

describe('锁定形态序列化', () => {
  const row: ArtifactWithAuthorRow = {
    id: 'f0e1d2c3-0000-0000-0000-000000000042',
    user_id: 'a5b2c9f0-0000-0000-0000-000000000001',
    slug: 'abc12345',
    title: '加密作品',
    description: '不该出现在锁定形态里',
    type: 'react',
    code: 'export default () => null',
    visibility: 'public',
    access_password_hash: '$2a$10$fakehashfakehashfakehashfakehash',
    views: 7,
    is_taken_down: false,
    created_at: new Date('2026-07-20T00:00:00Z'),
    updated_at: new Date('2026-07-21T00:00:00Z'),
    author_username: 'author01',
    author_display_name: '作者',
  };

  it('锁定形态只含契约规定字段，不含 code / description / views / 哈希', () => {
    const locked = serializeLockedArtifact(row);
    expect(locked).toEqual({
      slug: 'abc12345',
      title: '加密作品',
      type: 'react',
      visibility: 'public',
      hasPassword: true,
      locked: true,
      author: { username: 'author01', displayName: '作者' },
      createdAt: '2026-07-20T00:00:00.000Z',
    });
    expect(locked).not.toHaveProperty('code');
    expect(locked).not.toHaveProperty('description');
    expect(locked).not.toHaveProperty('views');
    expect(JSON.stringify(locked)).not.toContain(row.access_password_hash);
  });

  it('正常序列化派生 hasPassword，且任何形态都不输出哈希', () => {
    const withCode = serializeArtifact(row, { includeCode: true });
    expect(withCode.hasPassword).toBe(true);
    expect(JSON.stringify(withCode)).not.toContain(row.access_password_hash);
    expect(withCode).not.toHaveProperty('access_password_hash');
    expect(withCode).not.toHaveProperty('accessPasswordHash');

    const noPassword = serializeArtifact({ ...row, access_password_hash: null });
    expect(noPassword.hasPassword).toBe(false);
  });
});
