import { describe, expect, it } from 'vitest'
import { PostsService } from '../db'
import { openDatabase } from '../db/database'
import { mcpTools } from '../mcp/server'
import { SYSTEM } from './prompt'
import { postTools, runTool, type ToolCaller } from './tools'

// Europe/Lisbon, +01:00 on these dates.
const NOW = new Date('2026-09-26T20:00:00Z')
const MONDAY = '2026-09-28T09:00:00+01:00'

function setup(by: ToolCaller = 'agent') {
  const posts = new PostsService(openDatabase(':memory:'), () => NOW)
  const tools = postTools(posts, () => NOW, by)
  const run = (name: string, input: unknown) => runTool(tools, name, input)
  return { posts, tools, run }
}

const body = (o: { content: string }) => JSON.parse(o.content) as Record<string, unknown>

describe('agent and MCP posts wait for approval', () => {
  it.each<ToolCaller>(['agent', 'mcp'])(
    '%s-created posts are pending and the publisher skips them',
    (by) => {
      const { posts, run } = setup(by)
      const out = run('create_posts', { posts: [{ text: 'Draft', scheduled_at: MONDAY }] })
      const [post] = posts.listByDay('2026-09-28')

      expect(post).toMatchObject({ status: 'pending_approval', createdBy: by })
      expect(posts.listDue(new Date('2026-09-28T09:00:00+01:00'))).toEqual([])
      expect(body(out)['created']).toMatchObject([
        {
          status: 'pending_approval',
          note: expect.stringContaining("Waiting for the user's approval")
        }
      ])
    }
  )

  it('sends an approved post back to pending when the agent edits or moves it', () => {
    const { posts, run } = setup()
    const approved = posts.create({ text: 'By hand', scheduledAt: MONDAY })
    expect(approved.status).toBe('scheduled')

    run('update_post', { id: approved.id, text: 'Agent rewrite' })
    expect(posts.get(approved.id)?.status).toBe('pending_approval')

    posts.approve(approved.id)
    run('reschedule_post', { id: approved.id, scheduled_at: '2026-09-29T09:00:00+01:00' })
    expect(posts.get(approved.id)?.status).toBe('pending_approval')
  })

  it('keeps a pending post pending when the agent moves it', () => {
    const { posts, run } = setup()
    run('create_posts', { posts: [{ text: 'Draft', scheduled_at: MONDAY }] })
    const [post] = posts.listByDay('2026-09-28')
    run('reschedule_post', { id: post!.id, scheduled_at: '2026-09-28T12:00:00+01:00' })
    expect(posts.get(post!.id)?.status).toBe('pending_approval')
  })

  it('has no way to approve, for the agent or for MCP clients', () => {
    const { tools, run, posts } = setup()
    const names = [...tools, ...mcpTools(tools)].map((t) => t.name)
    expect(names.filter((n) => /approv/i.test(n))).toEqual([])

    run('create_posts', { posts: [{ text: 'Draft', scheduled_at: MONDAY }] })
    const [post] = posts.listByDay('2026-09-28')
    expect(run('approve_post', { id: post!.id }).isError).toBe(true)
    expect(posts.get(post!.id)?.status).toBe('pending_approval')
  })

  it('lets the agent delete its own drafts but not a post the user approved', () => {
    const { posts, run } = setup()
    run('create_posts', { posts: [{ text: 'Draft', scheduled_at: MONDAY }] })
    const [draft] = posts.listByDay('2026-09-28')
    const approved = posts.create({ text: 'By hand', scheduledAt: '2026-09-28T12:00:00+01:00' })

    expect(run('delete_post', { id: draft!.id }).isError).toBe(false)
    expect(posts.get(draft!.id)).toBeNull()

    const refused = run('delete_post', { id: approved.id })
    expect(refused.isError).toBe(true)
    expect(body(refused)['error']).toContain('only they can delete it')
    expect(posts.get(approved.id)?.status).toBe('scheduled')

    run('create_posts', { posts: [{ text: 'Turned down', scheduled_at: MONDAY }] })
    const turnedDown = posts.listByDay('2026-09-28').find((p) => p.text === 'Turned down')!
    posts.reject(turnedDown.id)
    const rejected = run('delete_post', { id: turnedDown.id })
    expect(body(rejected)['error']).toContain('The user turned it down')
    expect(posts.get(turnedDown.id)?.status).toBe('rejected')
  })

  it('still refuses to duplicate a post that is waiting for approval', () => {
    const { posts, run } = setup()
    const input = { posts: [{ text: 'Once', scheduled_at: MONDAY }] }
    run('create_posts', input)
    const again = run('create_posts', input)
    expect(posts.listByDay('2026-09-28')).toHaveLength(1)
    expect(body(again)['already_scheduled']).toMatchObject([{ status: 'pending_approval' }])
  })

  it('tells the model, in the prompt and the tool descriptions, that posts wait for approval', () => {
    const { tools } = setup()
    expect(SYSTEM).toContain("Every post you create or change waits for the user's approval")
    expect(SYSTEM).toContain("You can't approve posts")
    expect(SYSTEM).toContain('Never say a post is scheduled')
    const described = (name: string) => tools.find((t) => t.name === name)!.description
    expect(described('create_posts')).toContain('waiting for their approval')
    expect(described('update_post')).toContain('approve it again')
    expect(described('reschedule_post')).toContain('approve it again')
  })
})
