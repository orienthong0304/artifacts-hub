/**
 * /login 登录页：居中卡片表单 + zod 校验
 */
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/app/lib/auth';
import { PRODUCT_NAME } from '@/app/config';

const loginSchema = z.object({
  email: z.string().trim().email('请输入有效的邮箱地址'),
  password: z.string().min(8, '密码至少 8 位'),
});

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || '/';
  // next 回跳（契约 §3.10 子域换票）：仅接受站内相对路径，`//` 与 `\` 一并拒绝防开放跳转
  const rawNext = new URLSearchParams(location.search).get('next');
  const next =
    rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.includes('\\')
      ? rawNext
      : null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      parsed.error.issues.forEach((i) => {
        const key = String(i.path[0]);
        if (!errors[key]) errors[key] = i.message;
      });
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      await login(parsed.data.email, parsed.data.password);
      if (next) {
        // next 可能指向 /api/* 服务端端点（如子域换票），必须整页跳转而非 SPA 路由
        window.location.replace(next);
        return;
      }
      navigate(from, { replace: true });
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
          <CardTitle className="font-serif text-2xl">登录 {PRODUCT_NAME}</CardTitle>
          <CardDescription>欢迎回来，继续你的创作。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
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
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 位"
              />
              {fieldErrors.password && (
                <p className="text-sm text-destructive">{fieldErrors.password}</p>
              )}
            </div>
            {formError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            )}
            <Button type="submit" disabled={submitting} className="w-full rounded-full">
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              登录
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-ink-muted">
            还没有账号？{' '}
            <Link to="/register" className="text-accent underline-offset-4 hover:underline">
              免费注册
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
