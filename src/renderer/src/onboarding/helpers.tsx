/** A line of the "You're set" summary; ok false when it is left for later. */
export interface SummaryLine {
  text: string
  ok: boolean
}

/** Main-process errors arrive as "Error invoking remote method 'x': OnboardingError: message". */
export function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error invoking remote method '[^']+': (\w+Error: )?/, '')
}

export const spacer = <span className="flex-1" />

export const box = 'box-border rounded-[12px] border border-ds-border bg-ds-raised'
export const linkButton =
  'cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-ds-accent-text disabled:cursor-default'
