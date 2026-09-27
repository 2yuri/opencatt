import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { portalSteps, type CopyValue } from '../steps'
import { box, linkButton, spacer } from '../helpers'
import { BackButton, NextButton, StepPage } from '../shared'

function CopyRow({ item }: { item: CopyValue }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className="box-border flex h-[34px] items-center gap-[10px] rounded-[8px] border border-ds-border bg-ds-inset px-[12px] text-[12px]">
      <span className="shrink-0 text-ds-text-3">{item.label}</span>
      <code className="min-w-0 flex-1 truncate font-mono">{item.value}</code>
      <button
        type="button"
        className={`${linkButton} flex shrink-0 items-center gap-[6px] text-[12px] font-semibold`}
        onClick={() => {
          void navigator.clipboard.writeText(item.value).then(() => setCopied(true))
        }}
      >
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export function Portal({
  ticked,
  onTick,
  onBack,
  onNext
}: {
  ticked: Record<string, boolean>
  onTick: (ticked: Record<string, boolean>) => void
  onBack: () => void
  onNext: () => void
}): React.JSX.Element {
  const doneCount = portalSteps.filter((s) => ticked[s.id]).length
  // The first step not ticked yet is the one to do now: it is highlighted and shows its detail.
  const current = portalSteps.find((s) => !ticked[s.id])?.id

  return (
    <StepPage
      step="portal"
      title="Create your X app"
      lead="X has no button for this, so here is exactly what to click. Links open in your browser; tick each step as you go."
      actions={
        <>
          <BackButton onClick={onBack} />
          {spacer}
          <span className="text-[12px] text-ds-text-3">
            {doneCount} of {portalSteps.length} done
          </span>
          <NextButton onClick={onNext} />
        </>
      }
    >
      <ol className={`${box} m-0 flex list-none flex-col overflow-hidden p-0`}>
        {portalSteps.map((s) => {
          const done = ticked[s.id] ?? false
          const here = s.id === current
          return (
            <li
              key={s.id}
              className={`flex flex-col gap-[8px] border-b border-ds-border px-[16px] py-[12px] last:border-b-0 ${here ? 'bg-ds-accent-2' : ''}`}
            >
              <div className="flex items-center gap-[12px]">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-[12px]">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={done}
                    onChange={(e) => onTick({ ...ticked, [s.id]: e.target.checked })}
                  />
                  <span
                    aria-hidden="true"
                    className="box-border grid size-[18px] shrink-0 place-items-center rounded-[5px] border-[1.5px] border-ds-border-strong text-ds-bg peer-checked:border-0 peer-checked:bg-ds-green peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ds-accent"
                  >
                    {done && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span
                    className={`text-[13px] ${done ? 'font-medium text-ds-text-3' : here ? 'font-semibold' : 'font-medium'}`}
                  >
                    {s.title}
                  </span>
                </label>
                {s.link && (
                  <a
                    href={s.link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-[12px] text-ds-accent-text no-underline"
                  >
                    {s.link.label} ↗
                  </a>
                )}
              </div>
              {here && <p className="m-0 text-[12px] leading-[19px] text-ds-text-2">{s.detail}</p>}
              {s.copy?.map((item) => (
                <CopyRow key={item.label} item={item} />
              ))}
            </li>
          )
        })}
      </ol>
    </StepPage>
  )
}
