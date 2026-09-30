import { describe, expect, it } from 'vitest'
import type { PostAuthor } from '@shared/api'
import { PostsService, SettingsStore } from '../db'
import { openDatabase } from '../db/database'
import { AutopilotStore } from './autopilot'
import { accountNote } from './prompt'
import { postTools, runTool } from './tools'

const NOW = new Date('2026-09-26T20:00:00Z')
const AT = '2026-09-29T09:00:00+01:00'

function setup() {
  const db = openDatabase(':memory:')
  const posts = new PostsService(db, () => NOW)
  posts.useAccounts({ active: () => 'A', canPost: (id) => id === 'A' || id === 'B' })
  const changes: string[] = []
  const autopilot = new AutopilotStore(
    new SettingsStore(db),
    (id) => id === 'A' || id === 'B',
    (id) => changes.push(id)
  )
  posts.useAutopilot((accountId, by) => autopilot.allows(accountId, by))
  const create = (by: PostAuthor, accountId = 'A') =>
    posts.create({ parts: [{ text: `by ${by}` }], scheduledAt: AT, accountId }, { by })
  return { posts, autopilot, changes, create }
}

describe('Autopilot (OP-103)', () => {
  it('is off by default: agent and MCP posts wait, the user’s are scheduled', () => {
    const { autopilot, create } = setup()
    expect(autopilot.get('A')).toBe(false)
    expect(create('agent').status).toBe('pending_approval')
    expect(create('mcp').status).toBe('pending_approval')
    expect(create('user')).toMatchObject({ status: 'scheduled', autopilot: false })
  })

  it('schedules posts from the agent and from MCP on that account only (boss, DM 2721)', () => {
    const { autopilot, create, changes } = setup()
    autopilot.set('A', true)
    expect(changes).toEqual(['A'])
    expect(create('agent')).toMatchObject({ status: 'scheduled', autopilot: true })
    expect(create('mcp')).toMatchObject({ status: 'scheduled', autopilot: true })
    expect(create('agent', 'B').status).toBe('pending_approval')
    expect(create('mcp', 'B').status).toBe('pending_approval')
    expect(() => autopilot.set('C', true)).toThrow("That X account isn't connected.")
  })

  it('never approves a post that was already waiting, even when the agent edits it', () => {
    const { posts, autopilot, create } = setup()
    const waiting = create('agent')
    autopilot.set('A', true)
    const edited = posts.update(waiting.id, { text: 'changed' }, { by: 'agent' })
    expect(edited).toMatchObject({ status: 'pending_approval', autopilot: false })
  })

  it("keeps an Autopilot post scheduled when the agent edits it, and back to waiting when it's off", () => {
    const { posts, autopilot, create } = setup()
    autopilot.set('A', true)
    const post = create('agent')
    expect(posts.update(post.id, { text: 'again' }, { by: 'agent' }).status).toBe('scheduled')
    autopilot.set('A', false)
    expect(posts.update(post.id, { text: 'once more' }, { by: 'agent' })).toMatchObject({
      status: 'pending_approval',
      autopilot: false
    })
  })

  it('tells the in-app agent and an MCP client the post is scheduled, and the prompt says so', () => {
    const { posts, autopilot } = setup()
    autopilot.set('A', true)
    for (const by of ['agent', 'mcp'] as const) {
      const tools = postTools(posts, () => NOW, by, undefined, { forCall: () => 'A' })
      const out = runTool(tools, 'create_posts', {
        posts: [{ text: `Launch by ${by}`, scheduled_at: AT }]
      })
      const created = (JSON.parse(out.content) as { created: { status: string; note: string }[] })
        .created[0]!
      expect(created.status).toBe('scheduled (Autopilot on)')
      expect(created.note).toContain("scheduled without the user's approval")
    }

    expect(accountNote({ handle: 'a', name: null, autopilot: true })).toContain(
      'Autopilot is on for this account'
    )
    expect(accountNote({ handle: 'a', name: null })).not.toContain('Autopilot')
  })
})
