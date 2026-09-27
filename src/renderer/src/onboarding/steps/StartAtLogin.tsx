import { useId, useState } from 'react'
import { Calendar, Check, Minus } from 'lucide-react'
import type { OnboardingStatus } from '@shared/api'
import { box, messageOf, spacer, type SummaryLine } from '../helpers'
import { BackButton, ErrorBox, StepPage } from '../shared'
import { Button } from '../../ui'

export function StartAtLogin({
  summary,
  onBack,
  onDone
}: {
  summary: SummaryLine[]
  onBack: () => void
  onDone: (status: OnboardingStatus) => void
}): React.JSX.Element {
  const [openAtLogin, setOpenAtLogin] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const labelId = useId()

  const finish = async (): Promise<void> => {
    try {
      await window.opencat.app.setOpenAtLogin(openAtLogin)
      onDone(await window.opencat.onboarding.complete())
    } catch (err) {
      setError(messageOf(err))
    }
  }

  return (
    <StepPage
      step="login"
      title="Keep your posts on time"
      lead="OpenCatt can only post while it's running. Start it when you log in and it stays in the menu bar, so scheduled posts go out even if you forget to open it."
      actions={
        <>
          <BackButton onClick={onBack} />
          {spacer}
          <Button type="button" variant="primary" onClick={() => void finish()}>
            <Calendar size={14} aria-hidden="true" />
            Open my calendar
          </Button>
        </>
      }
    >
      <div className={`${box} flex items-center gap-[14px] p-[16px]`}>
        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <strong id={labelId} className="text-[14px] font-semibold">
            Start OpenCatt when I log in
          </strong>
          <span className="text-[13px] text-ds-text-2">You can change this later in Settings.</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={openAtLogin}
          aria-labelledby={labelId}
          onClick={() => setOpenAtLogin(!openAtLogin)}
          className={`relative h-[22px] w-[40px] shrink-0 cursor-pointer rounded-[11px] border-0 p-0 transition-colors ${
            openAtLogin ? 'bg-ds-accent' : 'bg-ds-border-strong'
          }`}
        >
          <span
            className={`absolute top-[2px] size-[18px] rounded-full bg-white transition-[left] ${
              openAtLogin ? 'left-[20px]' : 'left-[2px]'
            }`}
          />
        </button>
      </div>
      <div className={`${box} flex flex-col gap-[10px] p-[16px]`}>
        <strong className="text-[13px] font-semibold">You&apos;re set</strong>
        <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
          {summary.map((line) => (
            <li key={line.text} className="flex items-center gap-[10px] text-[13px]">
              <span
                aria-hidden="true"
                className={`grid size-[18px] shrink-0 place-items-center rounded-full ${
                  line.ok ? 'bg-ds-green-2 text-ds-green' : 'bg-ds-inset text-ds-text-3'
                }`}
              >
                {line.ok ? <Check size={11} strokeWidth={2.5} /> : <Minus size={11} />}
              </span>
              {line.text}
            </li>
          ))}
        </ul>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
    </StepPage>
  )
}
