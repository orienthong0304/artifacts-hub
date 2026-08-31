/**
 * /u/:username 用户公开主页：资料 + 公开作品
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import ArtifactCard from '@/app/components/artifact-card';
import { ApiError, userApi, type Artifact, type User } from '@/app/lib/api';
import { formatDate } from '@/app/lib/format';

export default function UserProfilePage() {
  const { username = '' } = useParams();
  const [profile, setProfile] = useState<{ user: User; artifacts: Artifact[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setProfile(null);
    userApi
      .get(username)
      .then((res) => {
        if (!cancelled) setProfile(res);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) setError('该用户不存在。');
        else setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-ink-muted">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-accent" />
        正在加载…
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <p className="font-serif text-2xl text-ink">无法访问该主页</p>
        <p className="mt-3 text-sm text-ink-muted">{error || '未知错误'}</p>
        <Button asChild className="mt-8 rounded-full">
          <Link to="/">回到广场</Link>
        </Button>
      </div>
    );
  }

  const { user, artifacts } = profile;
  const name = user.displayName || user.username;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      {/* 资料区 */}
      <section className="mb-10 flex items-center gap-5">
        <Avatar className="h-16 w-16 border border-line">
          <AvatarFallback className="bg-accent font-serif text-2xl text-accent-ink">
            {name.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h1 className="truncate font-serif text-3xl font-bold text-ink">{name}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            @{user.username} · {formatDate(user.createdAt)} 加入 · {artifacts.length} 个公开作品
          </p>
          {user.bio && <p className="mt-2 max-w-xl text-sm text-ink">{user.bio}</p>}
        </div>
      </section>

      {/* 公开作品 */}
      {artifacts.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-surface/60 px-6 py-20 text-center">
          <p className="font-serif text-xl text-ink">还没有公开作品</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {artifacts.map((a) => (
            <ArtifactCard key={a.id} artifact={a} showAuthor={false} />
          ))}
        </div>
      )}
    </div>
  );
}
