import { describe, expect, it } from 'vitest'
import { postUrl, splitColumns } from './columns'
import { makePost } from './testPosts'

describe('splitColumns', () => {
  it('keeps scheduled, posting and failed in Scheduled, by time', () => {
    const { scheduled, posted } = splitColumns([
      makePost({ id: 'c', scheduledAt: '2026-09-28T15:00:00.000Z', status: 'failed' }),
      makePost({ id: 'a', scheduledAt: '2026-09-28T07:00:00.000Z' }),
      makePost({ id: 'b', scheduledAt: '2026-09-28T09:00:00.000Z', status: 'posting' })
    ])
    expect(scheduled.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(posted).toEqual([])
  })

  it('orders Posted by when it went out', () => {
    const { posted } = splitColumns([
      makePost({
        id: 'late',
        status: 'posted',
        scheduledAt: '2026-09-28T07:00:00.000Z',
        postedAt: '2026-09-28T07:50:00.000Z'
      }),
      makePost({
        id: 'early',
        status: 'posted',
        scheduledAt: '2026-09-28T07:30:00.000Z',
        postedAt: '2026-09-28T07:30:05.000Z'
      })
    ])
    expect(posted.map((p) => p.id)).toEqual(['early', 'late'])
  })
})

describe('postUrl', () => {
  it('prefers the URL X returned, then builds one from the id', () => {
    expect(postUrl(makePost({ id: 'a', remoteUrl: 'https://x.com/me/status/1' }))).toBe(
      'https://x.com/me/status/1'
    )
    expect(postUrl(makePost({ id: 'a', remoteId: '42' }))).toBe('https://x.com/i/status/42')
    expect(postUrl(makePost({ id: 'a' }))).toBeNull()
  })
})
