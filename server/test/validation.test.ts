// zod 校验规则单测
import { describe, it, expect } from 'vitest';
import {
  registerSchema,
  loginSchema,
  createArtifactSchema,
  updateArtifactSchema,
  createTempLinkSchema,
  reportSchema,
  siteSubdomainSchema,
  takedownSchema,
  zodMessage,
  CODE_MAX_BYTES,
  userPrefixSchema,
  customPathSchema,
} from '../src/validation.js';

describe('registerSchema', () => {
  it('接受合法输入', () => {
    const result = registerSchema.safeParse({
      email: 'a@example.com',
      password: '12345678',
      username: 'user_01-x',
      agreeTerms: true,
    });
    expect(result.success).toBe(true);
  });

  it('未勾选同意条款报中文错误', () => {
    for (const agreeTerms of [undefined, false]) {
      const result = registerSchema.safeParse({
        email: 'a@example.com',
        password: '12345678',
        username: 'user01',
        agreeTerms,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(zodMessage(result.error)).toBe('请先阅读并同意服务条款与隐私政策');
      }
    }
  });

  it('密码不足 8 位报中文错误', () => {
    const result = registerSchema.safeParse({
      email: 'a@example.com',
      password: '1234567',
      username: 'user01',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(zodMessage(result.error)).toBe('密码至少 8 位');
  });

  it('拒绝非法用户名（大写 / 过短 / 过长 / 非法字符）', () => {
    for (const username of ['User01', 'ab', 'a'.repeat(21), '你好user', 'a b']) {
      const result = registerSchema.safeParse({
        email: 'a@example.com',
        password: '12345678',
        username,
      });
      expect(result.success).toBe(false);
    }
  });

  it('拒绝非法邮箱', () => {
    const result = registerSchema.safeParse({
      email: 'not-an-email',
      password: '12345678',
      username: 'user01',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(zodMessage(result.error)).toBe('邮箱格式不正确');
  });
});

describe('loginSchema', () => {
  it('缺字段报错', () => {
    expect(loginSchema.safeParse({}).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.c', password: 'x' }).success).toBe(true);
  });
});

describe('createArtifactSchema', () => {
  const base = { title: '测试作品', type: 'react', code: 'export default () => null' };

  it('visibility 默认 public', () => {
    const result = createArtifactSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.visibility).toBe('public');
  });

  it('拒绝非法 type 与 visibility', () => {
    expect(createArtifactSchema.safeParse({ ...base, type: 'vue' }).success).toBe(false);
    expect(
      createArtifactSchema.safeParse({ ...base, visibility: 'secret' }).success
    ).toBe(false);
  });

  it('代码按字节数限制 500KB', () => {
    const ok = createArtifactSchema.safeParse({ ...base, code: 'a'.repeat(CODE_MAX_BYTES) });
    expect(ok.success).toBe(true);
    const tooBig = createArtifactSchema.safeParse({
      ...base,
      code: 'a'.repeat(CODE_MAX_BYTES + 1),
    });
    expect(tooBig.success).toBe(false);
    if (!tooBig.success) expect(zodMessage(tooBig.error)).toBe('代码不能超过 500KB');
    // 多字节字符：一个中文字符 3 字节
    const multiByte = createArtifactSchema.safeParse({
      ...base,
      code: '汉'.repeat(Math.floor(CODE_MAX_BYTES / 3) + 1),
    });
    expect(multiByte.success).toBe(false);
  });

  it('标题去空白后不能为空', () => {
    expect(createArtifactSchema.safeParse({ ...base, title: '   ' }).success).toBe(false);
  });
});

describe('updateArtifactSchema', () => {
  it('至少提供一个字段', () => {
    expect(updateArtifactSchema.safeParse({}).success).toBe(false);
    expect(updateArtifactSchema.safeParse({ title: '新标题' }).success).toBe(true);
    expect(updateArtifactSchema.safeParse({ visibility: 'private' }).success).toBe(true);
  });

  it('description 允许显式置空', () => {
    expect(updateArtifactSchema.safeParse({ description: null }).success).toBe(true);
  });
});

describe('reportSchema / takedownSchema', () => {
  it('举报理由必填', () => {
    expect(reportSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(reportSchema.safeParse({ reason: '违规内容' }).success).toBe(true);
  });

  it('takenDown 必须是布尔值', () => {
    expect(takedownSchema.safeParse({ takenDown: 'true' }).success).toBe(false);
    expect(takedownSchema.safeParse({ takenDown: true }).success).toBe(true);
  });
});

describe('createTempLinkSchema（契约 §3.6）', () => {
  it('接受全部合法档位', () => {
    for (const expiresInHours of [1, 6, 12, 24, 72, 168, 720]) {
      expect(createTempLinkSchema.safeParse({ expiresInHours }).success).toBe(true);
    }
  });

  it('非法档位报「有效期不合法」', () => {
    for (const expiresInHours of [0, 2, 48, -1, '24', undefined]) {
      const result = createTempLinkSchema.safeParse({ expiresInHours });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(zodMessage(result.error)).toBe('有效期不合法');
      }
    }
  });

  it('note 可选，超 200 字报中文错误', () => {
    expect(createTempLinkSchema.safeParse({ expiresInHours: 24 }).success).toBe(true);
    expect(
      createTempLinkSchema.safeParse({ expiresInHours: 24, note: '给客户预览' }).success
    ).toBe(true);
    const result = createTempLinkSchema.safeParse({ expiresInHours: 24, note: '啊'.repeat(201) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(zodMessage(result.error)).toBe('备注不能超过 200 字');
    }
  });
});

describe('siteSubdomainSchema（契约 §3.9 自定义子域）', () => {
  it('接受合法前缀：3-30 位小写字母/数字/连字符，首尾字母数字', () => {
    for (const v of ['abc', 'my-site01', 'a1-b2-c3', 'a'.repeat(30), '123']) {
      const result = siteSubdomainSchema.safeParse(v);
      expect(result.success, `subdomain=${v}`).toBe(true);
    }
  });

  it('拒绝非法前缀（大写/下划线/太短/太长/首尾连字符/空）并报中文错误', () => {
    for (const v of ['MySite', 'my_site', 'ab', 'a'.repeat(31), '-abc', 'abc-', '', undefined]) {
      const result = siteSubdomainSchema.safeParse(v);
      expect(result.success, `subdomain=${String(v)}`).toBe(false);
      if (!result.success) {
        expect(zodMessage(result.error)).toBe(
          '前缀需为 3-30 位小写字母/数字/连字符，且首尾为字母或数字'
        );
      }
    }
  });

  it('拒绝保留字（www/api/run/login 等）并报中文错误', () => {
    for (const v of ['www', 'api', 'run', 'admin', 'login', 'static', 'ns1']) {
      const result = siteSubdomainSchema.safeParse(v);
      expect(result.success, `subdomain=${v}`).toBe(false);
      if (!result.success) {
        expect(zodMessage(result.error)).toBe('该前缀为保留字，不能使用');
      }
    }
  });
});

describe('用户前缀与自定义路径(契约 §3.10)', () => {
  it('前缀与站点子域同规则同保留字', () => {
    expect(userPrefixSchema.safeParse('orient').success).toBe(true);
    expect(userPrefixSchema.safeParse('www').success).toBe(false); // 保留字
    expect(userPrefixSchema.safeParse('-bad').success).toBe(false);
  });
  it('路径:1-3 段小写字母数字连字符,总长 ≤128', () => {
    expect(customPathSchema.safeParse('my-page').success).toBe(true);
    expect(customPathSchema.safeParse('docs/intro/part-1').success).toBe(true);
    expect(customPathSchema.safeParse('a/b/c/d').success).toBe(false); // 4 段
    expect(customPathSchema.safeParse('Has-Upper').success).toBe(false);
    expect(customPathSchema.safeParse('favicon.ico').success).toBe(false); // 带点天然不合法
    expect(customPathSchema.safeParse('__subauth').success).toBe(false); // 下划线天然不合法
    expect(customPathSchema.safeParse('a'.repeat(129)).success).toBe(false);
    expect(customPathSchema.safeParse('a//b').success).toBe(false); // 空段
  });
});
