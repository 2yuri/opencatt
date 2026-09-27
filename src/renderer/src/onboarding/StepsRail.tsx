import { ArrowLeft, Check, Cat, ShieldCheck } from 'lucide-react'
import { wizardSteps } from './steps'
import { Button } from '../ui'

/** The left column: room for the traffic lights, the brand, the seven steps and the privacy line. */
export function StepsRail({
  current,
  onClose
}: {
  current: number
  onClose?: () => void
}): React.JSX.Element {
  return (
    <aside className="box-border flex w-[300px] shrink-0 flex-col gap-[4px] px-[20px] pt-[14px] pb-[24px] [-webkit-app-region:drag] in-data-[platform=mac]:pt-[62px] *:[-webkit-app-region:no-drag]">
      <div className="flex items-center gap-[10px] px-[8px] pb-[28px]">
        <span
          aria-hidden="true"
          className="grid size-[30px] shrink-0 place-items-center rounded-[8px] bg-[linear-gradient(-135deg,#8b7cff_14.645%,#5b45f0_85.355%)] text-white"
        >
          <Cat size={17} />
        </span>
        <span className="flex flex-col">
          <span className="text-[15px] font-semibold tracking-[-0.2px]">OpenCatt</span>
          <span className="text-[12px] text-ds-text-3">First-time setup</span>
        </span>
      </div>

      <ol className="m-0 flex list-none flex-col gap-[4px] p-0" aria-label="Setup steps">
        {wizardSteps.map((s, i) => {
          const done = i < current
          const here = i === current
          return (
            <li
              key={s.id}
              aria-current={here ? 'step' : undefined}
              className={`flex h-[36px] items-center gap-[12px] rounded-[8px] px-[10px] ${here ? 'bg-ds-raised' : ''}`}
            >
              <span
                aria-hidden="true"
                className={`box-border grid size-[20px] shrink-0 place-items-center rounded-full text-[10px] font-semibold ${
                  done
                    ? 'bg-ds-green-2 text-ds-green'
                    : here
                      ? 'bg-ds-accent text-white'
                      : 'border border-ds-border-strong text-ds-text-3'
                }`}
              >
                {done ? <Check size={11} strokeWidth={2.5} /> : i + 1}
              </span>
              <span
                className={`text-[13px] font-medium ${done || here ? 'text-ds-text' : 'text-ds-text-3'}`}
              >
                {s.label}
              </span>
            </li>
          )
        })}
      </ol>

      <span className="flex-1" />

      {onClose && (
        <Button type="button" variant="ghost" className="mb-3 justify-start" onClick={onClose}>
          <ArrowLeft size={14} aria-hidden="true" />
          Back to the app
        </Button>
      )}

      <p className="m-0 flex gap-[8px] px-[8px] text-[12px] leading-[19px] text-ds-text-3">
        <ShieldCheck size={14} className="mt-[2px] shrink-0" aria-hidden="true" />
        Your keys and posts stay on this computer. OpenCatt has no server.
      </p>
    </aside>
  )
}
