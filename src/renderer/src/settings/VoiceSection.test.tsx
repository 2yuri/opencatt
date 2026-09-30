import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import {
  DEFAULT_VIDEO_PROMPT,
  DEFAULT_WRITING_GUIDE,
  fakeApi,
  voiceProfile,
  xAccount,
  type FakeApi
} from '../test/fakeApi'
import { SettingsScreen } from './SettingsScreen'

let fake: FakeApi

function Where(): React.JSX.Element {
  const location = useLocation()
  return <output data-testid="where">{location.pathname + location.hash}</output>
}

function renderScreen(entry = '/settings'): void {
  window.opencat = fake.api
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>
  )
}

const voice = (): HTMLElement => document.getElementById('voice') as HTMLElement
const description = (): HTMLTextAreaElement =>
  screen.getByLabelText<HTMLTextAreaElement>('How should your posts sound?')
const preview = (): string =>
  within(voice()).getByText(/^(Writes in|Nothing set yet)/).textContent ?? ''

const filled = voiceProfile({
  description: 'Short, plain and a bit dry.',
  examples: ['We shipped the calendar today.', 'Nobody reads your changelog.']
})

beforeEach(() => {
  fake = fakeApi()
  fake.authStatus.accounts = [xAccount('acme'), xAccount('maria')]
  fake.authStatus.activeAccountId = 'acme'
  fake.voices.set('acme', { ...filled, examples: [...filled.examples] })
})

afterEach(() => {
  cleanup()
})

describe('Settings, Voice', () => {
  it("loads the active account's voice, right after General", async () => {
    renderScreen()
    expect(
      await within(await screen.findByRole('region', { name: 'Voice' })).findByText('for @acme')
    ).toBeTruthy()
    await waitFor(() => expect(description().value).toBe('Short, plain and a bit dry.'))
    expect(fake.api.voice.get).toHaveBeenCalledWith('acme')
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['General', 'Voice', 'Accounts', 'Posting', 'Agent'])
    expect(screen.getByText('We shipped the calendar today.')).toBeTruthy()
    expect(screen.getByLabelText<HTMLSelectElement>('Language').value).toBe('auto')
    expect(screen.getByRole('switch', { name: 'Emoji' }).getAttribute('aria-checked')).toBe('false')
    const images = screen.getByRole('group', { name: 'Images with posts' })
    expect(
      within(images).getByRole('button', { name: 'Ask me' }).getAttribute('aria-pressed')
    ).toBe('true')
  })

  it('reloads when the active account changes', async () => {
    fake.voices.set('maria', voiceProfile({ description: 'Warm and curious.' }))
    renderScreen()
    await waitFor(() => expect(description().value).toBe('Short, plain and a bit dry.'))
    act(() => fake.authChanged({ activeAccountId: 'maria' }))
    expect(
      await within(await screen.findByRole('region', { name: 'Voice' })).findByText('for @maria')
    ).toBeTruthy()
    await waitFor(() => expect(description().value).toBe('Warm and curious.'))
    expect(fake.api.voice.get).toHaveBeenLastCalledWith('maria')
    expect(screen.queryByText('We shipped the calendar today.')).toBeNull()
  })

  it('follows a save from elsewhere, for the shown account only', async () => {
    renderScreen()
    await waitFor(() => expect(description().value).toBe('Short, plain and a bit dry.'))
    act(() => fake.voiceChanged('maria', voiceProfile({ description: 'Not this one.' })))
    expect(description().value).toBe('Short, plain and a bit dry.')
    act(() => fake.voiceChanged('acme', { ...filled, description: 'Changed elsewhere.' }))
    expect(description().value).toBe('Changed elsewhere.')
  })

  it('asks for an account when none is connected', async () => {
    fake.authStatus.accounts = []
    fake.authStatus.activeAccountId = null
    renderScreen()
    fireEvent.click(await screen.findByRole('link', { name: 'Connect an X account' }))
    expect(screen.getByTestId('where').textContent).toBe('/integrations')
    expect(fake.api.voice.get).not.toHaveBeenCalled()
  })

  it('saves the description on blur, with only that field, and says so', async () => {
    renderScreen()
    await waitFor(() => expect(description().value).toBe('Short, plain and a bit dry.'))
    fireEvent.blur(description())
    expect(fake.api.voice.set).not.toHaveBeenCalled()
    fireEvent.change(description(), { target: { value: 'Friendly and direct.' } })
    expect(fake.api.voice.set).not.toHaveBeenCalled()
    fireEvent.blur(description())
    expect(fake.api.voice.set).toHaveBeenCalledWith('acme', { description: 'Friendly and direct.' })
    expect(await screen.findByText('Saved')).toBeTruthy()
  })

  it('saves language, emoji, hashtags and images, each on its own', async () => {
    renderScreen()
    await waitFor(() => expect(description().value).not.toBe(''))
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'pt-BR' } })
    expect(fake.api.voice.set).toHaveBeenLastCalledWith('acme', { language: 'pt-BR' })
    fireEvent.click(screen.getByRole('switch', { name: 'Emoji' }))
    expect(fake.api.voice.set).toHaveBeenLastCalledWith('acme', { emoji: true })
    fireEvent.click(screen.getByRole('switch', { name: 'Hashtags' }))
    expect(fake.api.voice.set).toHaveBeenLastCalledWith('acme', { hashtags: true })
    fireEvent.click(screen.getByRole('button', { name: 'Never' }))
    expect(fake.api.voice.set).toHaveBeenLastCalledWith('acme', { images: 'never' })
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Hashtags' }).getAttribute('aria-checked')).toBe(
        'true'
      )
    )
    expect(fake.voices.get('acme')).toMatchObject({
      language: 'pt-BR',
      emoji: true,
      hashtags: true,
      images: 'never'
    })
    expect(preview()).toBe(
      'Writes in Português (Brasil) · emoji where natural · hashtags · never makes an image'
    )
  })

  it('shows a refused save inline, in red, and puts the switch back', async () => {
    renderScreen()
    await waitFor(() => expect(description().value).not.toBe(''))
    const set = fake.api.voice.set as unknown as { mockRejectedValueOnce(e: Error): void }
    set.mockRejectedValueOnce(
      new Error("Error invoking remote method 'voice:set': VoiceError: Could not save the voice.")
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Emoji' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Could not save the voice.')
    expect(alert.className).toContain('text-ds-red')
    expect(screen.getByRole('switch', { name: 'Emoji' }).getAttribute('aria-checked')).toBe('false')
  })

  it('describes the voice under the box', async () => {
    renderScreen()
    await waitFor(() => expect(description().value).not.toBe(''))
    expect(preview()).toBe(
      'Writes in the language you ask in · no emoji · no hashtags · asks before making an image'
    )
  })

  it('says the agent will ask first when nothing is set', async () => {
    fake.voices.delete('acme')
    renderScreen()
    await within(await screen.findByRole('region', { name: 'Voice' })).findByText('for @acme')
    await waitFor(() =>
      expect(preview()).toBe(
        'Nothing set yet: the agent will ask you two or three questions before its first post'
      )
    )
    expect(description().placeholder).toBe(
      'e.g. Friendly and direct. Short sentences. Talk to other founders, not to investors.'
    )
    expect(screen.queryByRole('button', { name: /Import/ })).toBeNull()
  })

  it('scrolls to itself for /settings#voice, the agent panel link', async () => {
    const scrolled: Element[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    renderScreen('/settings#voice')
    await within(await screen.findByRole('region', { name: 'Voice' })).findByText('for @acme')
    expect(voice().tagName).toBe('SECTION')
    expect(scrolled).toContain(voice())
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })
})

describe('Settings, Voice, example posts', () => {
  it('adds an example', async () => {
    renderScreen()
    await screen.findByText('We shipped the calendar today.')
    fireEvent.click(screen.getByRole('button', { name: 'Add an example' }))
    const editor = screen.getByLabelText<HTMLTextAreaElement>('Example post')
    expect(document.activeElement).toBe(editor)
    fireEvent.change(editor, { target: { value: '  Third one.  ' } })
    expect(screen.getByText('10 / 280')).toBeTruthy()
    fireEvent.blur(editor)
    expect(fake.api.voice.set).toHaveBeenCalledWith('acme', {
      examples: ['We shipped the calendar today.', 'Nobody reads your changelog.', 'Third one.']
    })
    expect(await screen.findByText('Third one.')).toBeTruthy()
  })

  it('drops a new example left empty', async () => {
    renderScreen()
    await screen.findByText('We shipped the calendar today.')
    fireEvent.click(screen.getByRole('button', { name: 'Add an example' }))
    fireEvent.blur(screen.getByLabelText('Example post'))
    expect(screen.queryByLabelText('Example post')).toBeNull()
    expect(fake.api.voice.set).not.toHaveBeenCalled()
  })

  it('edits an example in place', async () => {
    renderScreen()
    fireEvent.click(await screen.findByText('Nobody reads your changelog.'))
    const editor = screen.getByLabelText<HTMLTextAreaElement>('Example post')
    expect(editor.value).toBe('Nobody reads your changelog.')
    fireEvent.change(editor, { target: { value: 'Nobody reads changelogs.' } })
    fireEvent.blur(editor)
    expect(fake.api.voice.set).toHaveBeenCalledWith('acme', {
      examples: ['We shipped the calendar today.', 'Nobody reads changelogs.']
    })
  })

  it('cancels an edit with Escape', async () => {
    renderScreen()
    fireEvent.click(await screen.findByText('Nobody reads your changelog.'))
    const editor = screen.getByLabelText('Example post')
    fireEvent.change(editor, { target: { value: 'Something else' } })
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(screen.getByText('Nobody reads your changelog.')).toBeTruthy()
    expect(fake.api.voice.set).not.toHaveBeenCalled()
  })

  it('removes an example', async () => {
    renderScreen()
    await screen.findByText('We shipped the calendar today.')
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove example' })[0])
    expect(fake.api.voice.set).toHaveBeenCalledWith('acme', {
      examples: ['Nobody reads your changelog.']
    })
    await waitFor(() => expect(screen.queryByText('We shipped the calendar today.')).toBeNull())
  })

  it('keeps an example over 280 characters open, with an error, until it fits', async () => {
    renderScreen()
    await screen.findByText('We shipped the calendar today.')
    fireEvent.click(screen.getByRole('button', { name: 'Add an example' }))
    const editor = screen.getByLabelText('Example post')
    // X counts a link as 23 and most emoji as 2, so the count is X's, not the string's.
    fireEvent.change(editor, { target: { value: 'a'.repeat(270) + ' 🎉🎉🎉🎉🎉' } })
    expect(screen.getByText('281 / 280')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(
      'Too long for one post: X counts 281 of 280 characters.'
    )
    fireEvent.blur(editor)
    expect(screen.getByLabelText('Example post')).toBeTruthy()
    expect(fake.api.voice.set).not.toHaveBeenCalled()
    fireEvent.change(editor, { target: { value: 'a'.repeat(270) + ' 🎉🎉🎉🎉' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.blur(editor)
    expect(fake.api.voice.set).toHaveBeenCalledTimes(1)
  })

  it('stops at ten examples', async () => {
    fake.voices.set(
      'acme',
      voiceProfile({ examples: Array.from({ length: 9 }, (_, i) => `Post ${i}`) })
    )
    renderScreen()
    await screen.findByText('Post 8')
    const add = screen.getByRole<HTMLButtonElement>('button', { name: 'Add an example' })
    expect(add.disabled).toBe(false)
    fireEvent.click(add)
    expect(add.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Example post'), { target: { value: 'Post 9' } })
    fireEvent.blur(screen.getByLabelText('Example post'))
    await screen.findByText('Post 9')
    expect(add.disabled).toBe(true)
  })
})

describe('Settings, Voice, Advanced', () => {
  const open = async (): Promise<void> => {
    renderScreen()
    const toggle = await screen.findByRole('button', { name: /Advanced/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByLabelText('Writing guide')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLTextAreaElement>('Writing guide').value).toBe(
        DEFAULT_WRITING_GUIDE
      )
    )
  }
  const editor = (name: string): HTMLElement =>
    screen.getByLabelText(name).parentElement as HTMLElement
  const save = (name: string): HTMLButtonElement =>
    within(editor(name)).getByRole<HTMLButtonElement>('button', { name: 'Save' })
  const reset = (name: string): HTMLButtonElement =>
    within(editor(name)).getByRole<HTMLButtonElement>('button', { name: 'Reset to default' })

  it('shows both prompts, the default ones, with nothing to save or reset', async () => {
    await open()
    expect(screen.getByLabelText<HTMLTextAreaElement>('Video prompt').value).toBe(
      DEFAULT_VIDEO_PROMPT
    )
    expect(within(editor('Writing guide')).getByText('Default')).toBeTruthy()
    expect(save('Writing guide').disabled).toBe(true)
    expect(reset('Writing guide').disabled).toBe(true)
    expect(within(editor('Video prompt')).getByText('{duration}')).toBeTruthy()
    expect(within(editor('Writing guide')).getByText('24 / 20,000')).toBeTruthy()
    expect(within(editor('Video prompt')).getByText('48 / 4,000')).toBeTruthy()
    expect(
      screen.getByText(
        'Changes apply from the next message. Reset asks before replacing your text.'
      )
    ).toBeTruthy()
  })

  it('saves an edited writing guide', async () => {
    await open()
    fireEvent.change(screen.getByLabelText('Writing guide'), { target: { value: 'My rules.' } })
    expect(save('Writing guide').disabled).toBe(false)
    fireEvent.click(save('Writing guide'))
    expect(fake.api.voice.setWritingPrompt).toHaveBeenCalledWith('My rules.')
    await waitFor(() => expect(within(editor('Writing guide')).getByText('Edited')).toBeTruthy())
    expect(save('Writing guide').disabled).toBe(true)
    expect(reset('Writing guide').disabled).toBe(false)
  })

  it('keeps Save off for an empty text or one over the limit', async () => {
    await open()
    fireEvent.change(screen.getByLabelText('Video prompt'), { target: { value: '   ' } })
    expect(save('Video prompt').disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Video prompt'), {
      target: { value: 'x'.repeat(4_001) }
    })
    expect(save('Video prompt').disabled).toBe(true)
    const count = within(editor('Video prompt')).getByText('4,001 / 4,000')
    expect(count.className).toContain('text-ds-red')
  })

  it('shows a refused save inline', async () => {
    await open()
    const set = fake.api.video.setPrePrompt as unknown as { mockRejectedValueOnce(e: Error): void }
    set.mockRejectedValueOnce(
      new Error("Error invoking remote method 'video:prePrompt:set': Error: Keep {duration} in it.")
    )
    fireEvent.change(screen.getByLabelText('Video prompt'), { target: { value: 'Make a video.' } })
    fireEvent.click(save('Video prompt'))
    expect((await within(editor('Video prompt')).findByRole('alert')).textContent).toBe(
      'Keep {duration} in it.'
    )
  })

  it('asks before resetting, and Cancel keeps the text', async () => {
    fake.prompts.video = { text: 'My own video prompt.', isDefault: false }
    await open()
    await waitFor(() => expect(within(editor('Video prompt')).getByText('Edited')).toBeTruthy())
    fireEvent.click(reset('Video prompt'))
    expect(screen.getByText('Replace your text with the built-in one?')).toBeTruthy()
    fireEvent.click(within(editor('Video prompt')).getByRole('button', { name: 'Cancel' }))
    expect(fake.api.video.resetPrePrompt).not.toHaveBeenCalled()
    expect(screen.getByLabelText<HTMLTextAreaElement>('Video prompt').value).toBe(
      'My own video prompt.'
    )

    fireEvent.click(reset('Video prompt'))
    fireEvent.click(within(editor('Video prompt')).getByRole('button', { name: 'Reset' }))
    expect(fake.api.video.resetPrePrompt).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLTextAreaElement>('Video prompt').value).toBe(
        DEFAULT_VIDEO_PROMPT
      )
    )
    expect(within(editor('Video prompt')).getByText('Default')).toBeTruthy()
    expect(reset('Video prompt').disabled).toBe(true)
  })

  it('is there without an account too', async () => {
    fake.authStatus.accounts = []
    fake.authStatus.activeAccountId = null
    renderScreen()
    expect(await screen.findByRole('button', { name: /Advanced/ })).toBeTruthy()
  })
})
