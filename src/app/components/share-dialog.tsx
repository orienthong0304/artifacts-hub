/**
 * 分享 Dialog（契约 §3.2 / §3.6）：
 *   通用区：访问链接 + 复制按钮（所有人可见）
 *   作者区：可见性单选（即时保存）+ 访问密码管理 + 「复制链接+密码」+ 临时链接管理
 * 明文密码只在本次会话的输入框内存在（后端只存哈希，无法回显）。
 */
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, KeyRound, Loader2, Timer, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  artifactApi,
  tempLinkApi,
  type Artifact,
  type TempLink,
  type TempLinkExpiresInHours,
  type Visibility,
} from '@/app/lib/api';
import { formatExpiry } from '@/app/lib/format';
import { PRODUCT_NAME, SITE_ORIGIN, CONTACT_EMAIL } from '@/app/config';
import { cn } from '@/lib/utils';

const VISIBILITY_OPTIONS: { value: Visibility; label: string; hint: string }[] = [
  { value: 'public', label: '公开', hint: '出现在广场，所有人可见' },
  { value: 'unlisted', label: '不公开列出', hint: '不进广场，知道链接的人可见' },
  { value: 'private', label: '私密', hint: '仅自己可见（设密码后持密码者也可看）' },
];

/** 临时链接时长档位（契约 §3.6：UI 展示 7 档，与 API 档位 1|6|12|24|72|168|720 一致） */
const TEMP_DURATION_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: '1 小时' },
  { value: '6', label: '6 小时' },
  { value: '12', label: '12 小时' },
  { value: '24', label: '24 小时' },
  { value: '72', label: '3 天' },
  { value: '168', label: '7 天' },
  { value: '720', label: '30 天' },
];

interface ShareDialogProps {
  artifact: Artifact;
  /** 是否作者（作者区仅作者渲染） */
  isAuthor: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 作者区修改（可见性 / 密码）成功后回传补丁，供调用方同步本地状态 */
  onArtifactChange?: (patch: Partial<Artifact>) => void;
}

export default function ShareDialog({
  artifact,
  isAuthor,
  open,
  onOpenChange,
  onArtifactChange,
}: ShareDialogProps) {
  const shareUrl = `${SITE_ORIGIN}/a/${artifact.slug}`;
  // 已设自定义路径时，主链接展示子域权威地址；/a/ 链接作永久备用链接保留（契约 §3.10）
  const primaryUrl = artifact.customUrl || shareUrl;

  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedBundle, setCopiedBundle] = useState(false);

  // 二维码：打开时生成（微信扫码直达）
  const [qrDataUrl, setQrDataUrl] = useState('');
  useEffect(() => {
    if (!open) return;
    QRCode.toDataURL(primaryUrl, {
      width: 480,
      // 静区 4 个模块是 QR 规范的要求（W2-4）：此前是 1，加上 96px 的显示尺寸
      // （手机上约 1.6 cm），扫码容错被压到很窄
      margin: 4,
      color: { dark: '#1A1915', light: '#FFFFFF' },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [open, primaryUrl]);

  // 可见性
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [visibilitySaved, setVisibilitySaved] = useState(false);

  // 自定义路径（契约 §3.10）：需先在「我的作品」页领取子域前缀
  const [customPathInput, setCustomPathInput] = useState(artifact.customPath ?? '');
  const [savingPath, setSavingPath] = useState(false);
  const [pathSaved, setPathSaved] = useState(false);

  // 密码（明文只存在于这个输入框的 state 里）
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');

  // 临时链接（契约 §3.6）：打开 Dialog 时懒加载（仅作者区）
  const [tempLinks, setTempLinks] = useState<TempLink[]>([]);
  const [tempLoading, setTempLoading] = useState(false);
  const [tempHours, setTempHours] = useState('24');
  const [tempNote, setTempNote] = useState('');
  const [tempCreating, setTempCreating] = useState(false);
  const [copiedTempId, setCopiedTempId] = useState('');
  const [revokingId, setRevokingId] = useState('');

  const [error, setError] = useState('');
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // 打开时把自定义路径输入框同步为当前值（切换作品/重开都对齐最新状态）
  useEffect(() => {
    if (open) setCustomPathInput(artifact.customPath ?? '');
  }, [open, artifact.customPath]);

  // 关闭时重置瞬时状态；卸载时清理定时器
  useEffect(() => {
    if (!open) {
      setCopiedLink(false);
      setCopiedBundle(false);
      setPasswordInput('');
      setPasswordMessage('');
      setVisibilitySaved(false);
      setPathSaved(false);
      setTempNote('');
      setCopiedTempId('');
      setError('');
    }
    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [open]);

  // 懒加载临时链接列表：仅作者打开 Dialog 时请求
  useEffect(() => {
    if (!open || !isAuthor) return;
    let cancelled = false;
    setTempLoading(true);
    tempLinkApi
      .list(artifact.id)
      .then(({ items }) => {
        if (!cancelled) setTempLinks(items);
      })
      .catch(() => {
        /* 列表加载失败静默；生成/撤销操作会单独报错 */
      })
      .finally(() => {
        if (!cancelled) setTempLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isAuthor, artifact.id]);

  const flash = (setter: (v: boolean) => void) => {
    setter(true);
    timersRef.current.push(setTimeout(() => setter(false), 2000));
  };

  const copyText = async (text: string, setter: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(setter);
    } catch {
      setError('复制失败，请手动选择文本复制。');
    }
  };

  const copyLink = () => copyText(primaryUrl, setCopiedLink);

  /** 「复制链接+密码」文案格式见契约 §3.2；密码与保存逻辑同样 trim，保证复制值与实际密码一致 */
  const copyLinkWithPassword = () => {
    const lines = [`【${artifact.title}】- ${PRODUCT_NAME}`, `链接: ${shareUrl}`];
    const pwd = passwordInput.trim();
    if (pwd) lines.push(`访问密码: ${pwd}`);
    return copyText(lines.join('\n'), setCopiedBundle);
  };

  const changeVisibility = async (visibility: Visibility) => {
    if (visibility === artifact.visibility || savingVisibility) return;
    setSavingVisibility(true);
    setError('');
    try {
      const { artifact: updated } = await artifactApi.update(artifact.id, { visibility });
      onArtifactChange?.({ visibility: updated.visibility });
      flash(setVisibilitySaved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingVisibility(false);
    }
  };

  /** 保存自定义路径：留空保存 = 移除（传 null）。成功后回传补丁同步主链接展示 */
  const saveCustomPath = async () => {
    if (savingPath) return;
    setSavingPath(true);
    setError('');
    try {
      const { artifact: updated } = await artifactApi.setCustomPath(
        artifact.id,
        customPathInput.trim() || null,
      );
      onArtifactChange?.({ customPath: updated.customPath, customUrl: updated.customUrl });
      flash(setPathSaved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingPath(false);
    }
  };

  const setPassword = async () => {
    const pwd = passwordInput.trim();
    if (pwd.length < 4 || pwd.length > 64) {
      setError('访问密码需为 4-64 位。');
      return;
    }
    setPasswordBusy(true);
    setError('');
    try {
      await artifactApi.update(artifact.id, { accessPassword: pwd });
      onArtifactChange?.({ hasPassword: true });
      setPasswordMessage(artifact.hasPassword ? '密码已更换' : '密码已设置');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPasswordBusy(false);
    }
  };

  const clearPassword = async () => {
    setPasswordBusy(true);
    setError('');
    try {
      await artifactApi.update(artifact.id, { accessPassword: null });
      onArtifactChange?.({ hasPassword: false });
      setPasswordInput('');
      setPasswordMessage('密码已清除');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPasswordBusy(false);
    }
  };

  /** 生成临时链接：成功后插到列表最前（列表按创建时间倒序） */
  const createTempLink = async () => {
    setTempCreating(true);
    setError('');
    try {
      const note = tempNote.trim();
      const { tempLink } = await tempLinkApi.create(artifact.id, {
        expiresInHours: Number(tempHours) as TempLinkExpiresInHours,
        ...(note ? { note } : {}),
      });
      setTempLinks((prev) => [tempLink, ...prev]);
      setTempNote('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTempCreating(false);
    }
  };

  const copyTempLink = async (link: TempLink) => {
    try {
      await navigator.clipboard.writeText(`${SITE_ORIGIN}/t/${link.token}`);
      setCopiedTempId(link.id);
      timersRef.current.push(setTimeout(() => setCopiedTempId(''), 2000));
    } catch {
      setError('复制失败，请手动选择文本复制。');
    }
  };

  /** 撤销：点击即撤销（无需二次确认），成功后从列表移除 */
  const revokeTempLink = async (id: string) => {
    setRevokingId(id);
    setError('');
    try {
      await tempLinkApi.revoke(id);
      setTempLinks((prev) => prev.filter((l) => l.id !== id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRevokingId('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif">分享作品</DialogTitle>
          <DialogDescription>把「{artifact.title}」分享给其他人。</DialogDescription>
        </DialogHeader>

        {/* 通用区：访问链接 */}
        <div className="space-y-1.5">
          <Label htmlFor="share-url">访问链接</Label>
          <div className="flex gap-2">
            <Input
              id="share-url"
              readOnly
              value={primaryUrl}
              onFocus={(e) => e.target.select()}
              className="bg-bg font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0 rounded-full border-line"
              onClick={copyLink}
            >
              {copiedLink ? (
                <>
                  <Check className="mr-1 h-3.5 w-3.5" /> 已复制
                </>
              ) : (
                <>
                  <Copy className="mr-1 h-3.5 w-3.5" /> 复制
                </>
              )}
            </Button>
          </div>
          {artifact.customUrl && (
            <p className="text-xs text-ink-muted">
              永久备用链接：<span className="font-mono">{shareUrl}</span>
            </p>
          )}
        </div>

        {/* 通用区：二维码 */}
        {qrDataUrl && (
          <div className="flex items-center gap-4 rounded-md border border-line bg-bg p-3">
            <img
              src={qrDataUrl}
              alt="作品二维码"
              className="h-36 w-36 shrink-0 border border-line bg-white"
            />
            <div className="space-y-2 text-sm">
              <p className="text-ink-muted">微信「扫一扫」直接打开该作品。</p>
              <Button asChild type="button" variant="outline" size="sm" className="rounded-full border-line">
                <a href={qrDataUrl} download={`${artifact.slug}-qrcode.png`}>
                  保存二维码
                </a>
              </Button>
            </div>
          </div>
        )}

        {/* 作者区 */}
        {isAuthor && (
          <>
            <Separator className="bg-line" />

            {/* 可见性（即时保存） */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>可见性</Label>
                {savingVisibility && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                )}
                {visibilitySaved && !savingVisibility && (
                  <span className="inline-flex items-center gap-1 text-xs text-accent">
                    <Check className="h-3 w-3" /> 已保存
                  </span>
                )}
              </div>
              <RadioGroup
                value={artifact.visibility}
                onValueChange={(v) => changeVisibility(v as Visibility)}
                className="gap-2"
              >
                {VISIBILITY_OPTIONS.map((o) => (
                  <label
                    key={o.value}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2 transition-colors hover:bg-bg"
                  >
                    <RadioGroupItem value={o.value} disabled={savingVisibility} />
                    <span className="text-sm text-ink">{o.label}</span>
                    <span className="text-xs text-ink-muted">{o.hint}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>

            {/* 自定义路径（契约 §3.10）：需先在「我的作品」页领取子域前缀 */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="share-custom-path">自定义路径</Label>
                {pathSaved && !savingPath && (
                  <span className="inline-flex items-center gap-1 text-xs text-accent">
                    <Check className="h-3 w-3" /> 已保存
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  id="share-custom-path"
                  value={customPathInput}
                  onChange={(e) => setCustomPathInput(e.target.value)}
                  placeholder="如 my-page 或 docs/intro"
                  autoComplete="off"
                  className="bg-bg font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 rounded-full border-line"
                  onClick={saveCustomPath}
                  disabled={savingPath}
                >
                  {savingPath && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  保存
                </Button>
              </div>
              {artifact.customUrl ? (
                <p className="text-xs text-ink-muted">
                  当前地址：<span className="font-mono text-ink">{artifact.customUrl}</span>（清空输入框保存即移除）
                </p>
              ) : (
                <p className="text-xs text-ink-muted">
                  需先在「我的作品」页领取子域前缀；设置后该地址即作品主链接，HTML 与 React 均在此就地渲染。
                </p>
              )}
            </div>

            {/* 访问密码 */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="share-password">访问密码</Label>
                {artifact.hasPassword && (
                  <Badge variant="outline" className="gap-1 border-line text-xs text-ink-muted">
                    <KeyRound className="h-3 w-3" />
                    已设置密码
                  </Badge>
                )}
                {passwordMessage && (
                  <span className="inline-flex items-center gap-1 text-xs text-accent">
                    <Check className="h-3 w-3" /> {passwordMessage}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  id="share-password"
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    setPasswordMessage('');
                  }}
                  placeholder={
                    artifact.hasPassword ? '输入新密码可更换（4-64 位）' : '4-64 位，留空不设'
                  }
                  autoComplete="off"
                  className="bg-bg"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 rounded-full border-line"
                  onClick={setPassword}
                  disabled={passwordBusy || !passwordInput.trim()}
                >
                  {passwordBusy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  {artifact.hasPassword ? '更换密码' : '设置密码'}
                </Button>
                {artifact.hasPassword && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="shrink-0 rounded-full text-ink-muted hover:text-destructive"
                    onClick={clearPassword}
                    disabled={passwordBusy}
                  >
                    清除密码
                  </Button>
                )}
              </div>
              <p className="text-xs text-ink-muted">
                设置后，任何拿到链接的人输入密码即可查看（私密作品也不例外）；平台只保存密码哈希，明文仅存在于此输入框。
              </p>

              {/* 复制链接+密码：仅输入框有明文时可用 */}
              <Button
                type="button"
                className="w-full rounded-full"
                onClick={copyLinkWithPassword}
                disabled={!passwordInput.trim()}
              >
                {copiedBundle ? (
                  <>
                    <Check className="mr-1 h-3.5 w-3.5" /> 已复制
                  </>
                ) : (
                  <>
                    <Copy className="mr-1 h-3.5 w-3.5" /> 复制链接+密码
                  </>
                )}
              </Button>
            </div>

            {/* 临时链接（契约 §3.6）：限时访问，豁免可见性与密码，可撤销 */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>临时链接</Label>
                {tempLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}
              </div>
              {/* 窄屏折行（W2-2）：时长下拉 112 + 生成按钮 ~120 挤掉备注框，
                  375px 下备注只剩几十像素，输入框形同虚设 */}
              <div className="flex flex-wrap gap-2">
                <Select value={tempHours} onValueChange={setTempHours}>
                  <SelectTrigger className="w-28 shrink-0 bg-bg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMP_DURATION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={tempNote}
                  onChange={(e) => setTempNote(e.target.value)}
                  placeholder="备注（可选，如：给客户预览）"
                  maxLength={200}
                  className="bg-bg"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 rounded-full border-line"
                  onClick={createTempLink}
                  disabled={tempCreating}
                >
                  {tempCreating ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Timer className="mr-1 h-3.5 w-3.5" />
                  )}
                  生成临时链接
                </Button>
              </div>
              <p className="text-xs text-ink-muted">
                限时访问链接：到期即失效、可随时撤销，不影响原链接；私密或设密码的作品持链接也能直接查看。
              </p>

              {tempLinks.length > 0 && (
                <div className="max-h-48 space-y-1.5 overflow-y-auto">
                  {tempLinks.map((link) => (
                    <div
                      key={link.id}
                      className={cn(
                        'flex items-center gap-2 rounded-md border border-line bg-bg px-3 py-2',
                        link.expired && 'opacity-50',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs text-ink">
                          {`${SITE_ORIGIN}/t/${link.token}`}
                        </p>
                        <p className="truncate text-xs text-ink-muted">
                          {formatExpiry(link.expiresAt)}
                          {link.note ? ` · ${link.note}` : ''}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="shrink-0 rounded-full text-ink-muted hover:text-ink"
                        onClick={() => copyTempLink(link)}
                        title="复制临时链接"
                      >
                        {copiedTempId === link.id ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="shrink-0 rounded-full text-ink-muted hover:text-destructive"
                        onClick={() => revokeTempLink(link.id)}
                        disabled={revokingId === link.id}
                        title="撤销临时链接"
                      >
                        {revokingId === link.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* 去角标询价出口（计划 W1-6）：零代码取付费意愿信号——收到第一封询价再做能力本体 */}
        <p className="border-t border-line pt-3 text-xs text-ink-muted">
          需要去掉页面右下角的角标？
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('[去角标咨询] ')}`}
            className="ml-1 text-accent hover:underline"
          >
            邮件联系我们
          </a>
        </p>
      </DialogContent>
    </Dialog>
  );
}
