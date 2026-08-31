/**
 * 404 页
 */
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      <p className="font-serif text-7xl font-bold text-ink">
        4<span className="text-accent">0</span>4
      </p>
      <p className="mt-4 font-serif text-xl text-ink">这个页面不存在</p>
      <p className="mt-2 text-sm text-ink-muted">它可能被移动、删除，或者从未存在过。</p>
      <Button asChild className="mt-8 rounded-full px-6">
        <Link to="/">回到广场</Link>
      </Button>
    </div>
  );
}
