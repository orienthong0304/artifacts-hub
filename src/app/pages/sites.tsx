/**
 * /sites ZIP 站点托管管理页（契约 §3.9 前端）
 * 上传构建产物 ZIP → 发布为静态站点；更新 = 重新上传原子替换（链接不变）；配额来自 /api/me（契约 §3.12）。
 */
import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileArchive,
  Globe,
  Loader2,
  RefreshCw,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { siteApi, type Site } from '@/app/lib/api';
import { SITES_DOMAIN_SUFFIX } from '@/app/config';
import { useAuth } from '@/app/lib/auth';
import { formatRelativeTime } from '@/app/lib/format';



/** 子域前缀规则（契约 §3.9）：3-30 位小写字母/数字/连字符，首尾字母数字；保留字由后端拒绝 */
const SUBDOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{1,28})?[a-z0-9]$/;
const SUBDOMAIN_HINT = '前缀需为 3-30 位小写字母/数字/连字符，且首尾为字母或数字';

/** 前缀是否合法（长度 3-30 + 正则） */
function isValidSubdomain(v: string): boolean {
  return v.length >= 3 && v.length <= 30 && SUBDOMAIN_PATTERN.test(v);
}

/** 文件大小：B / KB / MB */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

/** 复制按钮：点击复制并短暂显示对勾反馈 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用时静默失败
    }
  };
  return (
    <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={handleCopy}>
      {copied ? (
        <Check className="mr-1 h-3.5 w-3.5 text-accent" />
      ) : (
        <Copy className="mr-1 h-3.5 w-3.5" />
      )}
      {copied ? '已复制' : '复制'}
    </Button>
  );
}

export default function SitesPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ---- 上传（创建）表单 ----
  const [title, setTitle] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [publishing, setPublishing] = useState(false);
  /** 刚发布成功的站点（展示 URL 引导） */
  const [freshSite, setFreshSite] = useState<Site | null>(null);
  const createFileRef = useRef<HTMLInputElement | null>(null);

  // ---- 更新流程：先选文件，再二次确认后 PUT ----
  const [pendingUpdate, setPendingUpdate] = useState<{ site: Site; file: File } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const updateFileRef = useRef<HTMLInputElement | null>(null);
  /** 当前点击「更新」的站点（等待文件选择） */
  const updateTargetRef = useRef<Site | null>(null);

  useEffect(() => {
    siteApi
      .list()
      .then((data) => setItems(data.items))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  // 站点配额生效值（契约 §3.12）：来自 /api/me，0 = 不限
  const siteQuota = user?.quotas?.sites ?? 0;
  const quotaReached = siteQuota > 0 && items.length >= siteQuota;

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !isValidSubdomain(subdomain)) return;
    setPublishing(true);
    setError('');
    setFreshSite(null);
    try {
      const { site } = await siteApi.create(file, title.trim(), subdomain);
      setItems((prev) => [site, ...prev]);
      setFreshSite(site);
      setTitle('');
      setSubdomain('');
      setFile(null);
      if (createFileRef.current) createFileRef.current.value = '';
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  /** 点击站点卡片「更新」：记录目标站点并弹出文件选择 */
  const startUpdate = (site: Site) => {
    updateTargetRef.current = site;
    updateFileRef.current?.click();
  };

  const handleUpdateFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    const target = updateTargetRef.current;
    // 重置 input，保证下次选同一文件也触发 change
    e.target.value = '';
    updateTargetRef.current = null;
    if (chosen && target) setPendingUpdate({ site: target, file: chosen });
  };

  const handleConfirmUpdate = async () => {
    if (!pendingUpdate) return;
    const { site, file: zip } = pendingUpdate;
    setPendingUpdate(null);
    setBusyId(site.id);
    setError('');
    try {
      const { site: updated } = await siteApi.update(site.id, zip);
      setItems((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (site: Site) => {
    setBusyId(site.id);
    setError('');
    try {
      await siteApi.remove(site.id);
      setItems((prev) => prev.filter((s) => s.id !== site.id));
      if (freshSite?.id === site.id) setFreshSite(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      {/* 标题与定位 */}
      <div className="mb-8">
        <h1 className="font-serif text-3xl font-bold text-ink">ZIP 站点托管</h1>
        <p className="mt-2 text-sm text-ink-muted">
          把 Vite / Next 等前端项目的构建产物（dist 目录打包成 ZIP）上传，变成
          <span className="font-mono text-xs"> https://你的前缀.{SITES_DOMAIN_SUFFIX} </span>
          的在线站点，前缀自定义。站点内的 SPA 路由（如 /login）自动回退到你的
          index.html。更新时重新上传即可，链接保持不变。
          {siteQuota > 0 ? `每人 ${siteQuota} 个站点。` : ''}
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* ===== 上传卡片 ===== */}
      <section className="mb-6 rounded-xl border border-line bg-surface p-5">
        <h2 className="mb-3 flex items-center gap-2 font-serif text-lg font-semibold text-ink">
          <UploadCloud className="h-4 w-4 text-accent" />
          发布新站点
        </h2>

        {quotaReached ? (
          <p className="text-sm text-ink-muted">
            每人 {siteQuota} 个站点，你已用完名额。可以直接「更新」现有站点（链接不变），
            或删除后再发布新站点。
          </p>
        ) : (
          <form onSubmit={handlePublish} className="space-y-4">
            <div>
              <Label htmlFor="site-title" className="mb-1.5 block text-xs text-ink-muted">
                站点标题（1-120 字）
              </Label>
              <Input
                id="site-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                required
                placeholder="例如：我的个人主页"
                className="h-9"
              />
            </div>

            <div>
              <Label htmlFor="site-subdomain" className="mb-1.5 block text-xs text-ink-muted">
                站点前缀（创建后不可修改）
              </Label>
              <div className="flex items-center gap-0">
                <Input
                  id="site-subdomain"
                  value={subdomain}
                  onChange={(e) => setSubdomain(e.target.value.trim().toLowerCase())}
                  maxLength={30}
                  required
                  placeholder="my-site"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-9 max-w-[200px] rounded-r-none font-mono text-sm"
                />
                <span className="flex h-9 items-center rounded-r-md border border-l-0 border-line bg-bg px-3 font-mono text-sm text-ink-muted">
                  .{SITES_DOMAIN_SUFFIX}
                </span>
              </div>
              <p
                className={`mt-1.5 text-xs ${
                  subdomain && !isValidSubdomain(subdomain) ? 'text-red-600' : 'text-ink-muted'
                }`}
              >
                {subdomain && !isValidSubdomain(subdomain)
                  ? SUBDOMAIN_HINT
                  : subdomain
                    ? `站点地址：https://${subdomain}.${SITES_DOMAIN_SUFFIX}/`
                    : '3-30 位小写字母/数字/连字符，作为你站点的专属子域'}
              </p>
            </div>

            <div>
              <Label className="mb-1.5 block text-xs text-ink-muted">ZIP 文件（≤10MB）</Label>
              <input
                ref={createFileRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => createFileRef.current?.click()}
                >
                  <FileArchive className="mr-1 h-4 w-4" />
                  {file ? '重新选择' : '选择 ZIP 文件'}
                </Button>
                {file && (
                  <span className="text-xs text-ink-muted">
                    {file.name}（{formatBytes(file.size)}）
                  </span>
                )}
              </div>
            </div>

            <Button
              type="submit"
              size="sm"
              className="rounded-full"
              disabled={publishing || !file || !title.trim() || !isValidSubdomain(subdomain)}
            >
              {publishing ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" /> 上传审核中…
                </>
              ) : (
                <>
                  <UploadCloud className="mr-1 h-4 w-4" /> 发布站点
                </>
              )}
            </Button>
          </form>
        )}

        {/* 发布成功提示 */}
        {freshSite && (
          <div className="mt-4 rounded-lg border border-accent/50 bg-accent/5 p-4">
            <div className="mb-2 text-sm font-medium text-ink">
              「{freshSite.title}」已发布，站点地址：
            </div>
            <div className="flex items-center gap-2">
              <a
                href={freshSite.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 overflow-x-auto rounded-md border border-line bg-bg px-3 py-2 font-mono text-sm text-accent underline-offset-2 hover:underline"
              >
                {freshSite.url}
              </a>
              <CopyButton text={freshSite.url} />
            </div>
          </div>
        )}

        {/* 要求说明折叠块 */}
        <Collapsible className="mt-4">
          <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-ink-muted hover:text-ink">
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
            ZIP 包要求
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 list-inside list-disc space-y-1 text-xs leading-relaxed text-ink-muted">
              <li>ZIP 文件 ≤ 10MB，解压后总量 ≤ 30MB，文件数 ≤ 200</li>
              <li>
                位图（PNG / JPG / GIF / WebP）≤ 20 张且合计 ≤ 5MB——本平台不提供图床服务，
                大量图片请托管到图片服务后以外链引用（SVG 与 ico 不计入这道配额）
              </li>
              <li>
                站点文件由服务器原样直出，平台不改写其中任何内容，因而<strong className="font-medium text-ink">
                无法为站点自动添加「AI 生成」标识</strong>。若站内页面属人工智能生成合成内容，
                请你自行在页面内标识（见《服务条款》第 6 节）
              </li>
              <li>
                根目录需含 <code className="font-mono">index.html</code>
                （若所有文件都在同一个顶层目录（如 <code className="font-mono">dist/</code>）里，
                会自动剥离该目录再判定）
              </li>
              <li>
                仅支持常见静态资源类型：HTML / CSS / JS / JSON / 图片 / 字体 / 音视频 /
                文本等，白名单外的文件（含无扩展名文件）会被拒绝
              </li>
              <li>站点内容需通过机器审核后才能发布</li>
              <li>
                站点是独立子域（https://前缀.{SITES_DOMAIN_SUFFIX}），/login 等 SPA
                路由未命中文件时自动回退到站点自身的 index.html
              </li>
            </ul>
          </CollapsibleContent>
        </Collapsible>
      </section>

      {/* ===== 站点列表 ===== */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-serif text-lg font-semibold text-ink">
          <Globe className="h-4 w-4 text-accent" />
          我的站点
        </h2>

        {/* 更新用的隐藏文件选择（全列表共用一个） */}
        <input
          ref={updateFileRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={handleUpdateFileChosen}
        />

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin text-accent" /> 正在加载…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line py-10 text-center">
            <Globe className="mx-auto mb-2 h-8 w-8 text-ink-muted/50" />
            <p className="text-sm text-ink-muted">
              还没有站点。把构建产物打包成 ZIP，在上方上传，一分钟拥有在线站点。
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((site) => (
              <li key={site.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{site.title}</div>
                    <div className="mt-0.5 text-xs text-ink-muted">
                      {formatBytes(site.sizeBytes)}
                      <span className="mx-1.5">·</span>
                      {site.fileCount} 个文件
                      <span className="mx-1.5">·</span>
                      更新于 {formatRelativeTime(site.updatedAt)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-ink-muted hover:text-ink"
                      disabled={busyId === site.id}
                      onClick={() => startUpdate(site)}
                    >
                      {busyId === site.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      <span className="ml-1">更新</span>
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-ink-muted hover:text-red-600"
                          disabled={busyId === site.id}
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="ml-1">删除</span>
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>删除站点「{site.title}」？</AlertDialogTitle>
                          <AlertDialogDescription>
                            站点文件将被删除，链接立即失效，且不可恢复。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-red-600 text-white hover:bg-red-700"
                            onClick={() => handleDelete(site)}
                          >
                            确认删除
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <a
                    href={site.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto rounded-md border border-line bg-bg px-3 py-1.5 font-mono text-xs text-accent underline-offset-2 hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    <span className="whitespace-nowrap">{site.url}</span>
                  </a>
                  <CopyButton text={site.url} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 更新二次确认（选完文件后弹出） */}
      <AlertDialog
        open={pendingUpdate !== null}
        onOpenChange={(open) => {
          if (!open) setPendingUpdate(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>更新站点「{pendingUpdate?.site.title}」？</AlertDialogTitle>
            <AlertDialogDescription>
              将用 {pendingUpdate?.file.name}（{pendingUpdate ? formatBytes(pendingUpdate.file.size) : ''}）
              替换站点全部内容。链接保持不变，替换是原子的：审核或校验失败时保留当前版本。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmUpdate}>确认上传</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
