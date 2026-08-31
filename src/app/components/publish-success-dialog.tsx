/**
 * 发布成功浮层（能力波次 2 · W2-4）。
 *
 * 此前发布成功只是一次静默跳转——用户落在作品页上，不知道链接是哪个、
 * 也不知道下一步该干什么。发布是这个产品里唯一的「成就时刻」，得有个落点：
 * 地址在这、二维码在这、一键复制拿去发群。
 *
 * 只在刚发布的那一次出现（靠 router state 传递，读完即清），刷新不会再弹。
 */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, PartyPopper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { isPendingPublic, PENDING_TEXT } from '@/app/components/review-status';
import type { Artifact } from '@/app/lib/api';
import { SITE_ORIGIN } from '@/app/config';

interface Props {
  artifact: Artifact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function PublishSuccessDialog({ artifact, open, onOpenChange }: Props) {
  /** 已设自定义路径时给子域权威地址（契约 §3.10），否则给 /a/ 地址 */
  const url = artifact.customUrl || `${SITE_ORIGIN}/a/${artifact.slug}`;

  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');

  useEffect(() => {
    if (!open) return;
    // margin: 4 是 QR 规范要求的静区宽度，别为了好看压小
    QRCode.toDataURL(url, { width: 480, margin: 4, color: { dark: '#1A1915', light: '#FFFFFF' } })
      .then(setQr)
      .catch(() => setQr(''));
  }, [open, url]);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      setCopyError('');
    }
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 本地 http 等场景下剪贴板不可用——不静默失败，退回「自己选中复制」
      setCopyError('浏览器不允许自动复制，请手动选中下面的地址复制。');
    }
  };

  const pending = isPendingPublic(artifact);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif">
            <PartyPopper className="h-5 w-5 text-accent" />
            发布成功
          </DialogTitle>
          <DialogDescription>
            「{artifact.title}」已经上线，把下面的地址发给任何人就能打开。
          </DialogDescription>
        </DialogHeader>

        {/* 二维码大图：微信里发链接不如发码，扫一下就进 */}
        {qr && (
          <div className="flex flex-col items-center gap-2">
            <img
              src={qr}
              alt="作品二维码"
              className="h-44 w-44 rounded-md border border-line bg-white p-1"
            />
            <a
              href={qr}
              download={`${artifact.slug}-qrcode.png`}
              className="text-xs text-accent underline-offset-4 hover:underline"
            >
              保存二维码
            </a>
          </div>
        )}

        <div className="rounded-md border border-line bg-bg px-3 py-2">
          <p className="select-all break-all font-mono text-xs text-ink">{url}</p>
        </div>
        {copyError && <p className="text-xs text-destructive">{copyError}</p>}

        {pending && (
          <p className="rounded-md border border-line bg-accent-soft px-3 py-2 text-xs leading-relaxed text-ink">
            {PENDING_TEXT}。链接现在就能分享。
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="accent" className="flex-1 rounded-full" onClick={copy}>
            {copied ? (
              <>
                <Check className="mr-1.5 h-4 w-4" /> 已复制
              </>
            ) : (
              <>
                <Copy className="mr-1.5 h-4 w-4" /> 复制链接
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1 rounded-full border-line"
            onClick={() => onOpenChange(false)}
          >
            看看效果
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
