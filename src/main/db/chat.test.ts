import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MediaStore } from '../media/store'
import { fakeMedia, tempDir } from '../media/testFiles'
import { ChatStore } from './chat'
import { openDatabase } from './database'

function setup(): { chat: ChatStore; media: MediaStore; image: () => string } {
  const db = openDatabase(':memory:')
  const media = new MediaStore(db, join(tempDir(), 'media'), () => ({ width: 1200, height: 800 }))
  const source = tempDir('opencat-src-')
  let n = 0
  return {
    chat: new ChatStore(db),
    media,
    image: () => media.import(fakeMedia(source, `${++n}.png`)).id
  }
}

describe('ChatStore media', () => {
  it('keeps the files on the user message and lists them with it', () => {
    const { chat, image } = setup()
    const a = image()
    const b = image()
    chat.append({ role: 'user', content: 'Post these', media: [a, b, a] })

    const [message] = chat.list()
    expect(message.media.map((m) => [m.id, m.kind, m.width])).toEqual([
      [a, 'image', 1200],
      [b, 'image', 1200]
    ])
    expect(chat.mediaIds()).toEqual(new Set([a, b]))
  })

  it('refuses a media id that is not in the store', () => {
    const { chat } = setup()
    expect(() => chat.append({ role: 'user', content: 'x', media: ['nope'] })).toThrow(
      /no longer available/
    )
    expect(chat.list()).toEqual([])
  })

  it('drops a file that was removed since, and clear hands back the ids it held', () => {
    const { chat, media, image } = setup()
    const a = image()
    const b = image()
    chat.append({ role: 'user', content: 'Two', media: [a, b] })
    media.discard(a)

    expect(chat.list()[0].media.map((m) => m.id)).toEqual([b])
    expect(chat.clear().sort()).toEqual([a, b].sort())
    expect(chat.mediaIds()).toEqual(new Set())
  })
})

describe('ChatStore per account', () => {
  it('keeps each chat its own messages and media (OP-94)', () => {
    const { chat, image } = setup()
    const early = image()
    chat.append({ role: 'user', content: 'In one', media: [early], sessionId: 's1' })
    chat.append({ role: 'user', content: 'In two', accountId: 'A', sessionId: 's2' })

    expect(chat.list('s1').map((m) => m.content)).toEqual(['In one'])
    expect(chat.list('s2').map((m) => [m.content, m.sessionId])).toEqual([['In two', 's2']])
    expect(chat.mediaIds('s1')).toEqual(new Set([early]))
    expect(chat.mediaIds('s2')).toEqual(new Set())
    expect(chat.mediaIds()).toEqual(new Set([early]))

    expect(chat.clear('s1')).toEqual([early])
    expect(chat.list('s1')).toEqual([])
    expect(chat.list('s2').map((m) => m.content)).toEqual(['In two'])
  })
})

describe('ChatStore renders', () => {
  it('counts the agent renders shown in the chat, so the agent may attach them', () => {
    const { chat, image } = setup()
    const render = image()
    chat.append({
      role: 'tool',
      content: JSON.stringify({
        kind: 'render',
        mediaId: render,
        width: 1200,
        height: 675,
        bytes: 10,
        url: 'opencat-media://media/x.png'
      })
    })
    chat.append({
      role: 'tool',
      content: JSON.stringify({ kind: 'posts', action: 'created', postIds: ['p'] })
    })

    expect(chat.mediaIds()).toEqual(new Set([render]))
    expect(chat.clear()).toEqual([render])
  })
})

describe('ChatStore composer mode', () => {
  it('keeps the mode a user message was sent in, and text for everything else', () => {
    const { chat } = setup()
    chat.append({ role: 'user', content: 'Launch video', mode: 'video' })
    chat.append({ role: 'user', content: 'Plain' })
    chat.append({ role: 'assistant', content: 'Done' })
    expect(chat.list().map((m) => [m.content, m.mode])).toEqual([
      ['Launch video', 'video'],
      ['Plain', 'text'],
      ['Done', 'text']
    ])
  })
})
