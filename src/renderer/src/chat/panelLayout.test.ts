import { describe, expect, it } from 'vitest'
import { maxPanelWidth, panelFits, panelWidth } from './panelLayout'

describe('agent panel layout', () => {
  it('keeps the chosen width inside 300 to 560', () => {
    const lots = 5000
    expect(panelWidth(360, lots)).toBe(360)
    expect(panelWidth(100, lots)).toBe(300)
    expect(panelWidth(900, lots)).toBe(560)
  })

  it('never takes the main card under 540px, shrinking the panel first', () => {
    // A 960px window: 960 minus the 232px sidebar and 10px margins leaves about 708 to share.
    expect(maxPanelWidth(1000)).toBe(460)
    expect(panelWidth(560, 1000)).toBe(460)
    expect(panelFits(1000)).toBe(true)
  })

  it("collapses only once even the 300px minimum doesn't fit", () => {
    expect(panelFits(840)).toBe(true)
    expect(panelFits(839)).toBe(false)
  })
})
