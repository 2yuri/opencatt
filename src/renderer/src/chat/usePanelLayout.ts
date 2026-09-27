import { useCallback, useEffect, useState, type RefObject } from 'react'
import { PANEL_DEFAULT, PANEL_MIN, maxPanelWidth, panelFits, panelWidth } from './panelLayout'

const OPEN_KEY = 'chatPanel.open'
const WIDTH_KEY = 'chatPanel.width'

export interface PanelLayout {
  /** Drawn open (the user wants it open, and it fits or they opened it anyway). */
  open: boolean
  /** Drawn width, px. */
  width: number
  /** The widest it may be right now. */
  max: number
  /** Collapsed only because the window is too narrow; it reopens when there's room. */
  squeezed: boolean
  setOpen: (open: boolean) => void
  /** While dragging: redraw only. */
  preview: (width: number) => void
  /** On release, key press or reset: redraw and save. */
  commit: (width: number) => void
}

/**
 * Width and open state of the agent panel: saved in settings, restored on launch, and kept
 * clear of the main card as the window changes. `measureRoom` gives the width the main card and
 * the panel share; in tests (no layout) it returns Infinity.
 */
export function usePanelLayout(
  panel: RefObject<HTMLElement | null>,
  measureRoom: () => number = () => roomAround(panel.current)
): PanelLayout {
  const [wantOpen, setWantOpen] = useState(true)
  const [preferred, setPreferred] = useState(PANEL_DEFAULT)
  const [dragging, setDragging] = useState<number | null>(null)
  const [room, setRoom] = useState(Number.POSITIVE_INFINITY)
  // Opened from the rail although it doesn't fit: honour it until the window has room again.
  const [forced, setForced] = useState(false)

  useEffect(() => {
    const { settings } = window.opencat
    let live = true
    void Promise.all([settings.get(OPEN_KEY), settings.get(WIDTH_KEY)]).then(([o, w]) => {
      if (!live) return
      if (typeof o === 'boolean') setWantOpen(o)
      if (typeof w === 'number') setPreferred(w)
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const update = (): void => {
      const measured = measureRoom()
      setRoom(measured)
      // Room again: the next squeeze should collapse it again.
      if (panelFits(measured)) setForced(false)
    }
    update()
    window.addEventListener('resize', update)
    // The shell can change size without a window resize, e.g. when the sidebar turns into its
    // icon rail (OP-58), so watch it too. jsdom has no ResizeObserver.
    const shell = panel.current?.parentElement
    const observer =
      shell && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    if (shell) observer?.observe(shell)
    return () => {
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [measureRoom, panel])

  const fits = panelFits(room)

  const open = wantOpen && (fits || forced)
  const max = Math.max(PANEL_MIN, maxPanelWidth(room))
  const width = panelWidth(dragging ?? preferred, room)

  const setOpen = useCallback(
    (next: boolean) => {
      setWantOpen(next)
      setForced(next && !fits)
      void window.opencat.settings.set(OPEN_KEY, next)
    },
    [fits]
  )

  const commit = useCallback(
    (w: number) => {
      const clamped = panelWidth(w, room)
      setDragging(null)
      setPreferred(clamped)
      void window.opencat.settings.set(WIDTH_KEY, clamped)
    },
    [room]
  )

  return {
    open,
    width,
    max,
    squeezed: wantOpen && !open,
    setOpen,
    preview: setDragging,
    commit
  }
}

/** The width the main card and the panel share: both boxes, measured. */
function roomAround(panel: HTMLElement | null): number {
  const main = panel?.previousElementSibling
  if (!panel || !main) return Number.POSITIVE_INFINITY
  const room = main.getBoundingClientRect().width + panel.getBoundingClientRect().width
  return room > 0 ? room : Number.POSITIVE_INFINITY
}
