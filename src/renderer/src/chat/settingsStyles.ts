/**
 * Tailwind classes for the agent settings (OP-53), replacing the hand-written .agent-settings,
 * .agent-option, .cli-status, .mcp-settings and .chat-tool/.chat-error rules one for one. They
 * still use the older colour variables (--line, --muted, --canvas, --accent, --posted, --warn,
 * --failed) so nothing changes on screen; the move to ds-* colours is the settings redesign's.
 */
// Explicit px throughout, including text sizes, so the look doesn't depend on the root font size
// (13px until OP-57, 16px after). The values are what the old rem sizes rendered at on 13px.
export const S = {
  panel: 'flex flex-1 flex-col gap-[8px] overflow-y-auto p-[12px]',
  heading: 'mx-0 mt-[8px] mb-0 text-[12.35px]',
  row: 'flex flex-wrap items-center gap-[8px] text-[11.7px]',
  note: 'm-0 text-[11.7px] opacity-70',
  error:
    'flex items-center justify-between gap-[8px] rounded-[8px] border border-(--failed) px-[10px] py-[8px] text-[11.7px]',
  small: 'text-[10.4px] leading-[1.4] text-(--muted)',
  link: 'text-(--accent)',
  options: 'flex flex-col gap-[10px]',
  option: 'flex flex-col gap-[8px] rounded-[8px] border bg-(--canvas) p-[12px]',
  optionIdle: 'border-(--line)',
  optionSelected: 'border-(--accent) shadow-[0_0_0_0.5px_var(--accent)]',
  optionHead: 'flex cursor-pointer items-start gap-[10px]',
  optionRadio: 'mx-0 mt-[2px] mb-0 accent-(--accent)',
  optionText: 'flex flex-col gap-[2px]',
  optionBody: 'pl-[26px]',
  keyInput: 'min-w-0 flex-1 px-[8px] py-[6px] [font:inherit]',
  select: 'px-[6px] py-[4px] [font:inherit]',
  cliStatus:
    'flex flex-col gap-[6px] rounded-[6px] bg-[color-mix(in_srgb,var(--ds-text)_4%,var(--canvas))] px-[10px] py-[8px] text-[11.7px]',
  cliLine: 'm-0 flex items-start gap-[8px] leading-[1.4] font-medium',
  cliIcon:
    'mt-[1px] inline-grid size-[16px] shrink-0 place-items-center rounded-full border-[1.5px] text-[8.45px] font-bold',
  cliIconState: {
    missing: 'border-(--muted) text-(--muted)',
    login: 'border-(--warn) text-(--warn)',
    ready: 'border-(--posted) text-(--posted)'
  },
  cliPath:
    "font-[ui-monospace,'SF_Mono',Menlo,monospace] text-[9.36px] leading-[1.4] text-(--muted) [overflow-wrap:anywhere]",
  cliInstall: 'flex-1 font-medium no-underline text-(--accent)',
  cliCommand:
    'flex items-center justify-between rounded-[4px] border border-(--line) bg-(--canvas) px-[8px] py-[6px]',
  actions: 'mt-[8px]'
} as const
