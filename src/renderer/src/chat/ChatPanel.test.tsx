import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PostMedia } from '@shared/api'
import { chatMessage, fakeApi, media, post, type FakeApi } from '../test/fakeApi'
import { openAgentSettings } from './agentSettingsRequest'
import { ChatPanel } from './ChatPanel'

afterEach(() => {
  cleanup()
})

function setup(history = [chatMessage('user', 'Hi'), chatMessage('assistant', 'Hello!')]) {
  const fake = fakeApi(history)
  window.opencat = fake.api
  return fake
}

const input = (): HTMLTextAreaElement => screen.getByLabelText('Message the agent')

describe('ChatPanel', () => {
  it('opens the voice settings from the header, before the agent settings (OP-75)', async () => {
    setup()
    const onOpenVoice = vi.fn()
    render(<ChatPanel onOpenVoice={onOpenVoice} />)
    const voice = await screen.findByRole('button', { name: 'Voice settings' })
    expect(voice.nextElementSibling).toBe(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(voice)
    expect(onOpenVoice).toHaveBeenCalledTimes(1)
  })

  it('loads the saved conversation', async () => {
    setup()
    render(<ChatPanel />)
    expect(await screen.findByText('Hello!')).toBeTruthy()
    expect(screen.getByText('Hi')).toBeTruthy()
  })

  it('sends on Enter, keeps Shift+Enter as a new line, and streams the reply', async () => {
    const fake = setup([])
    render(<ChatPanel />)
    await screen.findByText(/Tell the agent what to post/)

    fireEvent.change(input(), { target: { value: 'Schedule a post' } })
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true })
    expect(fake.api.agent.send).not.toHaveBeenCalled()
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(fake.api.agent.send).toHaveBeenCalledWith('Schedule a post', [], 'text')
    expect(input().value).toBe('')

    const user = chatMessage('user', 'Schedule a post')
    act(() => fake.emit({ type: 'message', turnId: 't1', message: user }))
    expect(screen.getByText('Schedule a post')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()

    act(() => fake.emit({ type: 'text', turnId: 't1', delta: 'Sure, ' }))
    act(() => fake.emit({ type: 'text', turnId: 't1', delta: 'done.' }))
    expect(screen.getByTestId('streaming').textContent).toBe('Sure, done.')

    act(() => {
      fake.emit({ type: 'message', turnId: 't1', message: chatMessage('assistant', 'Sure, done.') })
      fake.emit({ type: 'done', turnId: 't1', stopped: false })
    })
    expect(screen.queryByTestId('streaming')).toBeNull()
    expect(screen.getByText('Sure, done.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
  })

  it('stops a running reply', async () => {
    const fake = setup()
    render(<ChatPanel />)
    await screen.findByText('Hello!')
    fireEvent.change(input(), { target: { value: 'Go' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(fake.api.agent.cancel).toHaveBeenCalled()
  })

  it('shows posts the agent created as cards that open the post', async () => {
    const fake = setup([])
    // Agent posts wait for the user's approval (OP-31).
    const scheduled = post({
      id: 'p1',
      text: 'Launch day!',
      scheduledAt: '2026-09-28T08:00:00Z',
      status: 'pending_approval'
    })
    fake.posts.set('p1', scheduled)
    const onOpenPost = vi.fn()
    render(<ChatPanel onOpenPost={onOpenPost} />)
    await screen.findByText(/Tell the agent what to post/)

    act(() =>
      fake.emit({
        type: 'message',
        turnId: 't1',
        message: chatMessage(
          'tool',
          JSON.stringify({ kind: 'posts', action: 'created', postIds: ['p1'] })
        )
      })
    )

    const card = await screen.findByRole('article', { name: /Post for/ })
    expect(card.textContent).toContain('Launch day!')
    expect(card.textContent).toContain('Waiting for your approval')
    expect(card.textContent).not.toContain('Scheduled')
    fireEvent.click(within(card).getByRole('button', { name: 'Open in Approvals' }))
    expect(onOpenPost).toHaveBeenCalledWith(scheduled)

    // The card follows the post as the publisher moves it along.
    fake.posts.set('p1', { ...scheduled, status: 'posted' })
    act(() => fake.changed({ ids: ['p1'] }))
    await waitFor(() => expect(card.textContent).toContain('Posted'))

    fake.posts.delete('p1')
    act(() => fake.changed({ ids: ['p1'] }))
    expect(await screen.findByText('This post was deleted.')).toBeTruthy()
  })

  it('shows an error with a retry', async () => {
    const fake = setup()
    render(<ChatPanel />)
    await screen.findByText('Hello!')

    act(() => fake.emit({ type: 'error', turnId: 't1', code: 'no_key', message: 'missing key' }))
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('needs your Anthropic API key')

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(fake.api.agent.retry).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('shows a refused send as an error, without the IPC prefix', async () => {
    const fake = setup()
    vi.mocked(fake.api.agent.send).mockRejectedValueOnce(
      new Error("Error invoking remote method 'agent:send': Error: The agent is still answering")
    )
    render(<ChatPanel />)
    await screen.findByText('Hello!')
    fireEvent.change(input(), { target: { value: 'Again' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect((await screen.findByRole('alert')).textContent).toContain('The agent is still answering')
  })

  it('clears the chat only after confirming', async () => {
    const fake = setup()
    render(<ChatPanel />)
    await screen.findByText('Hello!')

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(fake.api.chat.clear).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(fake.api.chat.clear).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Hello!')).toBeNull())
  })

  it('remembers whether it is open and its width', async () => {
    const fake = setup()
    fake.settings.set('chatPanel.width', 5000)
    render(<ChatPanel />)
    const panel = await screen.findByRole('complementary', { name: 'Chat with the agent' })
    // 5000 is clamped to the 560px maximum (OP-59).
    await waitFor(() => expect(panel.style.width).toBe('560px'))

    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }))
    expect(fake.settings.get('chatPanel.open')).toBe(false)
    fireEvent.click(await screen.findByRole('button', { name: 'Open the agent panel' }))
    expect(fake.settings.get('chatPanel.open')).toBe(true)
  })

  it('resizes from the keyboard, resets on double-click and saves each change', async () => {
    const fake = setup()
    render(<ChatPanel />)
    const handle = await screen.findByRole('separator', { name: 'Resize the agent panel' })
    const panel = screen.getByRole('complementary', { name: 'Chat with the agent' })
    expect(handle.getAttribute('tabindex')).toBe('0')
    expect(handle.getAttribute('aria-valuenow')).toBe('380')

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(panel.style.width).toBe('396px')
    expect(fake.settings.get('chatPanel.width')).toBe(396)
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(panel.style.width).toBe('364px')
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(panel.style.width).toBe('300px')
    fireEvent.keyDown(handle, { key: 'End' })
    expect(panel.style.width).toBe('560px')
    fireEvent.doubleClick(handle)
    expect(panel.style.width).toBe('380px')
    expect(fake.settings.get('chatPanel.width')).toBe(380)
  })

  it('drags wider to the left and stops at the limits', async () => {
    const fake = setup()
    render(<ChatPanel />)
    const handle = await screen.findByRole('separator', { name: 'Resize the agent panel' })
    const panel = screen.getByRole('complementary', { name: 'Chat with the agent' })
    fireEvent.pointerDown(handle, { clientX: 900 })
    fireEvent.pointerMove(window, { clientX: 800 })
    expect(panel.style.width).toBe('480px')
    fireEvent.pointerMove(window, { clientX: 100 })
    expect(panel.style.width).toBe('560px')
    fireEvent.pointerUp(window)
    expect(fake.settings.get('chatPanel.width')).toBe(560)
  })

  it('toggles with Cmd or Ctrl + backslash and shows the waiting count on the rail', async () => {
    const fake = setup()
    Object.assign(fake.api.posts, {
      pending: vi.fn().mockResolvedValue({ count: 3, first: '2026-09-29' })
    })
    render(<ChatPanel />)
    await screen.findByRole('complementary', { name: 'Chat with the agent' })

    fireEvent.keyDown(window, { key: '\\', metaKey: true })
    const rail = await screen.findByRole('button', {
      name: 'Open the agent panel, 3 waiting for approval'
    })
    expect(fake.settings.get('chatPanel.open')).toBe(false)

    fireEvent.keyDown(window, { key: '\\', ctrlKey: true })
    expect(await screen.findByRole('complementary', { name: 'Chat with the agent' })).toBeTruthy()
    expect(rail.isConnected).toBe(false)
  })

  it('expands and shows its settings when the Settings screen asks', async () => {
    const fake = setup()
    fake.settings.set('chatPanel.open', false)
    render(<ChatPanel />)
    await screen.findByRole('button', { name: 'Expand the agent panel' })

    act(() => openAgentSettings())
    await screen.findByRole('complementary', { name: 'Chat with the agent' })
    const settings = await screen.findByRole('button', { name: 'Settings' })
    await waitFor(() => expect(settings.getAttribute('aria-pressed')).toBe('true'))
    expect(fake.settings.get('chatPanel.open')).toBe(true)

    // Closed and opened again later, it's back on the chat.
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Expand the agent panel' }))
    expect(
      (await screen.findByRole('button', { name: 'Settings' })).getAttribute('aria-pressed')
    ).toBe('false')
  })
})

describe('ChatPanel attachments', () => {
  it('attaches picked files, removes one, and sends the rest with the message', async () => {
    const fake = setup([])
    render(<ChatPanel />)
    await screen.findByText(/Tell the agent what to post/)

    const attach = (): HTMLButtonElement => screen.getByLabelText('Attach images or a video')
    fireEvent.click(attach())
    await waitFor(() => expect(attach().disabled).toBe(false))
    fireEvent.click(attach())
    await waitFor(() => expect(attach().disabled).toBe(false))
    const strip = screen.getByLabelText('Attached files')
    const items = within(strip).getAllByRole('listitem')
    expect(items).toHaveLength(2)

    fireEvent.click(within(items[0]).getByRole('button', { name: /^Remove/ }))
    expect(fake.api.media.discard).toHaveBeenCalledTimes(1)
    const kept = strip.querySelector('img')!.getAttribute('src')

    fireEvent.change(input(), { target: { value: 'Post this Friday' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    const [, ids] = vi.mocked(fake.api.agent.send).mock.calls[0]
    expect(ids).toHaveLength(1)
    expect(kept).toBe('opencat-media://picked.png')
    expect(screen.queryByLabelText('Attached files')).toBeNull()
    expect(fake.api.media.discard).toHaveBeenCalledTimes(1)
  })

  it('sends files without text', async () => {
    const fake = setup([])
    render(<ChatPanel />)
    await screen.findByText(/Tell the agent what to post/)

    expect((screen.getByLabelText('Send') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Attach images or a video'))
    await screen.findByLabelText('Attached files')
    await waitFor(() =>
      expect((screen.getByLabelText('Send') as HTMLButtonElement).disabled).toBe(false)
    )
    fireEvent.click(screen.getByLabelText('Send'))
    expect(fake.api.agent.send).toHaveBeenCalledWith('', [expect.any(String)], 'text')
  })

  it('attaches an image pasted into the message box, and leaves text to paste as text (OP-89)', async () => {
    const fake = setup([])
    vi.mocked(fake.api.media.pathForFile).mockReturnValue('')
    render(<ChatPanel />)
    await screen.findByText(/Tell the agent what to post/)

    const text = fireEvent.paste(input(), { clipboardData: { files: [], types: ['text/plain'] } })
    expect(text).toBe(true)
    const shot = new File([new Uint8Array([1, 2])], 'image.png', { type: 'image/png' })
    const image = fireEvent.paste(input(), { clipboardData: { files: [shot], types: ['Files'] } })
    expect(image).toBe(false)

    await waitFor(() =>
      expect(fake.api.media.import).toHaveBeenCalledWith(['/tmp/pasted/clip.png'])
    )
    expect(fake.api.media.savePasted).toHaveBeenCalledWith(new Uint8Array([1, 2]), 'image/png')
    const strip = await screen.findByLabelText('Attached files')
    expect(within(strip).getAllByRole('listitem')).toHaveLength(1)
  })

  it('shows the drop overlay while files are dragged over, and imports what is dropped', async () => {
    const fake = setup([])
    render(<ChatPanel />)
    await screen.findByText(/Tell the agent what to post/)
    const panel = screen.getByLabelText('Chat with the agent')
    const file = new File(['x'], 'teaser.mp4', { type: 'video/mp4' })
    const dataTransfer = { types: ['Files'], files: [file] }

    fireEvent.dragEnter(panel.firstElementChild!.nextElementSibling!, { dataTransfer })
    expect(screen.getByText('Drop to attach')).toBeTruthy()
    fireEvent.drop(panel.firstElementChild!.nextElementSibling!, { dataTransfer })
    expect(screen.queryByText('Drop to attach')).toBeNull()

    expect(fake.api.media.import).toHaveBeenCalledWith(['/Users/me/teaser.mp4'])
    expect(await screen.findByText('teaser.mp4')).toBeTruthy()
    expect(screen.getByText('0:24 · 12 MB')).toBeTruthy()
  })

  it('shows the files a sent message carries above its text', async () => {
    setup([{ ...chatMessage('user', 'Use these'), media: [media('a.png'), media('b.png')] }])
    render(<ChatPanel />)
    const text = await screen.findByText('Use these')
    const bubble = text.parentElement!
    expect(bubble.querySelectorAll('img')).toHaveLength(2)
  })
})

describe('ChatPanel: converting a video', () => {
  const refusal =
    'X takes videos up to 2 minutes 20 seconds. This one is 3:05, so trim it and add it again.'

  /** Drops a video whose import main is still working on; the test settles it. */
  async function dropSlowVideo(fake: FakeApi): Promise<{
    resolve: (media: PostMedia[]) => void
    reject: (err: Error) => void
  }> {
    let resolve!: (media: PostMedia[]) => void
    let reject!: (err: Error) => void
    vi.mocked(fake.api.media.import).mockReturnValue(
      new Promise<PostMedia[]>((res, rej) => {
        resolve = res
        reject = rej
      })
    )
    render(<ChatPanel />)
    await screen.findByText(/Tell the agent what to post/)
    const panel = screen.getByLabelText('Chat with the agent')
    const file = new File(['x'], 'teaser.mov', { type: 'video/quicktime' })
    fireEvent.drop(panel.firstElementChild!.nextElementSibling!, {
      dataTransfer: { types: ['Files'], files: [file] }
    })
    return { resolve, reject }
  }

  const send = (): HTMLButtonElement => screen.getByLabelText('Send')
  const row = (): Promise<HTMLElement> =>
    screen.findByRole('status', { name: 'Converting teaser.mov for X' })

  it('shows the progress row and keeps Send off until the video is in', async () => {
    const fake = setup([])
    const pending = await dropSlowVideo(fake)
    fireEvent.change(input(), { target: { value: 'Use this' } })
    expect(send().disabled).toBe(true)

    const progress = await row()
    expect(progress.textContent).toContain('0%')
    expect(screen.queryByLabelText('Adding files')).toBeNull()
    act(() => fake.progress({ path: '/Users/me/teaser.mov', fraction: 0.34 }))
    expect(progress.textContent).toContain('34%')
    expect(send().disabled).toBe(true)

    pending.resolve([media('teaser.mp4')])
    expect(await screen.findByText('teaser.mov')).toBeTruthy()
    expect(screen.queryByRole('status', { name: /^Converting/ })).toBeNull()
    expect(send().disabled).toBe(false)
  })

  it('does not flash the row for a video that imports straight away', async () => {
    setup([])
    render(<ChatPanel />)
    await screen.findByText(/Tell the agent what to post/)
    const panel = screen.getByLabelText('Chat with the agent')
    fireEvent.drop(panel.firstElementChild!.nextElementSibling!, {
      dataTransfer: { types: ['Files'], files: [new File(['x'], 'teaser.mp4')] }
    })
    expect(await screen.findByText('teaser.mp4')).toBeTruthy()
    await act(() => new Promise<void>((done) => setTimeout(done, 400)))
    expect(screen.queryByRole('status', { name: /^Converting/ })).toBeNull()
  })

  it('cancels the conversion quietly', async () => {
    const fake = setup([])
    const pending = await dropSlowVideo(fake)
    const progress = await row()
    fireEvent.click(within(progress).getByLabelText('Cancel adding the video'))
    expect(fake.api.media.cancelImport).toHaveBeenCalled()

    pending.reject(
      new Error(
        "Error invoking remote method 'media:import': MediaError: Adding the video was cancelled."
      )
    )
    await waitFor(() => expect(screen.queryByRole('status', { name: /^Converting/ })).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByLabelText('Attached files')).toBeNull()
  })

  it('shows what main refused until it is dismissed', async () => {
    const fake = setup([])
    const pending = await dropSlowVideo(fake)
    await row()
    pending.reject(new Error(`Error invoking remote method 'media:import': MediaError: ${refusal}`))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(refusal)
    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('ChatPanel per X account', () => {
  it('reloads the conversation when the active account changes, and ignores other accounts', async () => {
    const fake = setup([chatMessage('user', 'In A')])
    fake.authStatus.activeAccountId = 'A'
    render(<ChatPanel />)
    expect(await screen.findByText('In A')).toBeTruthy()
    await waitFor(() => expect(fake.api.auth.status).toHaveBeenCalled())

    act(() => fake.emit({ type: 'text', turnId: 't', accountId: 'B', delta: 'Not for A' }))
    expect(screen.queryByText('Not for A')).toBeNull()

    vi.mocked(fake.api.chat.list).mockResolvedValue([chatMessage('user', 'In B')])
    act(() => fake.authChanged({ activeAccountId: 'B' }))
    expect(await screen.findByText('In B')).toBeTruthy()
    expect(screen.queryByText('In A')).toBeNull()
  })
})

describe('ChatPanel composer modes', () => {
  it('sends the picked mode, changes the placeholder and send button, then goes back to Text', async () => {
    const fake = setup([])
    render(<ChatPanel />)
    await screen.findByText(/Tell the agent what to post/)

    expect(input().placeholder).toBe('Describe the post…')
    fireEvent.click(screen.getByRole('radio', { name: 'Generate image' }))
    expect(screen.getByRole('radio', { name: 'Generate image' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    expect(input().placeholder).toBe('Describe the image to make with the post…')

    fireEvent.change(input(), { target: { value: 'Our 1.0 launch, Tuesday 9am' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send and make the image' }))
    expect(fake.api.agent.send).toHaveBeenCalledWith('Our 1.0 launch, Tuesday 9am', [], 'image')
    expect(screen.getByRole('radio', { name: 'Text' }).getAttribute('aria-checked')).toBe('true')
    expect(input().placeholder).toBe('Describe the post…')
  })

  it('disables Video with the reason when this machine cannot make video', async () => {
    const fake = setup([])
    vi.mocked(fake.api.agent.capabilities).mockResolvedValue({
      videoUnavailable: "Video needs OpenCatt's video tools, which are missing from this install."
    })
    render(<ChatPanel />)
    const video = (): HTMLButtonElement => screen.getByRole('radio', { name: 'Generate video' })
    await waitFor(() => expect(video().disabled).toBe(true))
    expect(screen.getByRole('tooltip').textContent).toBe(
      "Video needs OpenCatt's video tools, which are missing from this install."
    )
    expect(
      (screen.getByRole('radio', { name: 'Generate image' }) as HTMLButtonElement).disabled
    ).toBe(false)
  })

  it('shows the mode chip on a sent message that asked for media', async () => {
    setup([
      { ...chatMessage('user', 'A teaser for Friday'), mode: 'video' },
      chatMessage('user', 'Plain')
    ])
    render(<ChatPanel />)
    const text = await screen.findByText('A teaser for Friday')
    expect(text.parentElement!.textContent).toContain('Video')
    expect(screen.getByText('Plain').textContent).toBe('Plain')
  })
})

describe('ChatPanel while a video records', () => {
  it('swaps the mode row for the recording status and offers Stop', async () => {
    const fake = setup([])
    render(<ChatPanel />)
    await screen.findByText(/Tell the agent what to post/)
    fireEvent.click(screen.getByRole('radio', { name: 'Generate video' }))
    fireEvent.change(input(), { target: { value: 'A teaser' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send and make the video' }))

    act(() => fake.emit({ type: 'tool', turnId: 't1', name: 'render_video' }))
    expect(screen.getByRole('status').textContent).toMatch(
      /Recording the video….*0:00 \/ up to 1:00/
    )
    expect(screen.queryByRole('radiogroup', { name: 'What to make' })).toBeNull()
    expect(input().placeholder).toBe('Describe the video to make with the post…')
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(fake.api.agent.cancel).toHaveBeenCalled()

    act(() => fake.emit({ type: 'done', turnId: 't1', stopped: true }))
    expect(screen.getByRole('radiogroup', { name: 'What to make' })).toBeTruthy()
  })
})

describe('ChatPanel video length', () => {
  it('shows the length picker only in Video mode and sends the picked length', async () => {
    const fake = setup([])
    render(<ChatPanel />)
    await screen.findByText(/Tell the agent what to post/)
    expect(screen.queryByLabelText(/Video length/)).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: 'Generate video' }))
    const picker = screen.getByRole('button', { name: 'Video length, 15 seconds' })
    fireEvent.click(picker)
    fireEvent.click(
      within(screen.getByRole('listbox', { name: 'Video length' })).getByText('30 seconds')
    )
    expect(screen.getByRole('button', { name: 'Video length, 30 seconds' })).toBeTruthy()
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.change(input(), { target: { value: 'Our launch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send and make the video' }))
    expect(fake.api.agent.send).toHaveBeenCalledWith('Our launch', [], 'video', 30)
  })
})
