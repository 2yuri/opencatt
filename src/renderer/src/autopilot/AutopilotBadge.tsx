import { Zap } from 'lucide-react'

/** The amber "Autopilot" pill (OP-104), shown wherever the active account has Autopilot on. */
export function AutopilotBadge({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <span
      className={`inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[9px] bg-ds-amber-2 pr-[7px] pl-[6px] font-sans text-[10.5px] leading-none font-semibold whitespace-nowrap text-ds-amber ${className}`}
      data-testid="autopilot-badge"
    >
      <Zap size={10} strokeWidth={2.5} aria-hidden="true" />
      Autopilot
    </span>
  )
}
