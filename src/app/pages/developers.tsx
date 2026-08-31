/**
 * /developers 开发者页（契约 §3.8）：API Token 管理 + Agent 接入指南
 * 安全语义：明文只在创建成功后展示一次（后端只存 sha256，之后无法再取回）；
 * 列表只显示 label + 末四位 + 最近使用时间；撤销需二次确认，撤销后 Bearer 立即失效。
 */
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  Terminal,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
import { tokenApi, type ApiTokenInfo } from '@/app/lib/api';
import { useAuth } from '@/app/lib/auth';
import { formatDate, formatRelativeTime } from '@/app/lib/format';
import { SITE_ORIGIN } from '@/app/config';

/** 复制按钮：点击复制并短暂显示对勾反馈 */
function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
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
      {copied ? <Check className="mr-1 h-3.5 w-3.5 text-accent" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
      {copied ? '已复制' : label}
    </Button>
  );
}

/** 接入指南代码块：等宽字体 + 复制按钮 */
function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative rounded-lg border border-line bg-surface">
      <div className="absolute right-2 top-2">
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-4 pr-24 font-mono text-xs leading-relaxed text-ink">
        {code}
      </pre>
    </div>
  );
}


const CURL_EXAMPLE = `curl -X POST ${SITE_ORIGIN}/api/artifacts \\
  -H "Authorization: Bearer <你的Token>" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"我的作品","type":"html","code":"<h1>Hello</h1>","visibility":"unlisted"}'`;

/**
 * MCP 接入（契约 §3.13）：平台内嵌 Streamable HTTP 端点——填 URL + Bearer Token 即连，
 * 零本地安装（2026-08-31 起替代此前的克隆构建 stdio 方案；stdio 入口仍在 mcp/ 保留给
 * 本地开发场景）。
 */
const MCP_URL = `${SITE_ORIGIN}/api/mcp`;

/** 下面接入片段：token 为空时用占位符，一次性面板里会内联真实 token */
const tokenOr = (token?: string) => token || '<你的Token>';

const mcpClaudeCodeCmd = (token?: string) =>
  `claude mcp add --transport http artifacts ${MCP_URL} --header "Authorization: Bearer ${tokenOr(token)}"`;

const mcpJsonConfig = (token?: string) =>
  `{
  "mcpServers": {
    "artifacts": {
      "type": "http",
      "url": "${MCP_URL}",
      "headers": {
        "Authorization": "Bearer ${tokenOr(token)}"
      }
    }
  }
}`;

const agentPrompt = (token?: string) =>
  `请把生成的单文件作品发布到 Artifacts 平台：
POST ${SITE_ORIGIN}/api/artifacts
请求头：Authorization: Bearer ${tokenOr(token)}、Content-Type: application/json
请求体(JSON)：{"title":"作品标题","type":"html","code":"完整单文件代码","visibility":"unlisted"}
type 取 "html"（完整 HTML 文档）或 "react"（带 default export 的单文件 React 组件）。
成功返回 201，响应含 artifact.slug，访问链接为 ${SITE_ORIGIN}/a/<slug>，请把链接告诉我。
更新已发布的作品用 PUT ${SITE_ORIGIN}/api/artifacts/<id>。
注意：Token 等同我的账号权限，属敏感信息，不要写进代码、日志或提交到仓库。`;

const MCP_CLAUDE_CODE_CMD = mcpClaudeCodeCmd();
const MCP_JSON_CONFIG = mcpJsonConfig();
const AGENT_PROMPT = agentPrompt();

export default function DevelopersPage() {
  const { user } = useAuth();
  // Token 配额生效值（契约 §3.12）：来自 /api/me，0 = 不限；未加载完按不限处理（服务端仍会兜底）
  const tokenLimit = user?.quotas?.apiTokens ?? 0;
  const [items, setItems] = useState<ApiTokenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  /** 刚创建的 token 明文（仅本次会话展示一次；关闭后无法再取回） */
  const [freshToken, setFreshToken] = useState<{ token: string; label: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    tokenApi
      .list()
      .then((data) => setItems(data.items))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const { token, tokenInfo } = await tokenApi.create(label.trim() || undefined);
      setFreshToken({ token, label: tokenInfo.label });
      setItems((prev) => [tokenInfo, ...prev]);
      setLabel('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setBusyId(id);
    setError('');
    try {
      await tokenApi.revoke(id);
      setItems((prev) => prev.filter((t) => t.id !== id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      {/* 标题与定位 */}
      <div className="mb-8">
        {/* 页面主标题统一 text-3xl（W2-6）：此前本页与 /sites 是全站仅有的 text-2xl，
            从头像菜单里连续切页时字号会跳 */}
        <h1 className="font-serif text-3xl font-bold text-ink">开发者 · Agent 发布</h1>
        <p className="mt-2 text-sm text-ink-muted">
          让 Claude Code / Cursor 等 AI Agent 用 API Token 直接把作品发布到你的账号。
          Token 明文只在创建时显示一次，服务端只存哈希，可随时撤销。
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* ===== Token 管理区 ===== */}
      <section className="mb-10">
        <h2 className="mb-3 flex items-center gap-2 font-serif text-lg font-semibold text-ink">
          <KeyRound className="h-4 w-4 text-accent" />
          API Token
        </h2>

        {/* 创建 */}
        <form onSubmit={handleCreate} className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="token-label" className="mb-1.5 block text-xs text-ink-muted">
              Token 名称（可选，≤50 字，默认「API Token」）
            </Label>
            <Input
              id="token-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={50}
              placeholder="例如：Claude Code"
              className="h-9"
            />
          </div>
          {/* 配额前置（W2-6，§3.12 改为 /api/me 下发生效值）：此前配额说明排在
              Token 列表之后，用户往往填完名称点了创建才被 400 拒。 */}
          <Button
            type="submit"
            size="sm"
            className="h-9 rounded-full"
            disabled={creating || (tokenLimit > 0 && items.length >= tokenLimit)}
          >
            {creating ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            创建 Token
          </Button>
        </form>
        <p className="mt-1.5 text-xs text-ink-muted">
          已用 {items.length}
          {tokenLimit > 0 ? `/${tokenLimit}` : ''} 个有效 Token
          {tokenLimit > 0 && items.length >= tokenLimit && '，请先撤销一个再创建。'}
        </p>

        {/* 一次性明文展示 */}
        {freshToken && (
          <div className="mt-4 rounded-lg border border-accent/50 bg-accent/5 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-red-600">
              <AlertTriangle className="h-4 w-4" />
              仅显示这一次，请立即保存 —— 关闭后无法再次查看
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink">
                {freshToken.token}
              </code>
              <CopyButton text={freshToken.token} />
            </div>
            {/* 已内联真实 Token 的可复制块（W1-5）：此前只给裸 token，而命令与 JSON 里
                写的是「你的Token」占位符——用户必须手工替换。与一次性展示同生命周期，
                关闭即随 freshToken 一起从内存销毁；绝不落 localStorage，也绝不进 URL。 */}
            <div className="mt-3 space-y-3">
              <div>
                <p className="mb-1 text-xs text-ink-muted">Claude Code（Token 已填好）</p>
                <CodeBlock code={mcpClaudeCodeCmd(freshToken.token)} />
              </div>
              <div>
                <p className="mb-1 text-xs text-ink-muted">Claude Desktop / Cursor / Cline 的 JSON 配置</p>
                <CodeBlock code={mcpJsonConfig(freshToken.token)} />
              </div>
              <div>
                <p className="mb-1 text-xs text-ink-muted">直接发给 Agent 的 HTTP 指令（不装 MCP 也能用）</p>
                <CodeBlock code={agentPrompt(freshToken.token)} />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-ink-muted">
              <span>「{freshToken.label}」已创建。Token 等同你的账号权限，请像密码一样保管。</span>
              <button
                type="button"
                className="underline hover:text-ink"
                onClick={() => setFreshToken(null)}
              >
                我已保存，关闭
              </button>
            </div>
          </div>
        )}

        {/* 列表 */}
        <div className="mt-4">
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin text-accent" /> 正在加载…
            </div>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">
              还没有 Token。创建一个，让 Agent 帮你发布作品。
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {items.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{t.label}</span>
                      <Badge variant="outline" className="shrink-0 font-mono text-xs font-normal">
                        ak_…{t.lastFour}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-muted">
                      最近使用：{t.lastUsedAt ? formatRelativeTime(t.lastUsedAt) : '从未'}
                      <span className="mx-1.5">·</span>
                      创建于 {formatDate(t.createdAt)}
                    </div>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-ink-muted hover:text-red-600"
                        disabled={busyId === t.id}
                      >
                        {busyId === t.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        <span className="ml-1">撤销</span>
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>撤销「{t.label}」？</AlertDialogTitle>
                        <AlertDialogDescription>
                          撤销后使用该 Token 的请求立即失效，且不可恢复。正在使用它的 Agent
                          将无法继续发布。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-red-600 text-white hover:bg-red-700"
                          onClick={() => handleRevoke(t.id)}
                        >
                          确认撤销
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-ink-muted">
            {tokenLimit > 0 ? `每个账号最多 ${tokenLimit} 个有效 Token；撤销后名额释放。` : '有效 Token 不限量；撤销后即失效。'}
          </p>
        </div>
      </section>

      <Separator className="mb-10" />

      {/* ===== 接入指南区 ===== */}
      <section className="space-y-8">
        <h2 className="flex items-center gap-2 font-serif text-lg font-semibold text-ink">
          <Terminal className="h-4 w-4 text-accent" />
          接入指南
        </h2>

        <div>
          <h3 className="mb-2 font-serif text-base font-semibold text-ink">方式一：HTTP API 快速开始</h3>
          <p className="mb-2 text-xs text-ink-muted">
            用 Bearer Token 调用发布接口（把 <code className="font-mono">&lt;你的Token&gt;</code>{' '}
            换成上方创建的 Token）：
          </p>
          <CodeBlock code={CURL_EXAMPLE} />
          <p className="mt-2 text-xs text-ink-muted">
            成功返回 201，响应含 <code className="font-mono">artifact.slug</code>，作品链接即{' '}
            <code className="font-mono">{SITE_ORIGIN}/a/&lt;slug&gt;</code>。
          </p>
        </div>

        <div>
          <h3 className="mb-2 font-serif text-base font-semibold text-ink">方式二：MCP（推荐，零安装）</h3>
          <p className="mb-2 text-xs text-ink-muted">
            平台自带远程 MCP 服务（Streamable HTTP）：
            <code className="font-mono text-ink">{MCP_URL}</code>
            ，在任何支持 MCP 的客户端里填 URL + Token 即连，无需在本地安装任何东西。
            注册后可在对话里直接说「发布这个页面」「把上周那个看板改一下」——共八个工具：
          </p>
          <ul className="mb-3 space-y-1 text-xs text-ink-muted">
            <li>
              <code className="font-mono text-ink">publish_artifact</code> 发布 ·{' '}
              <code className="font-mono text-ink">update_artifact</code> 同链接更新 ·{' '}
              <code className="font-mono text-ink">list_my_artifacts</code> 列出我的作品
            </li>
            <li>
              <code className="font-mono text-ink">get_artifact</code>{' '}
              读回完整源码——Agent 不用你手工粘代码就能改旧作品
            </li>
            <li>
              <code className="font-mono text-ink">list_versions</code> /{' '}
              <code className="font-mono text-ink">restore_version</code> 版本历史与回滚
            </li>
            <li>
              <code className="font-mono text-ink">get_platform_capabilities</code>{' '}
              动笔前查可用依赖白名单与硬约束，少撞一次「这个库不支持」
            </li>
            <li>
              <code className="font-mono text-ink">create_temp_link</code> 限时分享
            </li>
          </ul>
          <p className="mb-2 text-xs text-ink-muted">Claude Code 一条命令注册：</p>
          <CodeBlock code={MCP_CLAUDE_CODE_CMD} />
          <p className="mb-2 mt-3 text-xs text-ink-muted">
            Cursor / Claude Desktop / 千问办公等支持 Streamable HTTP 的客户端，用 JSON 配置：
          </p>
          <CodeBlock code={MCP_JSON_CONFIG} />
          <p className="mt-2 text-xs text-ink-muted">
            Token 即 API Token（上方创建），等同你的账号权限，请像密码一样保管。
            偏好本地进程（stdio）的开发者仍可用仓库 <code className="font-mono">mcp/</code>{' '}
            子包克隆构建接入。
          </p>
        </div>

        <div>
          <h3 className="mb-2 font-serif text-base font-semibold text-ink">给 AI Agent 的一句话指令（HTTP 方式）</h3>
          <p className="mb-2 text-xs text-ink-muted">
            把下面这段整体发给 Claude Code / Cursor 等 Agent，并替换{' '}
            <code className="font-mono">&lt;你的Token&gt;</code>。注意：Token
            属敏感信息，只在私密会话中提供，勿写入代码仓库。
          </p>
          <CodeBlock code={AGENT_PROMPT} />
        </div>

        <div>
          <h3 className="mb-2 font-serif text-base font-semibold text-ink">字段与可见性</h3>
          <ul className="list-inside list-disc space-y-1 text-xs leading-relaxed text-ink-muted">
            <li>
              <code className="font-mono">title</code>（必填，≤120 字）、
              <code className="font-mono">description</code>（可选，≤1000 字）、
              <code className="font-mono">type</code>（<code className="font-mono">html</code> 完整文档 /{' '}
              <code className="font-mono">react</code> 单文件组件，需 default export）、
              <code className="font-mono">code</code>（必填，≤500KB）
            </li>
            <li>
              <code className="font-mono">visibility</code>：<code className="font-mono">public</code>{' '}
              进广场（机审通过即上架）· <code className="font-mono">unlisted</code> 持链接可看（Agent
              发布推荐）· <code className="font-mono">private</code> 仅自己；另可用{' '}
              <code className="font-mono">accessPassword</code>（4-64 位）设访问密码
            </li>
            <li>
              更新作品：<code className="font-mono">PUT /api/artifacts/&lt;id&gt;</code>
              （可改 title / description / code / visibility；每次内容变更自动留版本快照，可随时回滚）
            </li>
            <li>
              限时分享：<code className="font-mono">POST /api/artifacts/&lt;id&gt;/temp-links</code>{' '}
              可为作品生成限时访问链接（私密作品也能限时给人看）
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
