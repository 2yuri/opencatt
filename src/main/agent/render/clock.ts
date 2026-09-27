/**
 * Injected into a video composition before its own scripts (OP-35): Date, performance.now,
 * timers, requestAnimationFrame and CSS/Web Animations only move when OpenCatt steps the clock,
 * one frame at a time, so the video is the same on any machine at any speed.
 * `__ocStep(ms)` resolves once the compositor has drawn that moment.
 */
export const CLOCK_SCRIPT = `(() => {
  let now = 0
  const start = 1767225600000
  const RealDate = Date
  class VirtualDate extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(start + now) }
    static now() { return start + now }
  }
  window.Date = VirtualDate
  performance.now = () => now
  const timers = new Map()
  let nextTimer = 1
  window.setTimeout = (fn, ms = 0, ...args) => {
    const id = nextTimer++
    timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, args })
    return id
  }
  window.setInterval = (fn, ms = 0, ...args) => {
    const id = nextTimer++
    const every = Math.max(1, Number(ms) || 0)
    timers.set(id, { at: now + every, fn, args, every })
    return id
  }
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id)
  const realFrame = window.requestAnimationFrame.bind(window)
  const frames = new Map()
  let nextFrame = 1
  window.requestAnimationFrame = (fn) => { const id = nextFrame++; frames.set(id, fn); return id }
  window.cancelAnimationFrame = (id) => frames.delete(id)
  const call = (fn, args) => { try { if (typeof fn === 'function') fn(...args) } catch (e) {} }
  Object.defineProperty(window, '__ocStep', {
    value: (ms) => {
      now = ms
      // Timers due by now, earliest first, intervals rescheduled; capped so a zero-delay loop ends.
      for (let i = 0; i < 10000; i++) {
        let due = null
        for (const [id, t] of timers) if (t.at <= now && (!due || t.at < due[1].at)) due = [id, t]
        if (!due) break
        const [id, t] = due
        if (t.every) t.at += t.every
        else timers.delete(id)
        call(t.fn, t.args)
      }
      const callbacks = [...frames.values()]
      frames.clear()
      for (const fn of callbacks) call(fn, [now])
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = now }
      return new Promise((resolve) => realFrame(() => realFrame(() => resolve(true))))
    }
  })
})()`
