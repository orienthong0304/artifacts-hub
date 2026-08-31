/**
 * Admin 用户管理面板（契约 §3.12）：SaaS 版手工运营的操作面。
 * 付费先不接支付渠道——站长收款后在这里调档位（free/member）与逐项配额覆盖；
 * 调整无缓存层，保存即生效。
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Search, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { adminApi, type AdminUser, type QuotaKey } from '@/app/lib/api';
import { formatRelativeTime } from '@/app/lib/format';

const QUOTA_LABELS: Record<QuotaKey, string> = {
  customPaths: '自定义路径',
  sites: 'ZIP 站点',
  apiTokens: 'API Token',
  dailyCreates: '日发布',
};

/** free 档默认值（仅作输入框占位提示；真值在服务端 quota.ts，member 档一律不限） */
const FREE_HINTS: Record<QuotaKey, string> = {
  customPaths: '默认 10',
  sites: '默认 3',
  apiTokens: '默认 10',
  dailyCreates: '默认 10',
};

export default function AdminUsersPanel() {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<AdminUser | null>(null);

  const pageSize = 20;

  const load = useCallback(async (query: string, p: number) => {
    setLoading(true);
    setError('');
    try {
      const data = await adminApi.users({ q: query || undefined, page: p, pageSize });
      setItems(data.items);
      setTotal(data.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(q, page);
    // q 由表单提交触发，避免每键一次请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    load(q, 1);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section>
      <h2 className="mb-3 font-serif text-xl font-semibold text-ink">用户管理（{total}）</h2>
      <form onSubmit={search} className="mb-4 flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索用户名或邮箱…"
          className="h-9 max-w-xs bg-surface"
        />
        <Button type="submit" size="sm" variant="outline" className="h-9 rounded-full">
          <Search className="mr-1 h-3.5 w-3.5" /> 搜索
        </Button>
      </form>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12 text-ink-muted">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-accent" /> 正在加载…
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-muted">没有匹配的用户。</p>
      ) : (
        <ul className="space-y-2">
          {items.map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{u.displayName || u.username}</span>
                  <span className="text-xs text-ink-muted">@{u.username}</span>
                  {u.plan === 'member' && (
                    <Badge className="bg-accent/15 text-accent hover:bg-accent/15">会员</Badge>
                  )}
                  {u.isTrusted && (
                    <Badge variant="outline" className="gap-1 border-line text-xs text-ink-muted">
                      <ShieldCheck className="h-3 w-3" /> 已信任
                    </Badge>
                  )}
                  {Object.keys(u.quotaOverrides).length > 0 && (
                    <Badge variant="outline" className="border-line text-xs text-ink-muted">
                      配额已覆盖
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-ink-muted">
                  {u.email} · 作品 {u.stats.artifacts} · 站点 {u.stats.sites} · 路径{' '}
                  {u.stats.customPaths} · Token {u.stats.activeTokens} · 注册于{' '}
                  {formatRelativeTime(u.createdAt)}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0 rounded-full"
                onClick={() => setEditing(u)}
              >
                <Pencil className="mr-1 h-3.5 w-3.5" /> 调整
              </Button>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm text-ink-muted">
          <Button
            size="sm"
            variant="ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </Button>
          <span>
            {page} / {totalPages}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}

      {editing && (
        <EditUserDialog
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setItems((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function EditUserDialog({
  user,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  onClose: () => void;
  onSaved: (u: AdminUser) => void;
}) {
  const [plan, setPlan] = useState<'free' | 'member'>(user.plan === 'member' ? 'member' : 'free');
  const [trusted, setTrusted] = useState(user.isTrusted);
  // 覆盖输入以字符串保存：'' = 未覆盖（回落档位默认）
  const [overrides, setOverrides] = useState<Record<QuotaKey, string>>({
    customPaths: user.quotaOverrides.customPaths?.toString() ?? '',
    sites: user.quotaOverrides.sites?.toString() ?? '',
    apiTokens: user.quotaOverrides.apiTokens?.toString() ?? '',
    dailyCreates: user.quotaOverrides.dailyCreates?.toString() ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      // 空串 = 删除覆盖（null）；数字 = 写覆盖。全量提交四项，语义与后台合并规则一致
      const quotaOverrides = Object.fromEntries(
        (Object.keys(QUOTA_LABELS) as QuotaKey[]).map((key) => [
          key,
          overrides[key].trim() === '' ? null : Number.parseInt(overrides[key], 10),
        ]),
      ) as Partial<Record<QuotaKey, number | null>>;
      const { user: updated } = await adminApi.updateUser(user.id, {
        plan,
        isTrusted: trusted,
        quotaOverrides,
      });
      onSaved(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>调整用户 @{user.username}</DialogTitle>
          <DialogDescription>
            档位与配额保存即生效。配额留空走档位默认，填 0 表示不限。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>档位</Label>
            <Select value={plan} onValueChange={(v) => setPlan(v as 'free' | 'member')}>
              <SelectTrigger className="bg-surface">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">免费</SelectItem>
                <SelectItem value="member">会员（全部不限量）</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>信任用户</Label>
              <p className="text-xs text-ink-muted">跳过发布护栏；公开作品仍走机审</p>
            </div>
            <Switch checked={trusted} onCheckedChange={setTrusted} />
          </div>

          <div className="space-y-1.5">
            <Label>配额覆盖（优先于档位默认）</Label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(QUOTA_LABELS) as QuotaKey[]).map((key) => (
                <div key={key} className="space-y-1">
                  <span className="text-xs text-ink-muted">{QUOTA_LABELS[key]}</span>
                  <Input
                    type="number"
                    min={0}
                    value={overrides[key]}
                    placeholder={FREE_HINTS[key]}
                    onChange={(e) =>
                      setOverrides((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    className="h-8 bg-surface text-sm"
                  />
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button className="rounded-full" onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
