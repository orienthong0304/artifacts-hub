/**
 * 顶部导航：wordmark + 搜索 + 登录/头像
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Globe,
  LogOut,
  Plus,
  Search,
  Shield,
  SquareLibrary,
  Terminal,
  User as UserIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { PRODUCT_NAME } from '@/app/config';
import { useAuth } from '@/app/lib/auth';

export default function SiteHeader() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [keyword, setKeyword] = useState(searchParams.get('q') || '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHome = location.pathname === '/';

  // 回到广场时同步 URL 中的关键词
  useEffect(() => {
    if (isHome) setKeyword(searchParams.get('q') || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHome]);

  /** 广场页内输入即防抖搜索；其它页面回车跳转广场 */
  const handleChange = (value: string) => {
    setKeyword(value);
    if (!isHome) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (value) next.set('q', value);
      else next.delete('q');
      next.delete('page');
      setSearchParams(next, { replace: true });
    }, 300);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isHome) navigate(keyword ? `/?q=${encodeURIComponent(keyword)}` : '/');
  };

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate('/');
    }
  };

  const initial = (user?.displayName || user?.username || '?').slice(0, 1).toUpperCase();

  /**
   * 把自己的实际高度发布成 --header-h（W2-2）。
   * 站头在窄屏会换成两行，高度不再是写死的 3.5rem；而编辑页用
   * `h-[calc(100dvh - 站头高)]` 撑满剩余视口——两边各写一个常数迟早对不上。
   * 由站头自报高度，改站头布局时不需要记得去改别处。
   *
   * 三条触发路径都要有，**不能只靠 ResizeObserver**：
   *   ① 依赖 [user, loading]——高度变化的实际原因就是登录态解析完、按钮出现导致首行变高；
   *   ② window resize——视口变化引起的换行；
   *   ③ ResizeObserver——兜底，且必须判存在（2026-07-27 实测有环境里它一次都不回调，
   *      连规范要求的首次观测回调都没有；只押它就会永远停在首帧的值）。
   */
  const headerRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`);
    publish();
    window.addEventListener('resize', publish);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    ro?.observe(el);
    return () => {
      window.removeEventListener('resize', publish);
      ro?.disconnect();
    };
  }, [user, loading]);

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur"
    >
      {/* 375px 下搜索框换到第二行（W2-2）：三个 flex 子项挤在一行时，
          输入框可见文字区只剩 56px，「搜索作品…」这个 placeholder 直接被裁掉。
          容器原本写死 h-14，光加 flex-wrap 会把第二行裁没，所以高度一并放开。 */}
      <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:h-14 sm:flex-nowrap sm:py-0 sm:px-6">
        {/* Wordmark（衬线体） */}
        <Link to="/" className="shrink-0 font-serif text-xl font-bold tracking-tight text-ink">
          {PRODUCT_NAME}
          <span className="ml-0.5 text-accent">.</span>
        </Link>

        {/* 搜索 */}
        <form
          onSubmit={handleSubmit}
          className="relative order-last w-full basis-full sm:order-none sm:mx-auto sm:basis-auto sm:max-w-md"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <Input
            value={keyword}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="搜索作品…"
            className="h-9 rounded-full border-line bg-surface pl-9 text-sm"
          />
        </form>

        {/* 登录 / 头像（搜索框换行后由这里靠右，桌面端仍由搜索框的 mx-auto 顶开） */}
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0">
          {loading ? null : user ? (
            <>
              <Button asChild size="sm" className="hidden rounded-full sm:inline-flex">
                <Link to="/new">
                  <Plus className="mr-1 h-4 w-4" />
                  新建作品
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="rounded-full outline-none ring-accent focus-visible:ring-2"
                    aria-label="账号菜单"
                  >
                    <Avatar className="h-8 w-8 border border-line">
                      <AvatarFallback className="bg-accent text-sm text-accent-ink">
                        {initial}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="truncate">
                    {user.displayName || user.username}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate('/new')}>
                    <Plus className="mr-2 h-4 w-4" /> 新建作品
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate('/me')}>
                    <SquareLibrary className="mr-2 h-4 w-4" /> 我的作品
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate(`/u/${user.username}`)}>
                    <UserIcon className="mr-2 h-4 w-4" /> 个人主页
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate('/sites')}>
                    <Globe className="mr-2 h-4 w-4" /> 站点
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate('/developers')}>
                    <Terminal className="mr-2 h-4 w-4" /> 开发者
                  </DropdownMenuItem>
                  {user.isAdmin && (
                    <DropdownMenuItem onSelect={() => navigate('/admin')}>
                      <Shield className="mr-2 h-4 w-4" /> 管理后台
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" /> 退出登录
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="rounded-full">
                <Link to="/login">登录</Link>
              </Button>
              <Button asChild size="sm" className="rounded-full">
                <Link to="/register">注册</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
