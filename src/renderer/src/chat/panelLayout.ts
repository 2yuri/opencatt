/** Agent panel sizes (OP-59): 380px by default (Designer's OP-58 frames), 300 to 560px, never squeezing the main card. */
export const PANEL_DEFAULT = 380
export const PANEL_MIN = 300
export const PANEL_MAX = 560
/** The collapsed panel: a slim rail with the agent icon, the waiting count and the open button. */
export const PANEL_RAIL = 56
/** The main card (calendar, day board…) keeps at least this much. */
export const MAIN_MIN = 540
/** How far one arrow-key press moves the handle. */
export const PANEL_STEP = 16

/**
 * The widest the panel may be, given `room`: the width the main card and the panel share now
 * (both measured, so the sidebar's width never has to be known here).
 */
export function maxPanelWidth(room: number): number {
  return Math.min(PANEL_MAX, room - MAIN_MIN)
}

/** Whether the panel can be open at all without taking the main card under MAIN_MIN. */
export function panelFits(room: number): boolean {
  return maxPanelWidth(room) >= PANEL_MIN
}

/** The width to draw: the one the user chose, clamped to the limits and to the room there is. */
export function panelWidth(preferred: number, room: number): number {
  const max = Math.max(PANEL_MIN, maxPanelWidth(room))
  return Math.round(Math.min(max, Math.max(PANEL_MIN, preferred)))
}
