import { describe, expect, it } from 'vitest'
import { postRoute } from './postRoute'

describe('postRoute', () => {
  const at = '2026-09-28T09:00:00'

  it('sends waiting and rejected posts to that post on the Approvals page, the rest to their day', () => {
    expect(postRoute({ id: 'p1', status: 'pending_approval', scheduledAt: at })).toBe(
      '/approvals?post=p1'
    )
    expect(postRoute({ id: 'p1', status: 'rejected', scheduledAt: at })).toBe(
      '/approvals?tab=rejected&post=p1'
    )
    for (const status of ['scheduled', 'posting', 'posted', 'failed'] as const) {
      expect(postRoute({ id: 'p1', status, scheduledAt: at })).toBe('/day/2026-09-28')
    }
  })

  it('encodes the id', () => {
    expect(postRoute({ id: 'a&b', status: 'pending_approval', scheduledAt: at })).toBe(
      '/approvals?post=a%26b'
    )
  })
})
