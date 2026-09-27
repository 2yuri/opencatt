import { useState } from 'react'
import type { AgentProvider, AgentStatus } from '@shared/api'
import { INSTALL_URL, LOGIN_COMMAND, planName } from './agentSetup'
import { messageOf } from './useAgentChat'
import { Button } from '../ui'
import { S } from './settingsStyles'

const KEYS_URL = 'https://console.anthropic.com/settings/keys'

interface Props {
  status: AgentStatus
  onChange: (status: AgentStatus) => void
  onDone: () => void
  /** Leaves for the Integrations screen, where access for other agents (MCP) lives (OP-83). */
  onOpenIntegrations: () => void
}

/**
 * The agent's settings: which provider answers (the claude CLI or an Anthropic key), the CLI's
 * state with what to do about it, the key (checked, then kept encrypted in main) and the model.
 */
export function AgentSettingsForm({
  status,
  onChange,
  onDone,
  onOpenIntegrations
}: Props): React.JSX.Element {
  const [key, setKey] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apply = async (call: () => Promise<AgentStatus>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      onChange(await call())
      return true
    } catch (err) {
      setError(messageOf(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    if (await apply(() => window.opencat.agent.setKey(key))) {
      setKey('')
      setReplacing(false)
    }
  }

  const choose = (provider: AgentProvider): void => {
    if (provider !== status.provider) void apply(() => window.opencat.agent.setProvider(provider))
  }

  const cli = status.cli
  const onCli = status.provider === 'cli'
  const cliDisabled = !cli.found && !onCli

  return (
    <div className={S.panel}>
      <h3 id="agent-provider" className={S.heading}>
        Agent runs on
      </h3>
      <div role="radiogroup" aria-labelledby="agent-provider" className={S.options}>
        <div className={`${S.option} ${onCli ? S.optionSelected : S.optionIdle}`}>
          <label className={S.optionHead}>
            <input
              type="radio"
              className={S.optionRadio}
              name="agent-provider"
              checked={onCli}
              disabled={busy || cliDisabled}
              onChange={() => choose('cli')}
            />
            <span className={S.optionText}>
              <strong className={cliDisabled ? 'text-(--muted)' : undefined}>Claude Code</strong>
              <small className={S.small}>
                Runs on your Claude plan through the claude CLI. No API key.
              </small>
            </span>
          </label>
          <CliState status={status} busy={busy} onRecheck={() => void apply(recheck)} />
        </div>

        <div className={`${S.option} ${onCli ? S.optionIdle : S.optionSelected}`}>
          <label className={S.optionHead}>
            <input
              type="radio"
              className={S.optionRadio}
              name="agent-provider"
              checked={!onCli}
              disabled={busy}
              onChange={() => choose('api')}
            />
            <span className={S.optionText}>
              <strong>Anthropic API key</strong>
              <small className={S.small}>Billed per use to your Anthropic account.</small>
            </span>
          </label>
          {!status.canStoreKey ? (
            <p className={S.error} role="alert">
              Your system has no keyring to keep the key safe. Install and unlock GNOME Keyring or
              KWallet, then restart OpenCatt.
            </p>
          ) : status.hasKey && !replacing ? (
            <div className={`${S.optionBody} ${S.row}`}>
              <small className={S.small}>Your key is saved, encrypted on this computer.</small>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setReplacing(true)}
                disabled={busy}
              >
                Replace
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void apply(() => window.opencat.agent.clearKey())}
                disabled={busy}
              >
                Remove
              </Button>
            </div>
          ) : !onCli || replacing ? (
            <form
              className={`${S.optionBody} ${S.row}`}
              onSubmit={(e) => {
                e.preventDefault()
                void save()
              }}
            >
              <small className={S.small}>
                Create a key at{' '}
                <a href={KEYS_URL} target="_blank" rel="noreferrer" className={S.link}>
                  console.anthropic.com
                </a>{' '}
                and paste it here. It&rsquo;s checked, then stored encrypted and never leaves this
                computer except to talk to Anthropic.
              </small>
              <input
                type="password"
                className={S.keyInput}
                aria-label="Anthropic API key"
                placeholder="sk-ant-…"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={busy || key.trim() === ''}
              >
                {busy ? 'Checking…' : 'Save key'}
              </Button>
              {replacing && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setReplacing(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
              )}
            </form>
          ) : null}
        </div>
      </div>

      <h3 className={S.heading}>Model</h3>
      <select
        aria-label="Model"
        className={S.select}
        value={status.model}
        disabled={busy}
        onChange={(e) => void apply(() => window.opencat.agent.setModel(e.target.value))}
      >
        {status.models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <p className={S.note}>
        Used by whichever one you picked above. With Claude Code it counts toward your plan&rsquo;s
        limits.
      </p>

      <label className={`${S.row} cursor-pointer`}>
        <input
          type="checkbox"
          checked={status.sendImages}
          disabled={busy}
          onChange={(e) => {
            const on = e.target.checked
            void apply(() => window.opencat.agent.setSendImages(on))
          }}
        />
        Show images you attach in the chat to the agent
      </label>
      <p className={S.note}>
        They go to Claude with your message, scaled down, so it can write about them and add alt
        text. Each image adds a little to the cost of that message.
      </p>

      {error && (
        <p className={S.error} role="alert">
          {error}
        </p>
      )}

      <section className={S.row} aria-label="Other agents">
        <h3 className={`${S.heading} flex-1`}>Other agents (MCP)</h3>
        <button
          type="button"
          className={`${S.link} mt-[8px] cursor-pointer border-0 bg-transparent p-0 text-[11.7px] font-medium hover:underline`}
          onClick={onOpenIntegrations}
        >
          Open Integrations
        </button>
      </section>

      <div className={S.actions}>
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          Back to chat
        </Button>
      </div>
    </div>
  )
}

const recheck = (): Promise<AgentStatus> => window.opencat.agent.recheck()

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

  if (!cli.found) {
    return (
      <div className={S.cliStatus} data-state="missing">
        <p className={S.cliLine}>
          <span className={`${S.cliIcon} ${S.cliIconState.missing}`} aria-hidden>
            ×
          </span>
          Claude Code isn&rsquo;t installed on this computer.
        </p>
        <div className={S.row}>
          <a href={INSTALL_URL} target="_blank" rel="noreferrer" className={S.cliInstall}>
            Install Claude Code ↗
          </a>
          <Button type="button" variant="secondary" size="sm" onClick={onRecheck} disabled={busy}>
            {busy ? 'Checking…' : 'Recheck'}
          </Button>
        </div>
        <small className={S.small}>
          Then log in with {LOGIN_COMMAND}. OpenCatt looks in PATH, ~/.local/bin, ~/.claude/local
          and Homebrew.
        </small>
      </div>
    )
  }

  if (cli.error || !cli.loggedIn) {
    return (
      <div className={S.cliStatus} data-state="login">
        <p className={S.cliLine}>
          <span className={`${S.cliIcon} ${S.cliIconState.login}`} aria-hidden>
            !
          </span>
          {cli.error ?? `${version} is installed but not logged in.`}
        </p>
        {!cli.error && <CopyCommand command={LOGIN_COMMAND} />}
        <div className={S.row}>
          <small className={`${S.small} flex-1`}>
            {cli.error
              ? 'Check it in a terminal, then recheck.'
              : 'Run it in a terminal and sign in, then recheck.'}
          </small>
          <Button type="button" variant="primary" size="sm" onClick={onRecheck} disabled={busy}>
            {busy ? 'Checking…' : 'Recheck'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={S.cliStatus} data-state="ready">
      <p className={S.cliLine}>
        <span className={`${S.cliIcon} ${S.cliIconState.ready}`} aria-hidden>
          ✓
        </span>
        <span className="flex-1">{version}, logged in</span>
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0 text-[12px] font-medium text-ds-accent-text"
          onClick={onRecheck}
          disabled={busy}
        >
          {busy ? 'Checking…' : 'Recheck'}
        </button>
      </p>
      <small className={S.cliPath}>
        {[cli.plan && planName(cli.plan), cli.path].filter(Boolean).join(' · ')}
      </small>
    </div>
  )
}

function CopyCommand({ command }: { command: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className={S.cliCommand}>
      <code className="text-[10.4px]">{command}</code>
      <button
        type="button"
        className="cursor-pointer border-0 bg-transparent p-0 text-[12px] font-medium text-ds-accent-text"
        onClick={() => {
          void navigator.clipboard.writeText(command).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
