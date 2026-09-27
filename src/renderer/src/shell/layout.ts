import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

/** The sidebar (OP-58): 232px with labels, or a 64px icon rail on a narrow window. */
export const SIDEBAR_WIDTH = 232
export const SIDEBAR_RAIL_WIDTH = 64
/** Below this window width the sidebar turns into its icon rail. */
export const SIDEBAR_RAIL_BELOW = 1100

/**
 * Main-card widths where the screen toolbars tighten up (OP-58). Under COMPACT the pending badge
 * shows only its count, New post becomes an icon and Approvals drops its hint line; under
 * TIGHT the calendar also hides its week-start picker.
 */
export const TOOLBAR_COMPACT_BELOW = 820
export const TOOLBAR_TIGHT_BELOW = 680

const RAIL_QUERY = `(max-width: ${SIDEBAR_RAIL_BELOW - 1}px)`

/** Whether the window is narrow enough for the sidebar's icon rail. */
export function useSidebarRail(): boolean {
  const [rail, setRail] = useState(() => matches(RAIL_QUERY))
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(RAIL_QUERY)
    const update = (): void => setRail(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return rail
}

function matches(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

/**
 * The rendered width of an element, kept up to date as it resizes. Infinity until it is known
 * (and always in jsdom, which has no layout), so screens default to their roomy layout.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  return useElementSize(ref).width
}

/** The rendered size of an element; Infinity for what is not known yet. */
export function useElementSize(ref: RefObject<HTMLElement | null>): {
  width: number
  height: number
} {
  const [size, setSize] = useState({
    width: Number.POSITIVE_INFINITY,
    height: Number.POSITIVE_INFINITY
  })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const set = (width: number, height: number): void => {
      const next = { width: known(width), height: known(height) }
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next))
    }
    const rect = el.getBoundingClientRect()
    set(rect.width, rect.height)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize?.[0]
      if (box) set(box.inlineSize, box.blockSize)
      else {
        const r = el.getBoundingClientRect()
        set(r.width, r.height)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

const known = (n: number): number => (n > 0 ? n : Number.POSITIVE_INFINITY)
