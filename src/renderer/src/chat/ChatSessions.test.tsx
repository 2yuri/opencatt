import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { chatMessage, chatSession, fakeApi, xAccount } from '../test/fakeApi'
import { ChatPanel } from './ChatPanel'

afterEach(() => {
  cleanup()
})

const minutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString()

/** @acme with three chats, the launch one open; each chat has one message of its own. */
function setup() {
  const fake = fakeApi()
  window.opencat = fake.api
  fake.authStatus.accounts = [xAccount('acme'), xAccount('beta')]
  fake.authStatus.activeAccountId = 'acme'
  // Out of order on purpose: main lists newest first.
  fake.sessions.push(
    chatSession({
      id: 's2',
      accountId: 'acme',
      title: 'Thread about the pricing change',
      updatedAt: minutesAgo(125)
    }),
    chatSession({ id: 's1', accountId: 'acme', title: 'Launch week ideas', active: true }),
    chatSession({
      id: 's3',
      accountId: 'acme',
      title: 'Weekly recap drafts',
      updatedAt: minutesAgo(9)
    }),
    chatSession({ id: 'b1', accountId: 'beta', title: 'Beta plans', active: true })
  )
  fake.chatMessages.set('s1', [chatMessage('user', 'Ideas for launch week')])
  fake.chatMessages.set('s2', [chatMessage('user', 'A thread on pricing')])
  fake.chatMessages.set('s3', [chatMessage('user', 'Recap of the week')])
  fake.chatMessages.set('b1', [chatMessage('user', 'In beta')])
  return fake
}

/** The header's title button, once it shows `title`. */
const titleButton = (title: string): Promise<HTMLElement> =>
  waitFor(() => {
    const button = document.querySelector<HTMLElement>('button[aria-haspopup="menu"]')
    expect(button?.textContent).toBe(title)
    return button!
  })

async function openMenu(title = 'Launch week ideas'): Promise<HTMLElement> {
  fireEvent.click(await titleButton(title))
  return screen.findByRole('menu', { name: 'Chats' })
}

const input = (): HTMLTextAreaElement => screen.getByLabelText('Message the agent')

describe('ChatPanel chats (OP-95)', () => {
  it('titles the header with the open chat and adds the account to the status line', async () => {
    setup()
    render(<ChatPanel />)
    expect(await titleButton('Launch week ideas')).toBeTruthy()
    expect(await screen.findByText('Ideas for launch week')).toBeTruthy()
    await waitFor(() =>
      expect(document.querySelector('.provider-pill')?.textContent).toBe('API key · @acme')
    )
    const pen = screen.getByRole('button', { name: 'New chat' })
    expect(pen.getAttribute('title')).toBe('New chat (Ctrl+N)')
    expect(pen.nextElementSibling).toBe(screen.getByRole('button', { name: 'Voice settings' }))
  })

  it("lists the account's chats newest first, with when each was last written in", async () => {
    setup()
    render(<ChatPanel />)
    const menu = await openMenu()
    expect(within(menu).getByText('Chats for @acme')).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: /New chat/ }).textContent).toContain('Ctrl+N')
    const rows = within(menu).getAllByRole('menuitemradio')
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Launch week ideas',
      'Weekly recap drafts',
      'Thread about the pricing change'
    ])
    expect(rows[0]!.getAttribute('aria-checked')).toBe('true')
    expect(within(screen.getByTestId('chat-row-s1')).getByText('now')).toBeTruthy()
    expect(within(screen.getByTestId('chat-row-s3')).getByText('9m')).toBeTruthy()
    expect(within(screen.getByTestId('chat-row-s2')).getByText('2h')).toBeTruthy()
    // Focus starts on the open chat; the arrows move down the list.
    expect(document.activeElement).toBe(rows[0])
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])
  })

  it('closes on Escape and on a click outside', async () => {
    setup()
    render(<ChatPanel />)
    const menu = await openMenu()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(await titleButton('Launch week ideas'))

    await openMenu()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it("opens another chat and shows that chat's messages", async () => {
    const fake = setup()
    render(<ChatPanel />)
    await screen.findByText('Ideas for launch week')
    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Weekly recap drafts' }))

    expect(fake.api.chat.sessions.setActive).toHaveBeenCalledWith('s3')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(await screen.findByText('Recap of the week')).toBeTruthy()
    expect(screen.queryByText('Ideas for launch week')).toBeNull()
    expect(await titleButton('Weekly recap drafts')).toBeTruthy()
  })

  it('holds Send in the chat you switch to while the one you left is still answering', async () => {
    const fake = setup()
    render(<ChatPanel />)
    await screen.findByText('Ideas for launch week')
    // A turn starts in the open chat, as main reports it.
    fake.sessions.find((s) => s.id === 's1')!.streaming = true
    act(() => {
      fake.emit({
        type: 'message',
        turnId: 't1',
        accountId: 'acme',
        sessionId: 's1',
        message: chatMessage('user', 'Draft the launch thread')
      })
      fake.emit({ type: 'text', turnId: 't1', accountId: 'acme', sessionId: 's1', delta: 'Here' })
      fake.sessionsChanged('acme')
    })

    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Weekly recap drafts' }))
    expect(await titleButton('Weekly recap drafts')).toBeTruthy()

    fireEvent.change(input(), { target: { value: 'Recap please' } })
    const send = (): HTMLButtonElement =>
      screen.getByRole<HTMLButtonElement>('button', { name: 'Send' })
    await waitFor(() => expect(send().disabled).toBe(true))
    const note = screen.getByText(/The agent is answering in “Launch week ideas”/)
    expect(within(note).getByRole('button', { name: 'Open it' })).toBeTruthy()

    // The turn ends in the chat we left: Send comes back here.
    fake.sessions.find((s) => s.id === 's1')!.streaming = false
    act(() => {
      fake.emit({ type: 'done', turnId: 't1', accountId: 'acme', sessionId: 's1', stopped: false })
      fake.sessionsChanged('acme')
    })
    await waitFor(() => expect(send().disabled).toBe(false))
    expect(screen.queryByText(/The agent is answering/)).toBeNull()
  })

  it('starts a new chat from the menu, empty and ready to type in', async () => {
    const fake = setup()
    render(<ChatPanel />)
    await screen.findByText('Ideas for launch week')
    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /New chat/ }))

    expect(fake.api.chat.sessions.create).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(await titleButton('New chat')).toBeTruthy()
    expect(await screen.findByText(/Tell the agent what to post/)).toBeTruthy()
    expect(screen.queryByText('Ideas for launch week')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(input()))
  })

  it("starts a new chat from the header's pen, and with Cmd or Ctrl+N inside the panel only", async () => {
    const fake = setup()
    render(<ChatPanel />)
    await screen.findByText('Ideas for launch week')

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    await waitFor(() => expect(fake.api.chat.sessions.create).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(document.activeElement).toBe(input()))

    // Elsewhere in the app, the key is not the panel's.
    fireEvent.keyDown(document.body, { key: 'n', metaKey: true })
    expect(fake.api.chat.sessions.create).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(input(), { key: 'n', metaKey: true })
    await waitFor(() => expect(fake.api.chat.sessions.create).toHaveBeenCalledTimes(2))
    fireEvent.keyDown(input(), { key: 'N', ctrlKey: true })
    await waitFor(() => expect(fake.api.chat.sessions.create).toHaveBeenCalledTimes(3))
  })

  it('starts a new chat from the collapsed rail, opening the panel', async () => {
    const fake = setup()
    fake.settings.set('chatPanel.open', false)
    render(<ChatPanel />)
    await screen.findByRole('button', { name: 'Expand the agent panel' })
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))

    expect(await screen.findByRole('complementary', { name: 'Chat with the agent' })).toBeTruthy()
    await waitFor(() => expect(fake.api.chat.sessions.create).toHaveBeenCalledTimes(1))
    expect(await titleButton('New chat')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(input()))
  })

  it("says why the rail's New chat didn't make one", async () => {
    const fake = setup()
    fake.settings.set('chatPanel.open', false)
    vi.mocked(fake.api.chat.sessions.create).mockRejectedValueOnce(
      new Error("Error invoking remote method 'chat:sessions:create': Error: Disk is full")
    )
    render(<ChatPanel />)
    await screen.findByRole('button', { name: 'Expand the agent panel' })
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(await screen.findByText('Disk is full')).toBeTruthy()
    expect(await titleButton('Launch week ideas')).toBeTruthy()
  })

  it('keeps the message box shut while another chat is answering, and says which', async () => {
    const fake = setup()
    fake.sessions.find((s) => s.id === 's2')!.streaming = true
    render(<ChatPanel />)
    await titleButton('Launch week ideas')
    fireEvent.change(input(), { target: { value: 'Draft the recap' } })
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send' }).disabled).toBe(true)
    )
    const note = screen.getByText(/The agent is answering in “Thread about the pricing change”/)
    fireEvent.click(within(note).getByRole('button', { name: 'Open it' }))
    await waitFor(() => expect(fake.api.chat.sessions.setActive).toHaveBeenCalledWith('s2'))
  })

  it('holds Send while the agent answers for another account, and says which', async () => {
    const fake = setup()
    render(<ChatPanel />)
    await titleButton('Launch week ideas')
    act(() =>
      fake.emit({
        type: 'message',
        turnId: 't9',
        accountId: 'beta',
        sessionId: 'b1',
        message: chatMessage('user', 'Beta turn')
      })
    )
    fireEvent.change(input(), { target: { value: 'Draft the recap' } })
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send' }).disabled).toBe(true)
    )
    expect(screen.getByText(/The agent is answering for @beta/)).toBeTruthy()
    act(() =>
      fake.emit({ type: 'done', turnId: 't9', accountId: 'beta', sessionId: 'b1', stopped: false })
    )
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send' }).disabled).toBe(false)
    )
  })

  it("holds Send when another account's reply was already running as the panel opened", async () => {
    const fake = setup()
    fake.sessions.find((s) => s.id === 'b1')!.streaming = true
    render(<ChatPanel />)
    await titleButton('Launch week ideas')
    fireEvent.change(input(), { target: { value: 'Draft the recap' } })
    const send = (): HTMLButtonElement =>
      screen.getByRole<HTMLButtonElement>('button', { name: 'Send' })
    await waitFor(() => expect(send().disabled).toBe(true))
    // Asked of main, not by listing beta's chats, which would make one if it had none.
    expect(fake.api.agent.running).toHaveBeenCalled()
    expect(fake.api.chat.sessions.list).not.toHaveBeenCalledWith('beta')
    const note = screen.getByText(/The agent is answering for @beta/)
    fireEvent.click(within(note).getByRole('button', { name: 'Open it' }))
    await waitFor(() => expect(fake.api.auth.setActive).toHaveBeenCalledWith('beta'))
    await waitFor(() => expect(fake.api.chat.sessions.setActive).toHaveBeenCalledWith('b1'))
    fake.sessions.find((s) => s.id === 'b1')!.streaming = false
    act(() => fake.sessionsChanged('beta'))
    await waitFor(() => expect(send().disabled).toBe(false))
  })

  it('renames a chat in place: Enter saves, Escape keeps the name, a refusal shows under it', async () => {
    const fake = setup()
    render(<ChatPanel />)
    let menu = await openMenu()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename Weekly recap drafts' }))
    let field = within(menu).getByRole('textbox', { name: 'Chat name' })
    expect(field.getAttribute('maxlength')).toBe('80')
    fireEvent.change(field, { target: { value: 'Never mind' } })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(fake.api.chat.sessions.rename).not.toHaveBeenCalled()
    expect(within(menu).getByRole('menuitemradio', { name: 'Weekly recap drafts' })).toBeTruthy()
    // Escape in the field leaves the menu open.
    menu = screen.getByRole('menu', { name: 'Chats' })

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename Weekly recap drafts' }))
    field = within(menu).getByRole('textbox', { name: 'Chat name' })
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect((await within(menu).findByRole('alert')).textContent).toBe('Give the chat a name.')
    expect(within(menu).getByRole('textbox', { name: 'Chat name' })).toBe(field)

    fireEvent.change(field, { target: { value: 'Evergreen tips' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await within(menu).findByRole('menuitemradio', { name: 'Evergreen tips' })).toBeTruthy()
    expect(fake.api.chat.sessions.rename).toHaveBeenLastCalledWith('s3', 'Evergreen tips')
    expect(within(menu).queryByRole('alert')).toBeNull()
  })

  it('saves a rename when the field loses focus', async () => {
    const fake = setup()
    render(<ChatPanel />)
    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename Launch week ideas' }))
    const field = within(menu).getByRole('textbox', { name: 'Chat name' })
    fireEvent.change(field, { target: { value: 'Launch week' } })
    fireEvent.blur(field)
    expect(await titleButton('Launch week')).toBeTruthy()
    expect(fake.api.chat.sessions.rename).toHaveBeenCalledTimes(1)
  })

  it('deletes a chat only after confirming, and opens the next when it was the open one', async () => {
    const fake = setup()
    render(<ChatPanel />)
    await screen.findByText('Ideas for launch week')
    const menu = await openMenu()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete Launch week ideas' }))
    const confirm = within(menu).getByRole('group', { name: 'Delete Launch week ideas' })
    expect(confirm.textContent).toContain('Delete “Launch week ideas”? Its messages go too.')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(fake.api.chat.sessions.delete).not.toHaveBeenCalled()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete Launch week ideas' }))
    fireEvent.click(within(menu).getByRole('button', { name: 'Delete' }))
    expect(fake.api.chat.sessions.delete).toHaveBeenCalledWith('s1')

    // Main opened the newest left.
    expect(await titleButton('Weekly recap drafts')).toBeTruthy()
    expect(await screen.findByText('Recap of the week')).toBeTruthy()
    expect(screen.queryByText('Ideas for launch week')).toBeNull()
    expect(within(menu).queryByRole('menuitemradio', { name: 'Launch week ideas' })).toBeNull()
  })

  it("draws only the open chat's turn, and marks another chat's reply with a dot", async () => {
    const fake = setup()
    render(<ChatPanel />)
    await screen.findByText('Ideas for launch week')
    await titleButton('Launch week ideas')

    act(() =>
      fake.emit({
        type: 'text',
        turnId: 't',
        accountId: 'acme',
        sessionId: 's2',
        delta: 'Elsewhere'
      })
    )
    act(() =>
      fake.emit({
        type: 'message',
        turnId: 't',
        accountId: 'acme',
        sessionId: 's2',
        message: chatMessage('assistant', 'Saved elsewhere')
      })
    )
    expect(screen.queryByText('Elsewhere')).toBeNull()
    expect(screen.queryByText('Saved elsewhere')).toBeNull()
    expect(screen.queryByText('Thinking…')).toBeNull()

    // Main says the turn is running in that chat.
    fake.sessions.find((s) => s.id === 's2')!.streaming = true
    act(() => fake.sessionsChanged('acme'))
    const menu = await openMenu()
    const row = screen.getByTestId('chat-row-s2')
    await waitFor(() => expect(within(row).getByTestId('chat-streaming')).toBeTruthy())
    expect(within(screen.getByTestId('chat-row-s1')).queryByTestId('chat-streaming')).toBeNull()

    // It can't be deleted until the reply is in.
    const del = within(menu).getByRole('menuitem', {
      name: 'Delete Thread about the pricing change'
    })
    expect(del.getAttribute('aria-disabled')).toBe('true')
    expect(del.getAttribute('title')).toBe('Wait for the reply to finish')
    fireEvent.click(del)
    expect(within(menu).queryByRole('group')).toBeNull()
    expect(fake.api.chat.sessions.delete).not.toHaveBeenCalled()

    // Opening it shows its saved messages, and that the agent is still answering there.
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Thread about the pricing/ }))
    expect(await screen.findByText('A thread on pricing')).toBeTruthy()
    expect(await screen.findByText('Thinking…')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
    act(() =>
      fake.emit({ type: 'text', turnId: 't', accountId: 'acme', sessionId: 's2', delta: 'More' })
    )
    expect(screen.getByTestId('streaming').textContent).toBe('More')
  })

  it("shows main's refusal to delete under the row", async () => {
    const fake = setup()
    render(<ChatPanel />)
    const menu = await openMenu()
    // A turn started after the list was drawn: main refuses.
    fake.sessions.find((s) => s.id === 's3')!.streaming = true
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete Weekly recap drafts' }))
    fireEvent.click(within(menu).getByRole('button', { name: 'Delete' }))
    const alert = await within(menu).findByRole('alert')
    expect(alert.textContent).toBe('The agent is still answering in that chat')
    expect(alert.className).toContain('text-ds-red')
    expect(within(menu).getByRole('menuitemradio', { name: 'Weekly recap drafts' })).toBeTruthy()
  })

  it("shows the other account's chats and open chat after an account switch", async () => {
    const fake = setup()
    render(<ChatPanel />)
    await screen.findByText('Ideas for launch week')
    await titleButton('Launch week ideas')

    act(() => fake.authChanged({ activeAccountId: 'beta' }))
    expect(await titleButton('Beta plans')).toBeTruthy()
    expect(await screen.findByText('In beta')).toBeTruthy()
    expect(screen.queryByText('Ideas for launch week')).toBeNull()
    const menu = await openMenu('Beta plans')
    expect(within(menu).getByText('Chats for @beta')).toBeTruthy()
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((r) => r.getAttribute('aria-label'))
    ).toEqual(['Beta plans'])
  })

  it('follows a title main gives the chat from its first message', async () => {
    const fake = setup()
    const made = await fake.api.chat.sessions.create('acme')
    vi.mocked(fake.api.chat.sessions.create).mockClear()
    render(<ChatPanel />)
    expect(await titleButton('New chat')).toBeTruthy()
    fake.sessions.find((s) => s.id === made.id)!.title = 'Pricing thread'
    act(() => fake.sessionsChanged('acme'))
    expect(await titleButton('Pricing thread')).toBeTruthy()
  })
})
