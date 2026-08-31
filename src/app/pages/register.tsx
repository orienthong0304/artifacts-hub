/**
 * /register 注册页：居中卡片表单 + zod 校验
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/app/lib/auth';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@/app/config';

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{3,20}$/, '用户名为 3-20 位小写字母、数字、下划线或连字符'),
  email: z.string().trim().email('请输入有效的邮箱地址'),
  password: z.string().min(8, '密码至少 8 位'),
});

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const parsed = registerSchema.safeParse({ username, email, password });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      parsed.error.issues.forEach((i) => {
        const key = String(i.path[0]);
        if (!errors[key]) errors[key] = i.message;
      });
      setFieldErrors(errors);
      return;
    }
    // 校验通过：清除旧字段错误，避免未勾选条款 early return 时残留
    setFieldErrors({});
    if (!agreed) {
      setFormError('请先阅读并同意服务条款与隐私政策');
      return;
    }
    setSubmitting(true);
    try {
      await register(parsed.data.email, parsed.data.password, parsed.data.username);
      navigate('/', { replace: true });
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm rounded-card border-line shadow-sm">
        <CardHeader className="text-center">
          <CardTitle className="font-serif text-2xl">注册 {PRODUCT_NAME}</CardTitle>
          <CardDescription>{PRODUCT_TAGLINE}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="3-20 位小写字母 / 数字 / _ / -"
              />
              {fieldErrors.username && (
                <p className="text-sm text-destructive">{fieldErrors.username}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
              {fieldErrors.email && (
                <p className="text-sm text-destructive">{fieldErrors.email}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 位"
              />
              {fieldErrors.password && (
                <p className="text-sm text-destructive">{fieldErrors.password}</p>
              )}
            </div>
            <label className="flex items-start gap-2 text-sm text-ink-muted">
              <Checkbox
                checked={agreed}
                onCheckedChange={(v) => setAgreed(v === true)}
                className="mt-0.5"
              />
              <span>
                我已阅读并同意{' '}
                <Link to="/terms" target="_blank" className="text-accent underline-offset-4 hover:underline">
                  服务条款
                </Link>{' '}
                与{' '}
                <Link to="/privacy" target="_blank" className="text-accent underline-offset-4 hover:underline">
                  隐私政策
                </Link>
              </span>
            </label>
            {formError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            )}
            <Button type="submit" disabled={submitting} className="w-full rounded-full">
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              创建账号
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-ink-muted">
            已有账号？{' '}
            <Link to="/login" className="text-accent underline-offset-4 hover:underline">
              直接登录
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
