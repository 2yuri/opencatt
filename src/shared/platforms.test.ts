import { describe, expect, it } from 'vitest'
import { PLATFORM_RULES, isPlatform, mediaProblem, rulesFor, textLength } from './platforms'

const { x, tiktok } = PLATFORM_RULES

describe('platform rules', () => {
  it('counts X text the way X does and TikTok captions per UTF-16 unit', () => {
    const link = 'https://example.com/a/very/long/path/that/goes/on'
    expect(textLength(x, link)).toBe(23)
    expect(textLength(x, '日本語')).toBe(6)
    expect(textLength(tiktok, link)).toBe(link.length)
    expect(textLength(tiktok, '日本語')).toBe(3)
  })

  it('keeps X media as it was: up to 4 images, or one GIF, or one video', () => {
    expect(mediaProblem(x, ['image', 'image', 'image', 'image'])).toBeNull()
    expect(mediaProblem(x, ['gif'])).toBeNull()
    expect(mediaProblem(x, ['video'])).toBeNull()
    expect(mediaProblem(x, Array(5).fill('image'))).toBe('X allows up to 4 images per post')
    expect(mediaProblem(x, ['image', 'video'])).toMatch(/only media/)
  })

  it('wants exactly one video on TikTok', () => {
    expect(mediaProblem(tiktok, ['video'])).toBeNull()
    expect(mediaProblem(tiktok, [])).toMatch(/needs a video/)
    expect(mediaProblem(tiktok, ['image'])).toMatch(/can't have images/)
    expect(mediaProblem(tiktok, ['video', 'image'])).toMatch(/can't have images/)
    expect(mediaProblem(tiktok, ['video', 'video'])).toMatch(/only media/)
  })

  it("lets an account's own limits replace the platform's video length", () => {
    expect(rulesFor('tiktok').video.maxSeconds).toBe(600)
    expect(rulesFor('tiktok', { maxVideoSeconds: 180 }).video.maxSeconds).toBe(180)
    expect(rulesFor('tiktok', {})).toBe(tiktok)
    expect(tiktok.video.maxSeconds).toBe(600)
  })

  it('knows its platforms', () => {
    expect(isPlatform('x')).toBe(true)
    expect(isPlatform('tiktok')).toBe(true)
    expect(isPlatform('myspace')).toBe(false)
  })
})
