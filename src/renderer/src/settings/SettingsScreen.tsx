import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import type { WeekStartSetting, XAccount } from '@shared/api'
import { AutopilotSwitch } from '../autopilot/AutopilotSwitch'
import { useAutopilot } from '../autopilot/useAutopilot'
import { useWeekStart } from '../calendar/useWeekStart'
import { openAgentSettings } from '../chat/agentSettingsRequest'
import { useActiveAccount } from '../shell/useActiveAccount'
import { Switch } from '../ui'
import { BOX, HEADING, LINK, SECTION, messageOf } from './common'
import { Row, Select } from './parts'
import { VoiceSection } from './VoiceSection'

/**
 * App-wide settings (OP-65): starting at login, the week's first day, the active account's voice
 * (OP-75), and ways into the rest.
 */
export function SettingsScreen(): React.JSX.Element {
  // The voice above loads late and pushes Posting down, so #autopilot scrolls again after it.
  const [voiceLoaded, setVoiceLoaded] = useState(false)
  const onVoiceLoaded = useCallback(() => setVoiceLoaded(true), [])
  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex h-[60px] shrink-0 items-center border-b border-ds-border px-5">
        <h1 className="m-0 text-[20px] font-semibold tracking-[-0.4px]">Settings</h1>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-8 py-6">
        <Section title="General">
          <OpenAtLoginRow />
          <WeekStartRow />
        </Section>
        <VoiceSection onLoaded={onVoiceLoaded} />
        <Section title="Accounts">
          <Row
            title="X accounts"
            sub="Connect, reconnect or remove accounts."
            control={
              <Link to="/integrations" className={LINK}>
                Open Integrations
              </Link>
            }
          />
          <Row
            title="X app"
            sub="Your Client ID and callback, from first-time setup."
            control={
              <Link to="/setup" className={LINK}>
                Open setup
              </Link>
            }
          />
        </Section>
        <PostingSection voiceLoaded={voiceLoaded} />
        <Section title="Agent">
          <Row
            title="Agent and model"
            sub="Claude Code or an API key, and the model. Access for other agents is under Integrations."
            control={
              <button type="button" className={LINK} onClick={openAgentSettings}>
                Open agent settings
              </button>
            }
          />
        </Section>
      </div>
    </main>
  )
}

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  const id = useId()
  return (
    <section className={SECTION} aria-labelledby={id}>
      <h2 id={id} className={HEADING}>
        {title}
      </h2>
      <div className={BOX}>{children}</div>
    </section>
  )
}

/**
 * Posting, for the active account (Pencil "OP-104 · 4"): its Autopilot. /settings#autopilot, from
 * Integrations, brings it into view. No account, no section.
 */
function PostingSection({ voiceLoaded }: { voiceLoaded: boolean }): React.JSX.Element | null {
  const { active } = useActiveAccount()
  const headingId = useId()
  const ref = useRef<HTMLElement>(null)
  const location = useLocation()
  const shown = active !== undefined

  useEffect(() => {
    if (shown && location.hash === '#autopilot') ref.current?.scrollIntoView?.({ block: 'start' })
  }, [shown, voiceLoaded, location.hash, location.key])

  if (!active) return null
  return (
    <section
      id="autopilot"
      ref={ref}
      className={`${SECTION} scroll-mt-6`}
      aria-labelledby={headingId}
    >
      <div className="flex items-center gap-2">
        <h2 id={headingId} className={HEADING}>
          Posting
        </h2>
        <span className="text-[11px] text-ds-text-3">for @{active.handle}</span>
      </div>
      <div className={BOX}>
        <AutopilotRow key={active.id} account={active} />
      </div>
    </section>
  )
}

function AutopilotRow({ account }: { account: XAccount }): React.JSX.Element {
  const titleId = useId()
  const subId = useId()
  const autopilot = useAutopilot(account.id)
  return (
    <Row
      title="Autopilot"
      titleId={titleId}
      sub={`Posts Claude or a connected agent writes for @${account.handle} are scheduled without asking you.`}
      subId={subId}
      error={autopilot.error}
      control={
        <AutopilotSwitch
          account={account}
          autopilot={autopilot}
          aria-labelledby={titleId}
          aria-describedby={subId}
        />
      }
    />
  )
}

function OpenAtLoginRow(): React.JSX.Element {
  const titleId = useId()
  const subId = useId()
  // A dev build would register the bare Electron binary, so main ignores the change there
  // (src/main/loginItem.ts); say so rather than pretend it worked.
  const devBuild = import.meta.env.DEV
  const [on, setOn] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  // One call at a time: a late failure must not flip back a switch the user has changed again.
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let live = true
    window.opencat.app
      .getOpenAtLogin()
      .then((value) => live && setOn(value))
      .catch((err: unknown) => {
        if (!live) return
        setOn(false)
        setError(`Could not read this setting: ${messageOf(err)}`)
      })
    return () => {
      live = false
    }
  }, [])

  const toggle = (): void => {
    if (on === null || pending) return
    const next = !on
    setOn(next)
    setError(null)
    setPending(true)
    window.opencat.app
      .setOpenAtLogin(next)
      .catch((err: unknown) => {
        setOn(!next)
        setError(`Could not change this: ${messageOf(err)}`)
      })
      .finally(() => setPending(false))
  }

  const checked = on ?? false
  return (
    <Row
      title="Start OpenCatt at login"
      titleId={titleId}
      sub={
        devBuild
          ? 'Only in the installed app'
          : // True since OP-68: a start at login opens only the tray.
            'Keeps scheduled posts going out after your computer restarts. OpenCatt starts in the tray.'
      }
      subId={subId}
      error={error}
      control={
        <Switch
          checked={checked}
          aria-labelledby={titleId}
          aria-describedby={subId}
          disabled={devBuild || on === null || pending}
          onClick={toggle}
        />
      }
    />
  )
}

function WeekStartRow(): React.JSX.Element {
  const id = useId()
  const week = useWeekStart()
  return (
    <Row
      title="Week starts on"
      titleFor={id}
      control={
        <Select
          id={id}
          value={week.setting}
          onChange={(e) => week.choose(e.target.value as WeekStartSetting)}
        >
          <option value="auto">{weekdayName(week.system)} first (system)</option>
          <option value="monday">Monday first</option>
          <option value="sunday">Sunday first</option>
        </Select>
      }
    />
  )
}

function weekdayName(day: number): string {
  // 4 January 1970 was a Sunday.
  return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(1970, 0, 4 + day))
}
