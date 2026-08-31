/**
 * 登录守卫：未登录跳转 /login；admin 模式额外校验管理员身份
 */
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/app/lib/auth';

interface RequireAuthProps {
  children: React.ReactNode;
  /** 仅管理员可访问 */
  admin?: boolean;
}

export default function RequireAuth({ children, admin = false }: RequireAuthProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-ink-muted">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-accent" />
        正在加载…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (admin && !user.isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
