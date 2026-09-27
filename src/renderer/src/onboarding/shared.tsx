import { ArrowRight, CircleAlert } from 'lucide-react'
import { wizardSteps, type WizardStep } from './steps'
import { Button } from '../ui'

/** One step in the card: the count, heading and lead, the content, and the action bar. */
export function StepPage({
  step,
  title,
  lead,
  children,
  actions,
  onSubmit
}: {
  step: WizardStep
  title: string
  lead: React.ReactNode
  children?: React.ReactNode
  actions: React.ReactNode
  onSubmit?: () => void
}): React.JSX.Element {
  const n = wizardSteps.findIndex((s) => s.id === step) + 1
  return (
    <form
      className="flex w-full max-w-[620px] flex-[1_0_auto] flex-col gap-[20px]"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit?.()
      }}
    >
      <p className="m-0 text-[11px] font-semibold tracking-[1px] text-ds-accent-text uppercase">
        Step {n} of {wizardSteps.length}
      </p>
      <h1 className="m-0 text-[30px] leading-[35px] font-semibold tracking-[-0.8px]">{title}</h1>
      <p className="m-0 text-[15px] leading-[23px] text-ds-text-2">{lead}</p>
      {children}
      <div className="mt-auto flex items-center gap-[10px] border-t border-ds-border pt-[20px]">
        {actions}
      </div>
    </form>
  )
}

export function BackButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <Button type="button" variant="secondary" onClick={onClick}>
      Back
    </Button>
  )
}

export function NextButton({
  label = 'Next',
  submit = false,
  disabled = false,
  onClick
}: {
  label?: string
  submit?: boolean
  disabled?: boolean
  onClick?: () => void
}): React.JSX.Element {
  return (
    <Button
      type={submit ? 'submit' : 'button'}
      variant="primary"
      disabled={disabled}
      onClick={onClick}
    >
      <ArrowRight size={14} aria-hidden="true" />
      {label}
    </Button>
  )
}

export function ErrorBox({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p
      className="m-0 flex gap-[10px] rounded-[10px] bg-ds-red-2 px-[12px] py-[10px] text-[12px] leading-[19px] text-ds-red"
      role="alert"
    >
      <CircleAlert size={15} className="mt-[2px] shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}
