/**
 * 举报入口（合规必需）：纯净查看页右下角、角标上方的极小灰字「举报」链接 + 举报弹窗。
 * 所有访客可见（不限登录）；点击填理由 → artifactApi.report（沿用旧文案与校验）。
 * 视觉刻意低调（text-xs / 半透明 ink-muted，hover 提亮），z 低于作者控制条、不遮 runner 角标。
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CONTACT_EMAIL, OPERATOR_LABEL } from '@/app/config';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { artifactApi } from '@/app/lib/api';

export default function ReportDialog({ artifactId }: { artifactId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reporting, setReporting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!reason.trim()) {
      setError('请填写举报原因');
      return;
    }
    setReporting(true);
    setError('');
    try {
      await artifactApi.report(artifactId, reason.trim());
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReporting(false);
    }
  };

  return (
    <>
      {/* 右下角、角标上方极小灰字入口：低调但可点，不遮角标（角标固定在 iframe 内 bottom:12px） */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-[38px] right-0 z-20 -mr-0 px-3 py-2 text-xs text-ink-muted/60 transition-colors hover:text-ink-muted"
      >
        举报
      </button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setReason('');
            setDone(false);
            setError('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          {done ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-serif">举报已提交</DialogTitle>
                <DialogDescription>感谢反馈，管理员会尽快处理。</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button className="rounded-full" onClick={() => setOpen(false)}>
                  好的
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="font-serif">举报该作品</DialogTitle>
                <DialogDescription>请描述该作品存在的问题（如违规内容、侵权等）。</DialogDescription>
              </DialogHeader>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="举报原因…请勿填写手机号、邮箱等个人联系方式"
                rows={4}
              />
              {/* 无壳查看页没有页脚，这里是访客唯一能看到联系方式的地方（计划 W1-6） */}
              <p className="text-xs leading-relaxed text-ink-muted">
                也可直接发信至{' '}
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('[内容举报] ')}`}
                  className="text-accent hover:underline"
                >
                  {CONTACT_EMAIL}
                </a>
                。运营主体：{OPERATOR_LABEL}。
              </p>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button
                  variant="outline"
                  className="rounded-full border-line"
                  onClick={() => setOpen(false)}
                >
                  取消
                </Button>
                <Button className="rounded-full" onClick={submit} disabled={reporting}>
                  {reporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  提交举报
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
