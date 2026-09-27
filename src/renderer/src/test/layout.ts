import { vi } from 'vitest'

type Size = { width: number; height: number }

/**
 * Gives elements a size in jsdom, which has no layout: `sizeOf` answers for each element
 * (undefined for "unknown", as jsdom's 0×0). Undo with vi.restoreAllMocks().
 */
export function stubSizes(sizeOf: (el: HTMLElement) => Partial<Size> | undefined): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const { width = 0, height = 0 } = sizeOf(this) ?? {}
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({})
    }
  })
}

/**
 * A window.matchMedia that answers max-width queries for a window `width` px wide. Undo with
 * vi.unstubAllGlobals().
 */
export function stubWindowWidth(width: number): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      const max = /max-width:\s*(\d+)px/.exec(query)
      return {
        matches: max ? width <= Number(max[1]) : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }
    })
  )
}
