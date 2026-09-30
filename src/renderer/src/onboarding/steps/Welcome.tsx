import { CalendarDays, Info, KeyRound, Sparkles } from 'lucide-react'
import { XLinks } from '@shared/x'
import { box, spacer } from '../helpers'
import { NextButton, StepPage } from '../shared'

const features = [
  {
    icon: CalendarDays,
    title: 'A calendar of your posts',
    detail: "Every day shows what's scheduled and what went out."
  },
  {
    icon: Sparkles,
    title: 'An agent that drafts',
    detail: 'On your Claude plan or an API key. You approve every post.'
  },
  {
    icon: KeyRound,
    title: 'Your own X app',
    detail: 'Posts go straight from this computer to X. About five minutes to set up.'
  }
]

export function Welcome({ onNext }: { onNext: () => void }): React.JSX.Element {
  return (
    <StepPage
      step="welcome"
      title="Schedule your X posts, with an agent that asks first"
      lead="OpenCatt puts your posts on a calendar and publishes them on time. A chat agent can draft them for you, and nothing it writes goes out until you approve it."
      actions={
        <>
          {spacer}
          <NextButton label="Get started" onClick={onNext} />
        </>
      }
    >
      <ul className={`${box} m-0 flex list-none flex-col gap-[16px] p-[20px]`}>
        {features.map(({ icon: Icon, title, detail }) => (
          <li key={title} className="flex gap-[14px]">
            <span
              aria-hidden="true"
              className="grid size-[34px] shrink-0 place-items-center rounded-[9px] bg-ds-accent-2 text-ds-accent-text"
            >
              <Icon size={17} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <strong className="text-[14px] font-semibold">{title}</strong>
              <span className="text-[13px] leading-[20px] text-ds-text-2">{detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p
        className="m-0 flex items-start gap-[8px] text-[12px] leading-[18px] text-ds-text-3"
        data-testid="cost-note"
      >
        {/* Beside the first line, however far the sentence wraps (OP-108). */}
        <Info size={14} className="mt-[2px] shrink-0" aria-hidden="true" />
        <span>
          Posting needs a paid plan on X&apos;s API, Pay Per Use or higher; the free plan can&apos;t
          post. A post with a link costs much more than one without.{' '}
          <a
            href={XLinks.pricing}
            target="_blank"
            rel="noreferrer"
            className="whitespace-nowrap text-ds-accent-text no-underline"
          >
            X&apos;s pricing ↗
          </a>
        </span>
      </p>
    </StepPage>
  )
}
