import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import type { WeekStartSetting } from '@shared/api'
import { useWeekStart } from '../calendar/useWeekStart'
import { openAgentSettings } from '../chat/agentSettingsRequest'
import { Switch } from '../ui'
import { BOX, HEADING, LINK, SECTION, messageOf } from './common'
import { Row, Select } from './parts'
import { VoiceSection } from './VoiceSection'

/**
 * App-wide settings (OP-65): starting at login, the week's first day, the active account's voice
 * (OP-75), and ways into the rest.
 */
export function SettingsScreen(): React.JSX.Element {
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
        <VoiceSection />
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
