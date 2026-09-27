// Shared by the Settings sections: error text from main, and the page's classes.

/** Main-process errors arrive as "Error invoking remote method 'x': SomeError: message". */
export const messageOf = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(
    /^Error invoking remote method '[^']+': (\w*Error: )?/,
    ''
  )

export const LINK =
  'cursor-pointer border-0 bg-transparent p-0 text-[13px] font-medium whitespace-nowrap text-ds-accent-text no-underline hover:underline'

/** A section: the uppercase heading over one box of rows. */
export const SECTION = 'flex w-full max-w-[560px] flex-col gap-2.5'
export const HEADING = 'm-0 text-[11px] font-semibold tracking-[0.8px] text-ds-text-3 uppercase'
export const BOX =
  'flex flex-col divide-y divide-ds-border rounded-xl border border-ds-border bg-ds-raised'
export const ROW_TITLE = 'text-[13px] font-medium text-ds-text'
export const ROW_SUB = 'text-[12px] leading-[1.45] text-ds-text-3'
