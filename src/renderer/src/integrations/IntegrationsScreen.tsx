import { useEffect, useId, useRef, useState } from 'react'
import { Copy, Plus, RefreshCw, ShieldCheck, Zap } from 'lucide-react'
import { Link } from 'react-router'
import type { McpStatus, XAccount } from '@shared/api'
import { authErrorMessage } from '@shared/authErrors'
import { MCP_PORT } from '@shared/mcp'
import { Avatar } from '../shell/AccountSwitcher'
import { useActiveAccount } from '../shell/useActiveAccount'
import { Pill, Segmented, SegmentedItem, Switch } from '../ui'

const messageOf = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(
    /^Error invoking remote method '[^']+': (\w*Error: )?/,
    ''
  )

// The design's 30px buttons, between the v2 Button's md (32) and sm (28).
const BTN =
  'box-border inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-0 text-[12px] font-medium whitespace-nowrap disabled:cursor-default disabled:opacity-45'
const OUTLINE = `${BTN} border-ds-border-strong bg-transparent hover:not-disabled:bg-ds-inset`
const SECONDARY = `${OUTLINE} text-ds-text`
const RED = `${BTN} border-transparent bg-ds-red text-white`
const PRIMARY = `${BTN} border-transparent bg-ds-accent text-white hover:not-disabled:bg-[color-mix(in_srgb,var(--ds-accent)_88%,#fff)]`

const TITLE = 'text-[13px] font-medium text-ds-text'
const SUB = 'text-[12px] leading-[1.45] text-ds-text-3'
const ERROR = 'text-[12px] leading-[1.45] text-ds-red'

// What mcp/server.ts offers outside agents, current_time included.
const TOOLS = ['create_posts', 'list_posts', 'reschedule_post', 'current_time', 'list_accounts']

/**
 * Integrations (OP-83): the local MCP server that lets Claude Desktop, Claude Code and other
 * agents schedule posts, with how to set each up, and the X accounts posts go out from.
 */
export function IntegrationsScreen(): React.JSX.Element {
  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex h-[60px] shrink-0 items-center border-b border-ds-border px-5">
        <h1 className="m-0 text-[20px] font-semibold tracking-[-0.4px]">Integrations</h1>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-8 py-6">
        <Section title="MCP server" sub="for Claude Desktop, Claude Code and other agents">
          <McpRows />
        </Section>
        <Section title="X accounts">
          <AccountRows />
        </Section>
      </div>
    </main>
  )
}

function Section({
  title,
  sub,
  children
}: {
  title: string
  sub?: string
  children: React.ReactNode
}): React.JSX.Element {
  const id = useId()
  return (
    <section className="flex w-full max-w-[640px] flex-col gap-2.5" aria-labelledby={id}>
      <div className="flex items-baseline gap-2">
        <h2
          id={id}
          className="m-0 text-[11px] font-semibold tracking-[0.8px] text-ds-text-3 uppercase"
        >
          {title}
        </h2>
        {sub && <span className="text-[11px] text-ds-text-3">{sub}</span>}
      </div>
      <div className="flex flex-col divide-y divide-ds-border rounded-xl border border-ds-border bg-ds-raised">
        {children}
      </div>
    </section>
  )
}

/**
 * A question in red that stands in for the row it is about, until the user answers it. It sits
 * over the box's edges and dividers (-m-px) so it reads as its own card, as in the design.
 */
function ConfirmRow({
  title,
  sub,
  action,
  busy,
  error,
  onCancel,
  onConfirm
}: {
  title: string
  sub: string
  action: string
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const titleId = useId()
  const subId = useId()
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      aria-describedby={subId}
      className="relative -m-px flex items-center gap-4 rounded-xl border border-ds-red bg-ds-red-2 px-4 py-3.5"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span id={titleId} className={TITLE}>
          {title}
        </span>
        <span id={subId} className="text-[12px] leading-[17px] text-ds-text-2">
          {sub}
        </span>
        {error && (
          <span role="alert" className={ERROR}>
            {error}
          </span>
        )}
      </div>
      {/* Cancel takes the focus: the row the user was on just went away. */}
      <button type="button" className={SECONDARY} onClick={onCancel} disabled={busy} autoFocus>
        Cancel
      </button>
      <button type="button" className={RED} onClick={onConfirm} disabled={busy}>
        {action}
      </button>
    </div>
  )
}

// ---- MCP server ----

function McpRows(): React.JSX.Element {
  const titleId = useId()
  const [status, setStatus] = useState<McpStatus | null>(null)
  // One call at a time, so a late answer can't undo a newer one.
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    window.opencat.mcp
      .status()
      .then((s) => live && setStatus(s))
      .catch((err: unknown) => live && setError(messageOf(err)))
    return () => {
      live = false
    }
  }, [])

  const apply = async (call: () => Promise<McpStatus>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await call())
      return true
    } catch (err) {
      setError(messageOf(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  const enabled = status?.enabled ?? false
  return (
    <>
      <div className="flex items-center gap-4 px-4 py-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span id={titleId} className={TITLE}>
            Let outside agents schedule posts
          </span>
          {status && <ServerState status={status} />}
          {error && (
            <span role="alert" className={ERROR}>
              {error}
            </span>
          )}
        </div>
        <Switch
          checked={enabled}
          aria-labelledby={titleId}
          disabled={!status || busy}
          onClick={() => void apply(() => window.opencat.mcp.setEnabled(!enabled))}
        />
      </div>
      {status?.enabled && (
        <>
          <SetupRow status={status} />
          <ToolsRow />
          <AutopilotNoteRow />
          <TokenRow
            busy={busy}
            onRegenerate={() => apply(() => window.opencat.mcp.regenerateToken())}
          />
        </>
      )}
    </>
  )
}

/** Running, off, or on but not running and why: a coloured dot and a line in mono. */
function ServerState({ status }: { status: McpStatus }): React.JSX.Element {
  const [dot, text] = status.running
    ? ['bg-ds-green', `Running on 127.0.0.1:${MCP_PORT}`]
    : status.enabled
      ? ['bg-ds-red', status.error ?? 'Not running']
      : ['bg-ds-text-3', 'Off']
  return (
    <span className="flex items-start gap-1.5" data-testid="mcp-state">
      {/* Level with the first line of text, which may wrap when it is an error. */}
      <span aria-hidden="true" className={`mt-[5px] size-[7px] shrink-0 rounded-full ${dot}`} />
      <span className="font-mono text-[11px] leading-[17px] text-ds-text-3">{text}</span>
    </span>
  )
}

type App = 'desktop' | 'code'

const STEPS: Record<App, string[]> = {
  desktop: [
    "Open Claude Desktop's settings, then Developer → Edit Config.",
    'Paste this into claude_desktop_config.json, then restart Claude Desktop.'
  ],
  code: [
    'Run this in a terminal.',
    "Start a new Claude Code session. OpenCatt's tools show up in /mcp."
  ]
}

function SetupRow({ status }: { status: McpStatus }): React.JSX.Element {
  const [app, setApp] = useState<App>('desktop')
  const panelId = useId()
  const snippet = app === 'desktop' ? status.claudeDesktop : status.claudeCode
  const tab = (value: App, label: string): React.JSX.Element => (
    <SegmentedItem
      role="tab"
      aria-selected={app === value}
      aria-pressed={app === value}
      aria-controls={panelId}
      onClick={() => setApp(value)}
    >
      {label}
    </SegmentedItem>
  )
  return (
    <div className="flex flex-col items-start gap-3 px-4 py-3.5">
      <Segmented role="tablist" aria-label="Set up" className="!h-[30px]">
        {tab('desktop', 'Claude Desktop')}
        {tab('code', 'Claude Code')}
      </Segmented>
      <div id={panelId} role="tabpanel" className="flex w-full flex-col gap-3">
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {STEPS[app].map((step, i) => (
            <li key={step} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="box-border grid size-5 shrink-0 place-items-center rounded-full border border-ds-border-strong text-[11px] font-semibold text-ds-text-2"
              >
                {i + 1}
              </span>
              <span className="text-[12px] leading-[20px] text-ds-text-2">{step}</span>
            </li>
          ))}
        </ol>
        {snippet && <CodeBlock text={snippet} label={app === 'desktop' ? 'Config' : 'Command'} />}
      </div>
    </div>
  )
}

function CodeBlock({ text, label }: { text: string; label: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = (): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="box-border flex w-full items-start gap-2.5 rounded-lg border border-ds-border bg-ds-inset px-3 py-2.5">
      <pre
        aria-label={label}
        className="m-0 min-w-0 flex-1 font-mono text-[11px] leading-[1.55] break-all whitespace-pre-wrap text-ds-text select-all"
      >
        {text}
      </pre>
      <button type="button" className={SECONDARY} onClick={copy}>
        <Copy size={13} aria-hidden="true" />
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function ToolsRow(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5">
      <span className={TITLE}>What agents can do</span>
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Tools">
        {TOOLS.map((tool) => (
          <li
            key={tool}
            className="box-border flex h-[22px] items-center rounded-md border border-ds-border bg-ds-inset px-2 font-mono text-[11px] text-ds-text-2"
          >
            {tool}
          </li>
        ))}
      </ul>
      <p className="m-0 flex items-center gap-2 text-[12px] text-ds-text-2">
        <ShieldCheck size={14} className="shrink-0 text-ds-amber" aria-hidden="true" />
        Everything they create waits in Approvals, unless the account has Autopilot on.
      </p>
    </div>
  )
}

/** Autopilot skips Approvals for outside agents too (OP-104); it is set in Settings. */
function AutopilotNoteRow(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <Zap size={14} className="shrink-0 text-ds-amber" aria-hidden="true" />
      <p className="m-0 min-w-0 flex-1 text-[12px] leading-[17px] text-ds-text-2">
        On accounts with Autopilot on, posts from outside agents are scheduled straight away.
      </p>
      <Link
        to="/settings#autopilot"
        className="shrink-0 text-[12px] font-medium whitespace-nowrap text-ds-accent no-underline hover:underline"
      >
        Autopilot settings
      </Link>
    </div>
  )
}

function TokenRow({
  busy,
  onRegenerate
}: {
  busy: boolean
  onRegenerate: () => Promise<boolean>
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  if (confirming) {
    return (
      <ConfirmRow
        title="Regenerate the access token?"
        sub="Configs already pasted into Claude Desktop or Claude Code stop working. You'll paste the new one."
        action="Regenerate"
        busy={busy}
        // A failure shows under the switch, where every MCP error goes.
        error={null}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void onRegenerate().then(() => setConfirming(false))}
      />
    )
  }
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className={TITLE}>Access token</span>
        <span className={SUB}>Regenerating it stops every config you&rsquo;ve already pasted.</span>
      </div>
      <button
        type="button"
        className={SECONDARY}
        disabled={busy}
        onClick={() => setConfirming(true)}
      >
        <RefreshCw size={13} aria-hidden="true" />
        Regenerate token
      </button>
    </div>
  )
}

// ---- X accounts ----

// Which connect is running, or how the last one failed: an account's id, or ADD.
type Connecting =
  { target: string; state: 'busy' } | { target: string; state: 'error'; message: string }

const ADD = 'add'

function AccountRows(): React.JSX.Element {
  const { status } = useActiveAccount()
  const [connecting, setConnecting] = useState<Connecting | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<{ id: string; error: string | null } | null>(
    null
  )
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => void (live.current = false)
  }, [])

  // auth.onChanged brings the new list; nothing to do here on success but clear the state.
  const connect = (target: string): void => {
    setConnecting({ target, state: 'busy' })
    window.opencat.auth
      .connect()
      .then(() => live.current && setConnecting(null))
      .catch(
        (err: unknown) =>
          live.current && setConnecting({ target, state: 'error', message: authErrorMessage(err) })
      )
  }

  const disconnect = (id: string): void => {
    setDisconnecting({ id, error: null })
    window.opencat.auth
      .disconnect(id)
      .then(() => {
        if (!live.current) return
        setDisconnecting(null)
        setConfirming(null)
      })
      .catch(
        (err: unknown) => live.current && setDisconnecting({ id, error: authErrorMessage(err) })
      )
  }

  const busy = connecting?.state === 'busy'
  const errorFor = (target: string): string | null =>
    connecting?.state === 'error' && connecting.target === target ? connecting.message : null
  const accounts = status?.accounts ?? []

  return (
    <>
      {accounts.map((account, i) =>
        confirming === account.id ? (
          <ConfirmRow
            key={account.id}
            title={`Disconnect @${account.handle}?`}
            sub="Its posts stay in OpenCatt, but they won't go out until you connect it again."
            action="Disconnect"
            busy={disconnecting?.id === account.id && disconnecting.error === null}
            error={disconnecting?.id === account.id ? disconnecting.error : null}
            onCancel={() => {
              setConfirming(null)
              setDisconnecting(null)
            }}
            onConfirm={() => disconnect(account.id)}
          />
        ) : (
          <AccountRow
            key={account.id}
            account={account}
            index={i}
            busy={busy}
            reconnecting={busy && connecting.target === account.id}
            error={errorFor(account.id)}
            onReconnect={() => connect(account.id)}
            onDisconnect={() => setConfirming(account.id)}
          />
        )
      )}
      {status && accounts.length === 0 && (
        <p className="m-0 px-4 py-3.5 text-[12px] text-ds-text-3">No X account connected yet.</p>
      )}
      <div className="flex flex-col gap-1.5 px-4 py-3">
        <button
          type="button"
          className="flex cursor-pointer items-center gap-3 self-start border-0 bg-transparent p-0 text-left text-ds-text-2 disabled:cursor-default hover:not-disabled:text-ds-text"
          disabled={busy}
          onClick={() => connect(ADD)}
        >
          <span
            aria-hidden="true"
            className="box-border grid size-8 shrink-0 place-items-center rounded-full border border-ds-border-strong"
          >
            <Plus size={14} />
          </span>
          <span className="text-[13px] font-medium">
            {busy && connecting.target === ADD ? 'Connecting…' : 'Add an X account'}
          </span>
        </button>
        {errorFor(ADD) && (
          <span role="alert" className={`${ERROR} pl-11`}>
            {errorFor(ADD)}
          </span>
        )}
      </div>
    </>
  )
}

function AccountRow({
  account,
  index,
  busy,
  reconnecting,
  error,
  onReconnect,
  onDisconnect
}: {
  account: XAccount
  index: number
  busy: boolean
  reconnecting: boolean
  error: string | null
  onReconnect: () => void
  onDisconnect: () => void
}): React.JSX.Element {
  const nameId = useId()
  return (
    // On a narrow window the buttons wrap under the name rather than squeezing it to nothing.
    <div
      role="group"
      aria-labelledby={nameId}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
    >
      <div className="flex min-w-[160px] flex-1 items-center gap-3">
        <Avatar account={account} index={index} size={32} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span id={nameId} className={`${TITLE} truncate`}>
            {account.name || `@${account.handle}`}
          </span>
          <span className="truncate text-[12px] text-ds-text-3">@{account.handle}</span>
          {error && (
            <span role="alert" className={ERROR}>
              {error}
            </span>
          )}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <Pill tone={account.needsReconnect ? 'failed' : 'posted'}>
          {account.needsReconnect ? 'Needs reconnecting' : 'Connected'}
        </Pill>
        {account.needsReconnect && (
          <button type="button" className={PRIMARY} disabled={busy} onClick={onReconnect}>
            {reconnecting ? 'Connecting…' : 'Reconnect'}
          </button>
        )}
        <button type="button" className={`${OUTLINE} text-ds-red`} onClick={onDisconnect}>
          Disconnect
        </button>
      </div>
    </div>
  )
}
