// JWT 签发 / 校验往返单测
import { describe, it, expect } from 'vitest';
import { signToken, verifyToken } from '../src/auth.js';

const SECRET = 'test-secret-for-unit-tests';

describe('signToken / verifyToken', () => {
  it('签发后可校验并取回用户 id', async () => {
    const userId = 'a5b2c9f0-0000-0000-0000-000000000001';
    const token = await signToken(userId, SECRET);
    expect(token.split('.')).toHaveLength(3);
    await expect(verifyToken(token, SECRET)).resolves.toBe(userId);
  });

  it('密钥不符校验失败', async () => {
    const token = await signToken('user-1', SECRET);
    await expect(verifyToken(token, 'another-secret')).resolves.toBeNull();
  });

  it('被篡改的 token 校验失败', async () => {
    const token = await signToken('user-1', SECRET);
    const tampered = token.slice(0, -4) + 'AAAA';
    await expect(verifyToken(tampered, SECRET)).resolves.toBeNull();
    await expect(verifyToken('not-a-jwt', SECRET)).resolves.toBeNull();
    await expect(verifyToken('', SECRET)).resolves.toBeNull();
  });
});
