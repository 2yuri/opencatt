import { Music2 } from 'lucide-react'
import { PLATFORM_RULES, type Platform } from '@shared/platforms'

/**
 * The platform's tile (OP-117 frames): X in black with a white X, TikTok on its pink-to-cyan
 * gradient with a note. Placeholders drawn by us, not the platforms' official logos.
 */
export function PlatformMark({
  platform,
  size,
  ring = false
}: {
  platform: Platform
  size: number
  /** A ring in the surface colour, for a mark sitting on an avatar's corner. */
  ring?: boolean
}): React.JSX.Element {
  const tiktok = platform === 'tiktok'
  return (
    <span
      className={`grid shrink-0 place-items-center font-sans leading-none font-bold text-white box-border ${tiktok ? '' : 'border border-ds-border'}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: tiktok ? 'linear-gradient(135deg, #FE2C55, #25F4EE)' : '#000000',
        fontSize: Math.round(size * 0.6),
        boxShadow: ring ? '0 0 0 1.5px var(--ds-surface)' : undefined
      }}
      role="img"
      aria-label={PLATFORM_RULES[platform].name}
      data-platform={platform}
    >
      {tiktok ? (
        <Music2 size={Math.round(size * 0.62)} strokeWidth={2.5} aria-hidden="true" />
      ) : (
        <span aria-hidden="true">X</span>
      )}
    </span>
  )
}

/** "@acme · X": the handle and the platform's name, as the switcher and Integrations show it. */
export function handleLine(account: { handle: string; platform: Platform }): string {
  return `@${account.handle} · ${PLATFORM_RULES[account.platform].name}`
}
