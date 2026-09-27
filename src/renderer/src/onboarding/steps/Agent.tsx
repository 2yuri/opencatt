import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck } from 'lucide-react'
import type { AgentProvider, AgentStatus } from '@shared/api'
import { INSTALL_URL, LOGIN_COMMAND, planName } from '../../chat/agentSetup'
import { linkButton, messageOf, spacer, type SummaryLine } from '../helpers'
import { BackButton, ErrorBox, NextButton, StepPage } from '../shared'

/** The agent step's summary line, from the provider the user settled on. */
function agentSummary(status: AgentStatus): SummaryLine {
  if (status.provider === 'cli') {
    const plan = status.cli.plan ? ` (${planName(status.cli.plan)})` : ''
    return { text: `Agent runs on Claude Code${plan}`, ok: status.ready }
  }
  return status.hasKey
    ? { text: 'Agent runs on your Anthropic API key', ok: true }
    : { text: "Add your Anthropic API key in the agent's settings", ok: false }
}

export function AgentStep({
  onBack,
  onNext
}: {
  onBack: () => void
  onNext: (line: SummaryLine | null) => void
}): React.JSX.Element {
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.opencat.agent
      .status()
      .then(setStatus)
      .catch((err: unknown) => setError(messageOf(err)))
  }, [])

  const apply = async (call: () => Promise<AgentStatus>): Promise<AgentStatus | null> => {
    setBusy(true)
    setError(null)
    try {
      const next = await call()
      setStatus(next)
      return next
    } catch (err) {
      setError(messageOf(err))
      return null
    } finally {
      setBusy(false)
    }
  }

  const choose = (provider: AgentProvider): void => {
    if (status && provider !== status.provider)
      void apply(() => window.opencat.agent.setProvider(provider))
  }

  // Until the user picks, the provider is only main's guess; Next makes it their choice.
  const next = async (): Promise<void> => {
    if (!status) return
    const chosen = status.providerChosen
      ? status
      : await apply(() => window.opencat.agent.setProvider(status.provider))
    if (chosen) onNext(agentSummary(chosen))
  }

  const onCli = status?.provider === 'cli'
  const cli = status?.cli

  return (
    <StepPage
      step="agent"
      title="Set up the agent"
      lead="The chat agent drafts posts and puts them in Approvals for you. It runs on Claude Code with your Claude plan, or on an Anthropic API key."
      actions={
        <>
          <BackButton onClick={onBack} />
          {spacer}
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-ds-text-3 hover:text-ds-text-2"
            onClick={() => onNext(null)}
          >
            Skip for now
          </button>
          <NextButton disabled={!status || busy} onClick={() => void next()} />
        </>
      }
    >
      <div role="radiogroup" aria-label="Agent runs on" className="flex flex-col gap-[20px]">
        <RadioCard
          title="Claude Code"
          detail="Uses your Claude plan through the claude CLI. No API key, no extra bill."
          checked={onCli}
          disabled={!status || busy || (!cli?.found && !onCli)}
          onChoose={() => choose('cli')}
          badge={cli?.found ? 'Found on this computer' : undefined}
        >
          {status && <CliState status={status} busy={busy} onRecheck={() => void apply(recheck)} />}
        </RadioCard>
        <RadioCard
          title="Anthropic API key"
          detail="Billed per use to your Anthropic account. You can add it later in the agent's settings."
          checked={status !== null && !onCli}
          disabled={!status || busy}
          onChoose={() => choose('api')}
        >
          {status?.hasKey && (
            <StatusRow icon={<CircleCheck size={15} className="text-ds-green" />}>
              Your key is saved, encrypted on this computer.
            </StatusRow>
          )}
        </RadioCard>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
    </StepPage>
  )
}

const recheck = (): Promise<AgentStatus> => window.opencat.agent.recheck()

function RadioCard({
  title,
  detail,
  checked,
  disabled,
  onChoose,
  badge,
  children
}: {
  title: string
  detail: string
  checked: boolean
  disabled: boolean
  onChoose: () => void
  badge?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={`box-border flex flex-col gap-[10px] rounded-[12px] bg-ds-raised p-[16px] ${
        checked
          ? 'outline-[1.5px] -outline-offset-[0.75px] outline-ds-accent'
          : 'outline-1 -outline-offset-[0.5px] outline-ds-border'
      }`}
    >
      <label
        className={`flex gap-[12px] ${disabled && !checked ? 'cursor-default opacity-60' : 'cursor-pointer'}`}
      >
        <input
          type="radio"
          name="agent-provider"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={onChoose}
        />
        <span
          aria-hidden="true"
          className={`box-border size-[18px] shrink-0 rounded-full bg-ds-bg peer-focus-visible:ring-2 peer-focus-visible:ring-ds-accent-text ${
            checked
              ? 'outline-[5px] -outline-offset-[2.5px] outline-ds-accent'
              : 'outline-[1.5px] -outline-offset-[0.75px] outline-ds-border-strong'
          }`}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <strong className="text-[14px] font-semibold">{title}</strong>
          <span className="text-[13px] leading-[20px] text-ds-text-2">{detail}</span>
        </span>
        {badge && (
          <span className="self-start rounded-[6px] bg-ds-accent-2 px-[8px] py-[3px] text-[11px] font-semibold whitespace-nowrap text-ds-accent-text">
            {badge}
          </span>
        )}
      </label>
      {children}
    </div>
  )
}

function StatusRow({
  icon,
  children,
  action
}: {
  icon: React.ReactNode
  children: React.ReactNode
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="box-border flex min-h-[40px] items-center gap-[10px] rounded-[9px] bg-ds-inset px-[12px] py-[8px]">
      <span aria-hidden="true" className="flex shrink-0">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-[13px] font-medium">{children}</span>
      {action}
    </div>
  )
}

/** Ready, installed but logged out, or not installed; each with the one thing to do next. */
function CliState({
  status,
  busy,
  onRecheck
}: {
  status: AgentStatus
  busy: boolean
  onRecheck: () => void
}): React.JSX.Element {
  const cli = status.cli
  const version = cli.version ? `Claude Code ${cli.version}` : 'Claude Code'
  const recheckButton = (
    <button
      type="button"
      className={`${linkButton} shrink-0 text-[12px]`}
      onClick={onRecheck}
      disabled={busy}
    >
      {busy ? 'Checking…' : 'Recheck'}
    </button>
  )

  if (!cli.found) {
    return (
      <StatusRow
        icon={<CircleAlert size={15} className="text-ds-text-3" />}
        action={
          <>
            <a
              href={INSTALL_URL}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-[12px] text-ds-accent-text no-underline"
            >
              Install ↗
            </a>
            {recheckButton}
          </>
        }
      >
        Claude Code isn&rsquo;t installed on this computer.
      </StatusRow>
    )
  }

  if (cli.error || !cli.loggedIn) {
    return (
      <StatusRow icon={<CircleAlert size={15} className="text-ds-amber" />} action={recheckButton}>
        {cli.error ??
          `${version} is installed but not logged in. Run ${LOGIN_COMMAND} in a terminal.`}
      </StatusRow>
    )
  }

  return (
    <StatusRow icon={<CircleCheck size={15} className="text-ds-green" />} action={recheckButton}>
      {[`${version}, logged in`, cli.plan && planName(cli.plan)].filter(Boolean).join(' · ')}
    </StatusRow>
  )
}
