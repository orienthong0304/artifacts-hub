/**
 * /new 与 /edit/:id 创建/编辑页：左编辑（类型/代码/信息）右实时预览（防抖 800ms）
 *
 * 能力波次 2：代码框换 CodeMirror 6（懒加载，见 code-editor.tsx）、
 * 粘贴自动剥 markdown 围栏并嗅探类型、字节计数、手机端可切到预览、
 * 未登录也能进来粘代码看效果（发布时才要求登录，草稿不丢）。
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import {
  Code2,
  FileCode2,
  KeyRound,
  Loader2,
  LogIn,
  Monitor,
  Smartphone,
  Sparkles,
  Tablet,
  Upload,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';
import RunnerFrame from '@/app/components/runner-frame';
import CodeEditor, { type CodeEditorHandle } from '@/app/components/code-editor';
import {
  artifactApi,
  type Artifact,
  type ArtifactType,
  type Visibility,
} from '@/app/lib/api';
import { isPendingPublic, PENDING_TEXT } from '@/app/components/review-status';
import { useAuth } from '@/app/lib/auth';
import { SITES_DOMAIN_SUFFIX } from '@/app/config';
import { extractTitle } from '@/app/lib/extract-title';
import {
  byteLength,
  cleanPastedCode,
  formatBytes,
  MAX_CODE_BYTES,
  sniffKind,
} from '@/app/lib/paste-clean';
import { cn } from '@/lib/utils';

/** 未登录时点发布：草稿暂存在 sessionStorage，登录回来自动接上（只存用户自己的代码，不含任何凭证） */
const DRAFT_KEY = 'artifacts:draft:new';

/** 自定义路径校验（契约 §3.10）：1-3 段，每段 1-64 位小写字母/数字/连字符，总长 ≤128 */
const CUSTOM_PATH_SEGMENT_RE = /^[a-z0-9-]{1,64}$/;
function validateCustomPath(path: string): string {
  if (!path) return '';
  if (path.length > 128) return '路径总长不能超过 128 字符';
  const segments = path.split('/');
  if (segments.length > 3) return '路径最多 3 段（段间用 / 分隔）';
  if (!segments.every((s) => CUSTOM_PATH_SEGMENT_RE.test(s))) {
    return '每段需为 1-64 位小写字母、数字或连字符，段间用 / 分隔';
  }
  return '';
}

const formSchema = z.object({
  // 上限与 server/src/validation.ts titleSchema、lib/extract-title.ts 的提取窗口一致（120）：
  // 早先前端写 100，导致自动提取出的 100-120 字标题必然被我方自己的表单拒收
  title: z.string().trim().min(1, '请填写标题').max(120, '标题最多 120 字'),
  description: z.string().trim().max(500, '描述最多 500 字').optional(),
  code: z
    .string()
    .min(1, '请粘贴或上传代码')
    .refine((c) => byteLength(c) <= MAX_CODE_BYTES, {
      message: '代码不能超过 500KB',
    }),
});

const VISIBILITY_OPTIONS: { value: Visibility; label: string; hint: string }[] = [
  { value: 'public', label: '公开', hint: '出现在广场，所有人可见' },
  { value: 'unlisted', label: '不公开列出', hint: '不进广场，知道链接的人可见' },
  { value: 'private', label: '私密', hint: '仅自己可见（设密码后持密码者也可看）' },
];

export default function EditorPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<CodeEditorHandle>(null);

  const [type, setType] = useState<ArtifactType>('react');
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  // 生成合成内容声明（契约 §3.11）：缺省 true——本平台承载的就是 AI 生成的页面，
  // 而漏标一条生成内容的代价大于给一条非生成内容误标
  const [aiGenerated, setAiGenerated] = useState(true);

  /** 粘贴清洗提示（可撤销）：我们动了用户的输入，就必须说清动了什么、并且能退回去 */
  const [pasteNote, setPasteNote] = useState<{ note: string; before: string } | null>(null);

  // 访问密码（契约 §3.1：留空 = 不变/不设；编辑模式可清除）
  const [accessPassword, setAccessPasswordInput] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);

  // 自定义路径（契约 §3.10：需先领子域前缀；编辑模式回填，保存时有变化才提交）
  const [customPath, setCustomPathInput] = useState('');
  const [initialCustomPath, setInitialCustomPath] = useState('');

  /** 预览宽度：full=撑满 / tablet=768px / mobile=375px */
  const [previewWidth, setPreviewWidth] = useState<'full' | 'tablet' | 'mobile'>('full');
  /** 手机端单栏：编辑 / 预览（此前预览是 hidden lg:flex，手机上等于没有实时预览） */
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit');
  /** 用户是否手动改过标题（改过则不再自动提取覆盖） */
  const titleTouchedRef = useRef(false);

  const [initLoading, setInitLoading] = useState(isEdit);
  const [initError, setInitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const codeBytes = byteLength(code);
  const overLimit = codeBytes > MAX_CODE_BYTES;

  /** 输入即清除该字段的报错（计划 W1-9）：错误提示不该在用户已经开始修正时还挂着 */
  const clearFieldError = (key: string) =>
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

  // 编辑模式：先在我的列表中定位（拿 slug），再取详情（拿 code）
  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    (async () => {
      try {
        const { items } = await artifactApi.listMine();
        const mine = items.find((a: Artifact) => a.id === id);
        if (!mine) {
          if (!cancelled) setInitError('作品不存在，或不属于你。');
          return;
        }
        const { artifact } = await artifactApi.get(mine.slug);
        if (cancelled) return;
        setType(artifact.type);
        setCode(artifact.code || '');
        setTitle(artifact.title);
        setDescription(artifact.description || '');
        setVisibility(artifact.visibility);
        setAiGenerated(artifact.aiGenerated);
        setHasPassword(artifact.hasPassword);
        setCustomPathInput(artifact.customPath || '');
        setInitialCustomPath(artifact.customPath || '');
      } catch (e) {
        if (!cancelled) setInitError((e as Error).message);
      } finally {
        if (!cancelled) setInitLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, id]);

  /** 新建模式：登录回跳后接上此前的草稿（读完即删，不留存） */
  useEffect(() => {
    if (isEdit) return;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      return; // 隐私模式等禁用 sessionStorage 的场景，直接算没有草稿
    }
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      if (typeof d.code === 'string' && d.code) {
        setCode(d.code);
        if (d.type === 'html' || d.type === 'react') setType(d.type);
        if (typeof d.title === 'string' && d.title) {
          setTitle(d.title);
          titleTouchedRef.current = true;
        }
        if (typeof d.description === 'string') setDescription(d.description);
        if (['public', 'unlisted', 'private'].includes(d.visibility)) setVisibility(d.visibility);
        toast({ title: '草稿已恢复', description: '刚才粘贴的代码还在，可以直接发布了。' });
      }
    } catch {
      /* 草稿损坏就当没有 */
    }
  }, [isEdit]);

  /** 跳到代码框的第 N 行并选中（错误卡的「跳到第 N 行」；CodeMirror 与降级 Textarea 两种实现都在组件内） */
  const jumpToLine = (line: number) => codeRef.current?.jumpToLine(line);

  /** 代码变化时尝试自动填充标题（新建模式、用户未手动改标题时才生效） */
  const maybeFillTitle = (nextCode: string, nextType: ArtifactType) => {
    if (isEdit || titleTouchedRef.current) return;
    const extracted = extractTitle(nextCode, nextType);
    if (extracted) setTitle(extracted);
  };

  /**
   * 整篇粘贴（W2-1 粘贴即成功）：剥 markdown 围栏 + 嗅探类型。
   * 只有「粘贴会替换掉整个文档」时才触发（见 code-editor.tsx 的判据）。
   * 返回 null = 不改写，走浏览器默认粘贴。
   */
  const handleFullPaste = (raw: string): string | null => {
    const cleaned = cleanPastedCode(raw);
    const sniffed = sniffKind(cleaned.code, cleaned.fenceLang);
    // 编辑模式类型锁定（契约：类型不可改），只嗅探不切换
    if (sniffed && !isEdit && sniffed !== type) setType(sniffed);
    const nextType: ArtifactType = !isEdit && sniffed ? sniffed : type;
    maybeFillTitle(cleaned.code, nextType);
    clearFieldError('code');
    if (!cleaned.changed) {
      setPasteNote(null);
      return null;
    }
    setPasteNote({ note: cleaned.note, before: raw });
    return cleaned.code;
  };

  /** 撤销粘贴清洗：把原始粘贴内容放回去 */
  const undoPasteClean = () => {
    if (!pasteNote) return;
    setCode(pasteNote.before);
    setPasteNote(null);
  };

  /** 上传 .tsx/.jsx/.html 文件：读取文本，按扩展名定类型，内容同样走围栏剥离 */
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const cleaned = cleanPastedCode(text);
    setCode(cleaned.code);
    setPasteNote(cleaned.changed ? { note: cleaned.note, before: text } : null);
    const name = file.name.toLowerCase();
    const byExt: ArtifactType | null =
      name.endsWith('.html') || name.endsWith('.htm')
        ? 'html'
        : name.endsWith('.tsx') || name.endsWith('.jsx')
          ? 'react'
          : null;
    const nextType: ArtifactType =
      byExt ?? sniffKind(cleaned.code, cleaned.fenceLang) ?? type;
    if (!isEdit) setType(nextType);
    maybeFillTitle(cleaned.code, nextType);
    clearFieldError('code');
  };

  /** 校验表单，通过返回解析结果，否则写 fieldErrors 并返回 null */
  const validate = () => {
    const parsed = formSchema.safeParse({ title, description: description || undefined, code });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      parsed.error.issues.forEach((issue) => {
        const key = String(issue.path[0] ?? 'form');
        if (!errors[key]) errors[key] = issue.message;
      });
      setFieldErrors(errors);
      return null;
    }
    return parsed.data;
  };

  /** 未登录点发布：先校验（免得登录回来才发现标题没填），暂存草稿再去登录 */
  const handleLoginToPublish = () => {
    setFormError('');
    if (!validate()) return;
    try {
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ type, code, title, description, visibility })
      );
    } catch {
      toast({
        title: '当前浏览器无法暂存草稿',
        description: '请先复制一份代码再去登录，以免丢失。',
        variant: 'destructive',
      });
      return;
    }
    navigate('/login', { state: { from: '/new' } });
  };

  const handleSubmit = async () => {
    setFormError('');
    const data = validate();
    if (!data) return;
    // 访问密码校验（有输入时才校验；4-64 位）
    const pwd = accessPassword.trim();
    if (!clearPassword && pwd && (pwd.length < 4 || pwd.length > 64)) {
      setFieldErrors({ accessPassword: '访问密码需为 4-64 位' });
      return;
    }
    // 自定义路径校验（去掉首尾空白与多余斜杠后校验；留空 = 不设置/清除）
    const path = customPath.trim().replace(/^\/+|\/+$/g, '');
    const pathError = validateCustomPath(path);
    if (pathError) {
      setFieldErrors({ customPath: pathError });
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    /**
     * 发布/保存成功后同步自定义路径。**失败即阻断，留在本页**（2026-07-26 修订，计划 W1-9）：
     * 路径设置发生在发布之后，原先「toast 后照常跳转」让用户拿到的是
     * 「作品已经公开出去、但地址不是我以为的那个」，并被直接跳走——错误无从修正。
     * 返回 false 表示调用方不应跳转。
     */
    const syncCustomPath = async (artifactId: string, verb: '发布' | '保存'): Promise<boolean> => {
      try {
        if (isEdit) {
          if (path !== initialCustomPath) {
            await artifactApi.setCustomPath(artifactId, path || null);
          }
        } else if (path) {
          await artifactApi.setCustomPath(artifactId, path);
        }
        return true;
      } catch (e) {
        setFormError(
          `作品已${verb}，但自定义路径设置失败：${(e as Error).message}` +
            '。请修改路径后重试，或清空路径继续——作品本身已保存。'
        );
        setFieldErrors((prev) => ({ ...prev, customPath: (e as Error).message }));
        return false;
      }
    };

    /** 发布/保存成功后的落地提示：public 待审时必须解释「广场为何看不到」（计划 W1-5） */
    const notifyAndGo = (artifact: Artifact) => {
      if (isPendingPublic(artifact)) {
        toast({
          title: `已${isEdit ? '保存' : '发布'}，${PENDING_TEXT}`,
          description: '链接现在就能分享，复核通过后会自动出现在广场。',
        });
      }
      navigate(`/a/${artifact.slug}`, isEdit ? undefined : { state: { justPublished: true } });
    };

    try {
      if (isEdit && id) {
        const { artifact } = await artifactApi.update(id, {
          title: data.title,
          description: data.description || '',
          code: data.code,
          visibility,
          aiGenerated,
          // null = 清除；字符串 = 设置/更换；缺省 = 不变
          ...(clearPassword ? { accessPassword: null } : pwd ? { accessPassword: pwd } : {}),
        });
        if (!(await syncCustomPath(id, '保存'))) return;
        notifyAndGo(artifact);
      } else {
        const { artifact } = await artifactApi.create({
          title: data.title,
          description: data.description,
          type,
          code: data.code,
          visibility,
          aiGenerated,
          ...(pwd ? { accessPassword: pwd } : {}),
        });
        if (!(await syncCustomPath(artifact.id, '发布'))) return;
        notifyAndGo(artifact);
      }
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // 编辑模式必须登录（/edit 仍在 RequireAuth 内）；新建模式允许未登录先粘代码看效果
  if (initLoading || (isEdit && authLoading)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-ink-muted">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-accent" />
        正在加载作品…
      </div>
    );
  }

  if (initError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <p className="font-serif text-2xl text-ink">无法编辑该作品</p>
        <p className="mt-3 text-sm text-ink-muted">{initError}</p>
        <Button asChild className="mt-8 rounded-full">
          <Link to="/me">回到我的作品</Link>
        </Button>
      </div>
    );
  }

  const previewPane = (
    <>
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line bg-surface px-4 text-sm text-ink-muted">
        实时预览
        <div className="flex gap-1">
          {(
            [
              { value: 'full', label: '桌面', icon: Monitor },
              { value: 'tablet', label: '平板', icon: Tablet },
              { value: 'mobile', label: '手机', icon: Smartphone },
            ] as const
          ).map((d) => (
            <button
              key={d.value}
              type="button"
              title={d.label}
              aria-label={d.label}
              onClick={() => setPreviewWidth(d.value)}
              className={cn(
                'rounded-full p-2 transition-colors',
                previewWidth === d.value ? 'bg-ink text-bg' : 'text-ink-muted hover:text-ink',
              )}
            >
              <d.icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {code.trim() ? (
          <div className="flex h-full justify-center bg-bg">
            <div
              className={cn(
                'h-full w-full',
                previewWidth === 'tablet' && 'max-w-[768px] border-x border-line',
                previewWidth === 'mobile' && 'max-w-[375px] border-x border-line',
              )}
            >
              <RunnerFrame
                kind={type}
                code={code}
                debounceMs={800}
                className="h-full"
                showFixActions
                onJumpToLine={jumpToLine}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-muted">
            粘贴或上传代码后，这里会实时预览
          </div>
        )}
      </div>
    </>
  );

  return (
    // --header-h 由 SiteHeader 自报（窄屏站头是两行，不再是固定的 3.5rem）
    <div className="flex h-[calc(100dvh-var(--header-h))] flex-col lg:grid lg:grid-cols-2">
      {/* 手机端分栏切换：此前预览是 hidden lg:flex，窄屏上完全拿不到实时预览 */}
      <div className="flex shrink-0 border-b border-line bg-surface lg:hidden">
        {(
          [
            { value: 'edit', label: '编辑' },
            { value: 'preview', label: '预览' },
          ] as const
        ).map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setMobileTab(t.value)}
            className={cn(
              'flex-1 border-b-2 py-2.5 text-sm transition-colors',
              mobileTab === t.value
                ? 'border-accent font-medium text-ink'
                : 'border-transparent text-ink-muted',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 左：编辑区 */}
      <div
        className={cn(
          'min-h-0 flex-1 flex-col gap-4 overflow-y-auto border-r border-line p-4 sm:p-6 lg:flex',
          mobileTab === 'edit' ? 'flex' : 'hidden',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-serif text-xl font-semibold text-ink">
            {isEdit ? '编辑作品' : '新建作品'}
          </h1>
          {user ? (
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              variant="accent"
              className="shrink-0 rounded-full px-6"
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? '保存并发布' : '发布'}
            </Button>
          ) : (
            <Button
              onClick={handleLoginToPublish}
              variant="accent"
              className="shrink-0 rounded-full px-5"
            >
              <LogIn className="mr-1.5 h-4 w-4" />
              登录后发布
            </Button>
          )}
        </div>
        <p className="-mt-2 text-right text-xs text-ink-muted">
          发布即表示同意
          <Link to="/terms" target="_blank" className="text-accent underline-offset-4 hover:underline">《服务条款》</Link>
        </p>

        {!user && !isEdit && (
          <div className="rounded-md border border-accent/25 bg-accent-soft px-3 py-2 text-sm text-ink">
            不用先注册——把代码粘进来就能看到效果。发布时再登录，草稿不会丢。
          </div>
        )}

        {formError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {formError}
          </div>
        )}

        {/* 类型选择（编辑模式不可改类型） */}
        <div className="space-y-1.5">
          <Label>类型</Label>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { value: 'react', label: 'React 组件', icon: Code2 },
                { value: 'html', label: 'HTML 页面', icon: FileCode2 },
              ] as const
            ).map((t) => (
              <button
                key={t.value}
                type="button"
                disabled={isEdit}
                onClick={() => setType(t.value)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm transition-colors',
                  type === t.value
                    ? 'border-ink bg-ink text-bg'
                    : 'border-line bg-surface text-ink-muted hover:text-ink',
                  isEdit && 'cursor-not-allowed opacity-60',
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto h-10 rounded-full border-line"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-1 h-3.5 w-3.5" />
              上传文件
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".tsx,.jsx,.html,.htm"
              className="hidden"
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          {isEdit && (
            <p className="text-xs text-ink-muted">编辑模式下类型不可修改。</p>
          )}
        </div>

        {/* 代码
            高度写死不用 flex-1：左栏是 overflow-y-auto 的滚动列，剩余空间为负，
            flex-1 的项会一律塌到 min-height，子元素随即溢出压住下一节的「标题」标签
            （2026-07-27 目检实拍到：elementFromPoint 落在 cm-gutterElement 上）。 */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="code" className="min-w-0">
              代码{' '}
              {/* 括注在窄屏隐藏：它会折成两行，把右侧的字节计数挤得错位 */}
              <span className="hidden font-normal text-ink-muted sm:inline">
                （{type === 'react' ? '单文件 React 组件，需 default export' : '完整 HTML 文档'}）
              </span>
            </Label>
            {/* 字节计数：500KB 是契约第 2 节的硬上限，得在发布前就看得见 */}
            <span
              className={cn(
                'shrink-0 font-mono text-xs tabular-nums',
                overLimit ? 'font-medium text-destructive' : 'text-ink-muted',
              )}
            >
              {formatBytes(codeBytes)} / 500 KB
            </span>
          </div>

          {pasteNote && (
            <div className="flex items-start gap-2 rounded-md border border-accent/25 bg-accent-soft px-3 py-2 text-xs text-ink">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="flex-1">{pasteNote.note}</span>
              <button
                type="button"
                onClick={undoPasteClean}
                className="shrink-0 font-medium text-accent underline-offset-4 hover:underline"
              >
                撤销
              </button>
              <button
                type="button"
                aria-label="关闭提示"
                onClick={() => setPasteNote(null)}
                className="shrink-0 text-ink-muted hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <CodeEditor
            id="code"
            ref={codeRef}
            value={code}
            kind={type}
            onChange={(v) => {
              setCode(v);
              maybeFillTitle(v, type);
              clearFieldError('code');
            }}
            onFullPaste={handleFullPaste}
            placeholder={
              type === 'react'
                ? '// 粘贴 Claude 生成的 React 组件代码…\n// 带 markdown 围栏也没关系，我们会自动去掉\nexport default function App() { … }'
                : '<!-- 粘贴完整 HTML 文档… -->\n<!doctype html>…'
            }
            className="h-[46vh] min-h-[260px]"
          />
          {fieldErrors.code && <p className="text-sm text-destructive">{fieldErrors.code}</p>}
        </div>

        {/* 标题 / 描述 / 可见性 */}
        <div className="space-y-1.5">
          <Label htmlFor="title">标题</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => {
              titleTouchedRef.current = true;
              setTitle(e.target.value);
              clearFieldError('title');
            }}
            placeholder="给作品起个名字"
            className="bg-surface"
          />
          {fieldErrors.title && <p className="text-sm text-destructive">{fieldErrors.title}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">描述（可选）</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              clearFieldError('description');
            }}
            placeholder="一句话介绍这个作品…"
            rows={2}
            className="bg-surface"
          />
          {fieldErrors.description && (
            <p className="text-sm text-destructive">{fieldErrors.description}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>可见性</Label>
          <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
            <SelectTrigger className="bg-surface">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VISIBILITY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                  <span className="ml-2 text-xs text-ink-muted">{o.hint}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* 源码可见性提示（计划 W1-7）：能打开作品的人都能取到完整源码，
              这一点必须在发布前说清——查看页本就提供「复制代码」 */}
          <p className="text-xs leading-relaxed text-ink-muted">
            无论哪种可见性，任何能打开作品的人都可以取到完整源码。请不要在代码里写入 API
            密钥、令牌或私密数据。
          </p>
        </div>

        {/* 生成合成内容声明（契约 §3.11）：《人工智能生成合成内容标识办法》第 10 条要求
            用户主动声明，第 6 条第四项要求平台提供标识功能。缺省开——本站承载的就是
            AI 生成的页面；关掉即取消角标上的标识 */}
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="aiGenerated">AI 生成声明</Label>
              <p className="text-xs leading-relaxed text-ink-muted">
                开启后，作品右下角角标会显示「AI 生成」标识。
                这是《人工智能生成合成内容标识办法》对生成合成内容的要求。
              </p>
            </div>
            <Switch
              id="aiGenerated"
              checked={aiGenerated}
              onCheckedChange={setAiGenerated}
              aria-label="AI 生成声明"
            />
          </div>
          {!aiGenerated && (
            <p className="text-xs leading-relaxed text-ink-muted">
              你声明这不是 AI 生成或辅助生成的内容。若声明不实，责任由发布者承担。
            </p>
          )}
        </div>

        {/* 访问密码（契约 §3.1，可选） */}
        <div className="space-y-1.5 pb-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="accessPassword">访问密码（可选）</Label>
            {isEdit && hasPassword && !clearPassword && (
              <Badge variant="outline" className="gap-1 border-line text-xs text-ink-muted">
                <KeyRound className="h-3 w-3" />
                已设置密码
              </Badge>
            )}
          </div>
          {clearPassword ? (
            <div className="flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-muted">
              保存后将清除访问密码。
              <button
                type="button"
                className="text-accent underline-offset-4 hover:underline"
                onClick={() => setClearPassword(false)}
              >
                撤销
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                id="accessPassword"
                value={accessPassword}
                onChange={(e) => {
                  setAccessPasswordInput(e.target.value);
                  clearFieldError('accessPassword');
                }}
                autoComplete="off"
                placeholder={
                  isEdit && hasPassword
                    ? '已设置，输入新密码可更换（4-64 位）'
                    : '4-64 位，留空则不设访问密码'
                }
                className="bg-surface"
              />
              {isEdit && hasPassword && (
                <Button
                  type="button"
                  variant="ghost"
                  className="shrink-0 rounded-full text-ink-muted hover:text-destructive"
                  onClick={() => {
                    setClearPassword(true);
                    setAccessPasswordInput('');
                  }}
                >
                  清除密码
                </Button>
              )}
            </div>
          )}
          {fieldErrors.accessPassword && (
            <p className="text-sm text-destructive">{fieldErrors.accessPassword}</p>
          )}
          <p className="text-xs text-ink-muted">
            设置后，拿到链接的访客需输入密码才能查看（私密作品同样适用）。
          </p>
        </div>

        {/* 自定义路径（契约 §3.10，可选；HTML 与 React 均由子域 shell 就地渲染） */}
        <div className="space-y-1.5 pb-2">
          <Label htmlFor="customPath">自定义路径（可选）</Label>
          {user?.subdomainPrefix ? (
            <>
              <div className="flex flex-col items-stretch overflow-hidden rounded-md border border-input bg-surface focus-within:ring-1 focus-within:ring-ring sm:flex-row">
                <span className="flex shrink-0 items-center border-b border-line bg-bg px-3 py-1.5 font-mono text-xs text-ink-muted sm:border-b-0 sm:border-r sm:py-0">
                  https://{user.subdomainPrefix}.{SITES_DOMAIN_SUFFIX}/
                </span>
                <input
                  id="customPath"
                  value={customPath}
                  onChange={(e) => {
                    setCustomPathInput(e.target.value);
                    clearFieldError('customPath');
                  }}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="my-page"
                  className="w-full min-w-0 bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted/60"
                />
              </div>
              {fieldErrors.customPath && (
                <p className="text-sm text-destructive">{fieldErrors.customPath}</p>
              )}
              <p className="text-xs text-ink-muted">
                1-3 段小写字母/数字/连字符，段间用 /（如 demo/v1），总长不超过 128 字符；留空则不设置
                {isEdit ? '（清空即取消已设路径）' : ''}。HTML 与 React 作品都会在该地址就地渲染。
                {user?.quotas && user.quotas.customPaths > 0
                  ? `最多 ${user.quotas.customPaths} 个。`
                  : ''}
              </p>
            </>
          ) : user ? (
            <p className="text-xs text-ink-muted">
              <Link to="/me" className="text-accent underline-offset-4 hover:underline">
                领取你的专属子域前缀
              </Link>
              后可用：作品将获得 前缀.{SITES_DOMAIN_SUFFIX}/路径 的专属地址。
            </p>
          ) : (
            <p className="text-xs text-ink-muted">
              登录并领取子域前缀后，作品可获得 前缀.{SITES_DOMAIN_SUFFIX}/路径 的专属地址。
            </p>
          )}
        </div>
      </div>

      {/* 右：实时预览（防抖 800ms） */}
      <div
        className={cn(
          'min-h-0 flex-1 flex-col lg:flex',
          mobileTab === 'preview' ? 'flex' : 'hidden',
        )}
      >
        {previewPane}
      </div>
    </div>
  );
}
