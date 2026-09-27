import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AudioLines,
  Film,
  ImagePlus,
  PanelRightClose,
  PanelRightOpen,
  Settings2,
  Sparkles,
  Trash2
} from 'lucide-react'
import type { AgentStatus, ChatMessage, Post } from '@shared/api'
import { AgentSettingsForm } from './AgentSettingsForm'
import { onOpenAgentSettings } from './agentSettingsRequest'
import { INSTALL_URL, LOGIN_COMMAND, planName } from './agentSetup'
import { Composer } from './Composer'
import { PanelResizeHandle } from './PanelResizeHandle'
import { PANEL_RAIL } from './panelLayout'
import { PostCard } from './PostCard'
import { RenderCard } from './RenderCard'
import { usePanelLayout } from './usePanelLayout'
import { usePending } from '../calendar/usePending'
import { parseToolResult } from '@shared/toolResult'
import { messageOf, useAgentChat, type ChatError } from './useAgentChat'
import { Button, buttonClass } from '../ui'
import { S } from './settingsStyles'
import { useAttachments } from './useAttachments'
import { ModeChip } from './ModeRow'
import { ViewButton } from '../media/ViewButton'
import { useMediaViewer, viewerItem } from '../media/viewerContext'

interface Props {
  /** Called when the user clicks a post card; the calendar opens that post's day. */
  onOpenPost?: (post: Post) => void
  /** Called from the agent settings' "Other agents (MCP)" row; the shell opens Integrations. */
  onOpenIntegrations?: () => void
  /** Called from the header's voice button (OP-75); the shell opens Settings, Voice. */
  onOpenVoice?: () => void
}

/** The chat with the agent, on the right of the main area. */
export function ChatPanel({
  onOpenPost,
  onOpenIntegrations,
  onOpenVoice
}: Props): React.JSX.Element {
  const panel = useRef<HTMLElement>(null)
  const layout = usePanelLayout(panel)
  const pending = usePending()
  const { open, setOpen: setLayoutOpen } = layout
  // Kept here, not in the conversation, so the Settings screen can ask for it (OP-65).
  const [showSettings, setShowSettings] = useState(false)
  // Closing puts the panel back on the chat for next time.
  const setOpen = useCallback(
    (next: boolean) => {
      setLayoutOpen(next)
      if (!next) setShowSettings(false)
    },
    [setLayoutOpen]
  )

  useEffect(
    () =>
      onOpenAgentSettings(() => {
        setLayoutOpen(true)
        setShowSettings(true)
      }),
    [setLayoutOpen]
  )

  // ⌘\ on macOS, Ctrl+\ elsewhere, like an editor's side bar; dialogs keep their own keys.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== '\\' || !(event.metaKey || event.ctrlKey) || event.altKey) return
      if (event.target instanceof Element && event.target.closest('[role="dialog"]')) return
      event.preventDefault()
      setOpen(!open)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) {
    const waiting = pending?.count ?? 0
    const openLabel = 'Open the agent panel'
    // The collapsed rail (Designer's frame, #epic-8 message 938): the agent icon, with how many
    // posts wait for approval on its corner, and the open button at the bottom.
    return (
      <aside
        ref={panel}
        className="chat-panel collapsed"
        style={{ width: PANEL_RAIL }}
        aria-label="Agent panel, collapsed"
        title={layout.squeezed ? 'The window is too narrow for the agent panel' : undefined}
      >
        <button
          type="button"
          className="relative cursor-pointer border-0 bg-transparent p-0"
          onClick={() => setOpen(true)}
          aria-label={waiting > 0 ? `${openLabel}, ${waiting} waiting for approval` : openLabel}
        >
          <span
            className="grid size-7 shrink-0 place-items-center rounded-lg bg-ds-accent-2 text-ds-accent-text"
            aria-hidden="true"
          >
            <Sparkles size={15} />
          </span>
          {/* The waiting count sits on the icon's top-right corner (boss, #epic-8 message 942). */}
          {waiting > 0 && (
            <span
              className="absolute -top-[4px] left-[19px] grid h-[15px] min-w-[15px] place-items-center rounded-[8px] bg-ds-amber px-[3px] text-[9px] leading-none font-bold text-[#1A1206]"
              aria-hidden="true"
            >
              {waiting}
            </span>
          )}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          className="grid size-8 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-ds-text-3 hover:text-ds-text"
          onClick={() => setOpen(true)}
          aria-label="Expand the agent panel"
        >
          <PanelRightOpen size={16} aria-hidden="true" />
        </button>
      </aside>
    )
  }

  return (
    <aside
      ref={panel}
      className="chat-panel"
      style={{ width: layout.width }}
      aria-label="Chat with the agent"
    >
      <PanelResizeHandle
        width={layout.width}
        max={layout.max}
        preview={layout.preview}
        commit={layout.commit}
      />
      <Conversation
        onClose={() => setOpen(false)}
        onOpenPost={onOpenPost}
        onOpenIntegrations={onOpenIntegrations}
        onOpenVoice={onOpenVoice}
        showSettings={showSettings}
        setShowSettings={setShowSettings}
      />
    </aside>
  )
}

function Conversation({
  onClose,
  onOpenPost,
  onOpenIntegrations,
  onOpenVoice,
  showSettings,
  setShowSettings
}: {
  onClose: () => void
  onOpenPost?: (post: Post) => void
  onOpenIntegrations?: () => void
  onOpenVoice?: () => void
  showSettings: boolean
  setShowSettings: React.Dispatch<React.SetStateAction<boolean>>
}): React.JSX.Element {
  const chat = useAgentChat()
  const attachments = useAttachments()
  // Counts dragenter/dragleave pairs, which fire for every child the files pass over.
  const [dragDepth, setDragDepth] = useState(0)
  const [confirmClear, setConfirmClear] = useState(false)
  // Unknown until main answers; the setup card shows only once we know nothing is ready.
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [rechecking, setRechecking] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    window.opencat.agent
      .status()
      .then((s) => live && setStatus(s))
      .catch((err: unknown) => live && setStatusError(messageOf(err)))
    return () => {
      live = false
    }
  }, [])

  const recheck = async (): Promise<void> => {
    setRechecking(true)
    try {
      setStatus(await window.opencat.agent.recheck())
    } catch (err) {
      setStatusError(messageOf(err))
    } finally {
      setRechecking(false)
    }
  }

  // Back from the terminal after installing or logging in: look again.
  const needsCli =
    status !== null && !status.ready && (status.provider === 'cli' || !status.cli.found)
  useEffect(() => {
    if (!needsCli) return
    const onFocus = (): void => {
      void window.opencat.agent
        .recheck()
        .then(setStatus)
        .catch(() => undefined)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [needsCli])

  const switchToApiKey = async (): Promise<void> => {
    try {
      const next = await window.opencat.agent.setProvider('api')
      setStatus(next)
      if (!next.hasKey) setShowSettings(true)
    } catch (err) {
      setStatusError(messageOf(err))
    }
  }

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [chat.messages, chat.streaming, chat.tool, chat.error])

  const empty =
    chat.loaded &&
    chat.messages.length === 0 &&
    !chat.running &&
    !chat.error &&
    status?.ready !== false

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onDragEnter={(e) => {
        if (showSettings || !hasFiles(e)) return
        e.preventDefault()
        setDragDepth((d) => d + 1)
      }}
      onDragOver={(e) => {
        if (!showSettings && hasFiles(e)) e.preventDefault()
      }}
      onDragLeave={() => setDragDepth((d) => Math.max(0, d - 1))}
      onDrop={(e) => {
        setDragDepth(0)
        const files = Array.from(e.dataTransfer.files)
        if (showSettings || files.length === 0) return
        e.preventDefault()
        void attachments.addFiles(files)
      }}
    >
      <header className="flex h-[60px] shrink-0 items-center gap-2.5 border-b border-ds-border px-4">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-lg bg-ds-accent-2 text-ds-accent-text"
          aria-hidden="true"
        >
          <Sparkles size={15} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <h2 className="m-0 text-[14px] font-semibold">Agent</h2>
          {status && <ProviderPill status={status} />}
        </span>
        {confirmClear ? (
          <span className="flex items-center gap-1.5 text-[12px] text-ds-text-2">
            Clear the chat?
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={() => {
                setConfirmClear(false)
                void chat.clear()
              }}
            >
              Clear
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <span className="flex items-center gap-0.5">
            <button
              type="button"
              className="grid size-8 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-ds-text-3 hover:text-ds-text"
              onClick={() => {
                setShowSettings(false)
                onOpenVoice?.()
              }}
              aria-label="Voice settings"
              title="Voice settings"
            >
              <AudioLines size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`grid size-8 cursor-pointer place-items-center rounded-lg border-0 ${showSettings ? 'bg-ds-raised text-ds-text' : 'bg-transparent text-ds-text-3 hover:text-ds-text'}`}
              onClick={() => setShowSettings((v) => !v)}
              aria-pressed={showSettings}
              aria-label="Settings"
            >
              <Settings2 size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="grid size-8 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-ds-text-3 hover:text-ds-text disabled:opacity-40"
              onClick={() => setConfirmClear(true)}
              disabled={chat.running || chat.messages.length === 0 || showSettings}
              aria-label="Clear"
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="grid size-8 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-ds-text-3 hover:text-ds-text"
              onClick={onClose}
              aria-label="Close chat"
            >
              <PanelRightClose size={16} aria-hidden="true" />
            </button>
          </span>
        )}
      </header>

      {showSettings &&
        (status ? (
          <AgentSettingsForm
            status={status}
            onChange={setStatus}
            onDone={() => setShowSettings(false)}
            // The panel goes back to the chat, so it isn't left on settings behind the screen.
            onOpenIntegrations={() => {
              setShowSettings(false)
              onOpenIntegrations?.()
            }}
          />
        ) : (
          <div className={S.panel}>
            {statusError ? (
              <p className="m-0 text-[13px] text-ds-red">{statusError}</p>
            ) : (
              <p className="m-0 text-[13px] text-ds-text-3">Loading…</p>
            )}
          </div>
        ))}

      {!showSettings && (
        <div
          className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4"
          ref={listRef}
          role="log"
          aria-live="polite"
        >
          {status && !status.ready && !chat.error && (
            <SetupCard
              status={status}
              rechecking={rechecking}
              onRecheck={() => void recheck()}
              onUseApiKey={() => void switchToApiKey()}
              onSettings={() => setShowSettings(true)}
            />
          )}
          {empty && (
            <p className="m-auto max-w-[260px] text-center text-[13px] leading-[1.5] text-ds-text-3">
              Tell the agent what to post and when, like &ldquo;schedule three posts about our
              launch for next week&rdquo;.
            </p>
          )}
          {chat.messages.map((message) => (
            <Message key={message.id} message={message} onOpenPost={onOpenPost} />
          ))}
          {chat.tool && <Working>Working: {chat.tool.replaceAll('_', ' ')}…</Working>}
          {chat.streaming && (
            <div className={ASSISTANT} data-testid="streaming">
              {chat.streaming}
            </div>
          )}
          {chat.running && !chat.streaming && !chat.tool && <Working>Thinking…</Working>}
          {chat.error && (
            <ErrorNote
              error={chat.error}
              onRetry={() => void chat.retry()}
              onSettings={() => setShowSettings(true)}
            />
          )}
        </div>
      )}

      {!showSettings && (
        <Composer
          disabled={status !== null && !status.ready && !chat.running}
          running={chat.running}
          recording={chat.tool === 'render_video'}
          attachments={attachments}
          onSend={(text, mediaIds, mode, videoSeconds) =>
            void chat.send(text, mediaIds, mode, videoSeconds)
          }
          onStop={() => void chat.cancel()}
        />
      )}
      {dragDepth > 0 && <DropOverlay />}
    </div>
  )
}

const hasFiles = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('Files')

/** Pencil "OP-21 v2 · Drag files over the chat": the whole panel takes the drop. */
function DropOverlay(): React.JSX.Element {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-[6px] rounded-[14px] border-2 border-ds-accent bg-[#0E0E11E6]"
      role="status"
    >
      <span className="mb-[6px] grid size-[48px] place-items-center rounded-[12px] bg-ds-accent-2 text-ds-accent-text">
        <ImagePlus size={22} aria-hidden="true" />
      </span>
      <span className="text-[15px] font-semibold text-ds-text">Drop to attach</span>
      <span className="text-[12px] text-ds-text-3">Up to 4 images, a GIF or a video</span>
    </div>
  )
}

const ASSISTANT = 'text-[13px] leading-[1.5] whitespace-pre-wrap [overflow-wrap:anywhere]'
const USER =
  'self-end max-w-[85%] rounded-xl bg-ds-accent px-3 py-[9px] text-[13px] leading-[1.5] whitespace-pre-wrap text-white [overflow-wrap:anywhere]'

function Working({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="m-0 flex items-center gap-2 text-[12px] text-ds-text-3">
      <span className="spinner" aria-hidden="true" />
      {children}
    </p>
  )
}

function Message({
  message,
  onOpenPost
}: {
  message: ChatMessage
  onOpenPost?: (post: Post) => void
}): React.JSX.Element | null {
  const viewer = useMediaViewer()
  if (message.role === 'tool') {
    const result = parseToolResult(message.content)
    if (!result) return null
    if (result.kind === 'render') return <RenderCard render={result} onOpenPost={onOpenPost} />
    return (
      <div className="flex flex-col gap-2.5">
        {result.postIds.map((id) => (
          <PostCard key={id} postId={id} action={result.action} onOpen={onOpenPost} />
        ))}
      </div>
    )
  }
  if (message.role === 'assistant' && message.via) {
    return (
      <div className="flex flex-col gap-1">
        <div className={ASSISTANT}>{message.content}</div>
        <small className="text-[11px] text-ds-text-3">{message.via}</small>
      </div>
    )
  }
  if (message.role === 'user' && message.media.length > 0) {
    // Pencil "OP-21 v2 · Attachments in chat": 68px thumbnails above the text, 8px in.
    return (
      <div className="flex max-w-[236px] flex-col gap-[8px] self-end rounded-xl bg-ds-accent px-[8px] pt-[8px] pb-[9px] text-[13px] leading-[20px] whitespace-pre-wrap text-white [overflow-wrap:anywhere]">
        <ModeChip mode={message.mode} />
        <div className="flex flex-wrap gap-[6px]">
          {message.media.map((m, i) => (
            <ViewButton
              key={m.id}
              kind={m.kind}
              onOpen={() =>
                viewer.open(
                  message.media.map((file) => viewerItem(file)),
                  i
                )
              }
              className="rounded-[8px]"
            >
              {m.kind === 'video' ? (
                <span className="grid size-[68px] place-items-center rounded-[8px] bg-black/25 text-white outline outline-1 -outline-offset-[0.5px] outline-white/20">
                  <Film size={20} aria-hidden="true" />
                </span>
              ) : (
                <img
                  src={m.url}
                  alt={m.alt ?? ''}
                  className="block size-[68px] rounded-[8px] object-cover outline outline-1 -outline-offset-[0.5px] outline-white/20"
                />
              )}
            </ViewButton>
          ))}
        </div>
        {message.content && <span className="px-[4px]">{message.content}</span>}
      </div>
    )
  }
  if (message.role === 'user' && message.mode !== 'text') {
    // Pencil "OP-79 · Mode states": the mode chip on the first line.
    return (
      <div className={`${USER} flex flex-col gap-[6px]`}>
        <ModeChip mode={message.mode} />
        <span>{message.content}</span>
      </div>
    )
  }
  return <div className={message.role === 'user' ? USER : ASSISTANT}>{message.content}</div>
}

/** Who answers the next message, and whether it can. */
function ProviderPill({ status }: { status: AgentStatus }): React.JSX.Element {
  const cli = status.provider === 'cli'
  const label = cli ? 'Claude Code' : status.hasKey ? 'API key' : 'Not set up'
  const state = status.ready ? 'ready' : cli ? 'login' : 'none'
  const title = status.ready
    ? cli
      ? `Replies come from Claude Code${status.cli.plan ? ` on your ${planName(status.cli.plan)}` : ''}`
      : 'Replies come from your Anthropic API key'
    : cli
      ? 'Claude Code needs you to log in'
      : 'The agent is not set up yet'
  return (
    <span
      className="provider-pill flex items-center gap-[5px] text-[11px] text-ds-text-3"
      data-state={state}
      title={title}
    >
      <span
        className={`size-1.5 rounded-full ${state === 'ready' ? 'bg-ds-green' : state === 'login' ? 'bg-ds-amber' : 'bg-ds-text-3'}`}
        aria-hidden
      />
      {label}
    </span>
  )
}

/** In place of the chat's first lines while the chosen provider can't answer. */
function SetupCard({
  status,
  rechecking,
  onRecheck,
  onUseApiKey,
  onSettings
}: {
  status: AgentStatus
  rechecking: boolean
  onRecheck: () => void
  onUseApiKey: () => void
  onSettings: () => void
}): React.JSX.Element {
  const recheckLabel = rechecking ? 'Checking…' : 'Recheck'
  if (status.provider === 'cli') {
    const failed = status.cli.error
    return (
      <div className={`${SETUP} border-ds-amber/50`} data-state="login" role="status">
        <strong>{failed ? "Claude Code didn't answer" : "Claude Code isn't logged in"}</strong>
        <span>
          {failed ??
            `Run ${LOGIN_COMMAND} in a terminal and sign in with your Claude account, then recheck.`}
        </span>
        <span className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onRecheck}
            disabled={rechecking}
          >
            {recheckLabel}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onUseApiKey}>
            Use an API key
          </Button>
        </span>
      </div>
    )
  }
  if (status.cli.found || status.providerChosen) {
    return (
      <div className={SETUP} role="status">
        <span>The agent needs your Anthropic API key before it can help.</span>
        <span className="flex flex-wrap gap-1.5">
          <Button type="button" variant="primary" size="sm" onClick={onSettings}>
            Add API key
          </Button>
        </span>
      </div>
    )
  }
  return (
    <div className={SETUP} role="status">
      <strong>Set up the agent</strong>
      <span>
        Install Claude Code to use your Claude plan, or add an Anthropic API key and pay per use.
      </span>
      <span className="flex flex-wrap gap-1.5">
        <a
          className={buttonClass('primary', 'sm', 'no-underline')}
          href={INSTALL_URL}
          target="_blank"
          rel="noreferrer"
        >
          Install Claude Code
        </a>
        <Button type="button" variant="secondary" size="sm" onClick={onSettings}>
          Add API key
        </Button>
      </span>
      <button
        type="button"
        className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-ds-accent-text"
        onClick={onRecheck}
        disabled={rechecking}
      >
        {rechecking ? 'Checking…' : 'Already installed? Recheck'}
      </button>
    </div>
  )
}

const SETUP =
  'flex flex-col items-start gap-2.5 rounded-[10px] border border-ds-border-strong bg-ds-raised p-3 text-[13px] leading-[1.5] [&>span:not(:last-child)]:text-ds-text-2 [&>strong]:text-[13px] [&>strong]:font-semibold'

function ErrorNote({
  error,
  onRetry,
  onSettings
}: {
  error: ChatError
  onRetry: () => void
  onSettings: () => void
}): React.JSX.Element {
  const keyProblem = ['no_key', 'bad_key', 'no_cli', 'cli_login'].includes(error.code)
  const text =
    error.code === 'no_key'
      ? 'The agent needs your Anthropic API key. Add it in Settings, then try again.'
      : error.code === 'network'
        ? 'Could not reach the model. Check your connection and try again.'
        : error.message
  return (
    <div
      className="flex flex-col items-start gap-2.5 rounded-[10px] border border-ds-red/40 bg-ds-red-2 p-3 text-[13px] leading-[1.5] text-ds-red"
      role="alert"
    >
      <span>{text}</span>
      <span className="flex gap-1.5">
        {keyProblem && (
          <Button type="button" variant="secondary" size="sm" onClick={onSettings}>
            Open settings
          </Button>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </span>
    </div>
  )
}
