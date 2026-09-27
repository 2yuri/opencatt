import { describe, expect, it } from 'vitest'
import type { MediaKind, PostMedia } from '@shared/api'
import { makePost } from '../day/testPosts'
import {
  draftFromPost,
  emptyPart,
  mediaProblem,
  movePart,
  partProblem,
  toPayload,
  type DraftPart
} from './draft'

const media = (kind: MediaKind, id: string = kind): PostMedia => ({
  id,
  kind,
  mime: kind === 'video' ? 'video/mp4' : 'image/png',
  bytes: 1,
  width: null,
  height: null,
  durationMs: null,
  alt: null,
  url: `opencat-media://media/${id}`
})

const part = (fields: Partial<DraftPart>): DraftPart => ({ ...emptyPart(), ...fields })

describe('mediaProblem', () => {
  it('accepts up to 4 images, or one GIF, or one video', () => {
    expect(mediaProblem([])).toBeNull()
    expect(mediaProblem(Array.from({ length: 4 }, () => media('image')))).toBeNull()
    expect(mediaProblem([media('gif')])).toBeNull()
    expect(mediaProblem([media('video')])).toBeNull()
  })

  it('refuses a fifth image and any mix with a GIF or video', () => {
    expect(mediaProblem(Array.from({ length: 5 }, () => media('image')))).toContain('up to 4')
    expect(mediaProblem([media('image'), media('video')])).toContain('only media')
    expect(mediaProblem([media('gif'), media('gif')])).toContain('only media')
  })
})

describe('partProblem', () => {
  it('lets a part be media only', () => {
    expect(partProblem(part({ media: [media('image')] }), 0, 1)).toBeNull()
  })

  it('names the part in a thread', () => {
    expect(partProblem(part({}), 2, 3)).toBe('Post 3 of the thread needs text or media.')
    expect(partProblem(part({ text: 'a'.repeat(290) }), 1, 2)).toBe(
      'Post 2 of the thread is 10 over the 280 limit.'
    )
    expect(partProblem(part({ text: 'x', media: [media('gif'), media('image')] }), 0, 2)).toBe(
      'Post 1 of the thread: A GIF or video has to be the only media in its post.'
    )
  })

  it('keeps the single-post wording', () => {
    expect(partProblem(part({}), 0, 1)).toBe('Write something first.')
  })
})

describe('movePart', () => {
  const [a, b, c] = ['a', 'b', 'c'].map((text) => part({ text }))

  it('moves a part up and down within the thread', () => {
    expect(movePart([a, b, c], 2, -1).map((p) => p.text)).toEqual(['a', 'c', 'b'])
    expect(movePart([a, b, c], 0, 1).map((p) => p.text)).toEqual(['b', 'a', 'c'])
    expect(movePart([a, b, c], 0, -1).map((p) => p.text)).toEqual(['a', 'b', 'c'])
    expect(movePart([a, b, c], 2, 1).map((p) => p.text)).toEqual(['a', 'b', 'c'])
  })

  it('never moves anything above or out of the parts already on X', () => {
    const posted = part({ text: 'on X', locked: true })
    expect(movePart([posted, b, c], 1, -1)).toEqual([posted, b, c])
    expect(movePart([posted, b, c], 0, 1)).toEqual([posted, b, c])
  })
})

describe('draftFromPost and toPayload', () => {
  it('round-trips parts with media and alt text, locking parts already on X', () => {
    const image = { ...media('image', 'img1'), alt: 'A cat' }
    const post = makePost({
      id: 'p',
      parts: [
        {
          id: 'p0',
          position: 0,
          text: 'first',
          media: [image],
          remoteId: '9',
          remoteUrl: 'u',
          postedAt: null
        },
        {
          id: 'p1',
          position: 1,
          text: 'second',
          media: [],
          remoteId: null,
          remoteUrl: null,
          postedAt: null
        }
      ]
    })
    const draft = draftFromPost(post)
    expect(draft.map((p) => p.locked)).toEqual([true, false])
    expect(toPayload(draft)).toEqual([
      { text: 'first', media: [{ id: 'img1', alt: 'A cat' }] },
      { text: 'second', media: [] }
    ])
  })

  it('starts a new post with one empty part', () => {
    expect(draftFromPost(null)).toHaveLength(1)
  })

  it('sends blank alt text as null', () => {
    expect(toPayload([part({ media: [{ ...media('image'), alt: '  ' }] })])[0].media).toEqual([
      { id: 'image', alt: null }
    ])
  })
})
