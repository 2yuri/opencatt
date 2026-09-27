import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PostMedia } from '@shared/api'
import { MediaViewerContext, type MediaViewerApi } from '../media/viewerContext'
import { fakeApi, post } from '../test/fakeApi'
import { PostCard } from './PostCard'

afterEach(() => {
  cleanup()
})

const NOW = new Date('2026-09-27T10:00:00Z')
const now = (): Date => NOW

function show(fields: Parameters<typeof post>[0]) {
  const fake = fakeApi([])
  fake.posts.set(fields.id, post(fields))
  window.opencat = fake.api
  const onOpen = vi.fn()
  render(<PostCard postId={fields.id} action="created" onOpen={onOpen} now={now} />)
  return { fake, onOpen }
}

const card = () => screen.findByRole('article')

describe('chat PostCard', () => {
  it('approves a post that is waiting, and then shows it as scheduled', async () => {
    const { fake } = show({
      id: 'p1',
      text: 'Launch!',
      scheduledAt: '2026-09-28T08:00:00Z',
      status: 'pending_approval'
    })
    const c = await card()
    expect(c.textContent).toContain('Waiting for your approval')

    fireEvent.click(within(c).getByRole('button', { name: 'Approve' }))
    expect(fake.api.posts.approve).toHaveBeenCalledWith('p1', undefined)
    await waitFor(() => expect(c.textContent).toContain('Scheduled'))
    expect(within(c).queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('asks for a new time when the time has passed, and approves at it', async () => {
    const { fake } = show({
      id: 'p2',
      text: 'Late',
      scheduledAt: '2026-09-27T07:00:00Z',
      status: 'pending_approval'
    })
    const c = await card()
    expect(c.textContent).toContain('Time passed: reschedule to approve')
    expect(within(c).queryByRole('button', { name: 'Approve' })).toBeNull()

    fireEvent.click(within(c).getByRole('button', { name: 'Reschedule' }))
    const input = within(c).getByLabelText('New time') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2026-09-27T18:30' } })
    fireEvent.click(within(c).getByRole('button', { name: 'Approve at this time' }))
    expect(fake.api.posts.approve).toHaveBeenCalledWith(
      'p2',
      new Date('2026-09-27T18:30').toISOString()
    )
    await waitFor(() => expect(c.textContent).toContain('Scheduled'))
  })

  it('shows the error when approving is refused', async () => {
    const { fake } = show({
      id: 'p3',
      text: 'x',
      scheduledAt: '2026-09-28T08:00:00Z',
      status: 'pending_approval'
    })
    vi.mocked(fake.api.posts.approve).mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'posts:approve': PostRuleError: This post was due more than an hour ago. Pick a new time, then approve it."
      )
    )
    const c = await card()
    fireEvent.click(within(c).getByRole('button', { name: 'Approve' }))
    expect((await within(c).findByRole('alert')).textContent).toBe(
      'This post was due more than an hour ago. Pick a new time, then approve it.'
    )
  })

  it('shows a thread and its first image with a count of the rest', async () => {
    const image = (id: string): PostMedia => ({
      id,
      kind: 'image',
      mime: 'image/png',
      bytes: 1,
      width: 10,
      height: 10,
      durationMs: null,
      alt: null,
      url: `opencat-media://media/${id}.png`
    })
    const base = post({
      id: 'p4',
      text: 'One',
      scheduledAt: '2026-09-28T08:00:00Z',
      status: 'pending_approval'
    })
    const parts = [0, 1, 2].map((i) => ({
      ...base.parts[0]!,
      id: `part${i}`,
      position: i,
      text: `Part ${i}`,
      media: i < 2 ? [image(`m${i}`)] : []
    }))
    show({ ...base, parts })
    const c = await card()
    expect(c.textContent).toContain('Thread of 3 · 2 images')
    expect(c.querySelector('img')?.getAttribute('src')).toBe('opencat-media://media/m0.png')
    expect(c.textContent).toContain('+1')
  })

  it('shows a video post with its first frame and a film badge', async () => {
    const base = post({
      id: 'p6',
      text: 'Teaser',
      scheduledAt: '2026-09-28T08:00:00Z',
      status: 'pending_approval'
    })
    const clip: PostMedia = {
      id: 'v1',
      kind: 'video',
      mime: 'video/mp4',
      bytes: 1,
      width: 1280,
      height: 720,
      durationMs: 6000,
      alt: null,
      url: 'opencat-media://media/v1.mp4'
    }
    show({ ...base, parts: [{ ...base.parts[0]!, media: [clip] }] })
    const c = await card()
    const video = c.querySelector('video')
    expect(video?.getAttribute('src')).toBe('opencat-media://media/v1.mp4#t=0.1')
    expect(video?.getAttribute('preload')).toBe('metadata')
    expect(c.querySelector('img')).toBeNull()
    expect(c.textContent).toContain('1 video')
  })

  it('opens the day', async () => {
    const { onOpen } = show({ id: 'p5', text: 'x', scheduledAt: '2026-09-28T08:00:00Z' })
    fireEvent.click(within(await card()).getByRole('button', { name: 'Open day' }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'p5' }))
  })
})

describe('chat PostCard media viewer (OP-88)', () => {
  it('opens the viewer on every file of the thread from the thumbnail', async () => {
    const base = post({
      id: 'p7',
      text: 'Thread',
      scheduledAt: '2026-09-28T08:00:00Z',
      status: 'pending_approval'
    })
    const file = (id: string, kind: PostMedia['kind'] = 'image'): PostMedia => ({
      id,
      kind,
      mime: kind === 'video' ? 'video/mp4' : 'image/png',
      bytes: 2048,
      width: 1280,
      height: 720,
      durationMs: kind === 'video' ? 15_000 : null,
      alt: null,
      url: `opencat-media://media/${id}`
    })
    const parts = [0, 1].map((i) => ({
      ...base.parts[0]!,
      id: `part${i}`,
      position: i,
      media: i === 0 ? [file('v1', 'video')] : [file('i1'), file('i2')]
    }))
    const fake = fakeApi([])
    fake.posts.set('p7', { ...base, parts })
    window.opencat = fake.api
    const viewer: MediaViewerApi = { open: vi.fn(), close: vi.fn() }
    render(
      <MediaViewerContext.Provider value={viewer}>
        <PostCard postId="p7" action="created" now={now} />
      </MediaViewerContext.Provider>
    )
    const c = await card()
    const thumb = within(c).getByRole('button', { name: 'View video' })
    expect(thumb.className).toContain('cursor-zoom-in')
    fireEvent.click(thumb)
    expect(viewer.open).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          url: 'opencat-media://media/v1',
          kind: 'video',
          partLabel: 'Part 1',
          durationSec: 15
        }),
        expect.objectContaining({
          url: 'opencat-media://media/i1',
          partLabel: 'Part 2',
          width: 1280
        }),
        expect.objectContaining({ url: 'opencat-media://media/i2', partLabel: 'Part 2' })
      ],
      0
    )
  })
})
