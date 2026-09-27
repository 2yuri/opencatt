import { vi } from 'vitest'
import type {
  AgentEvent,
  AgentStatus,
  AuthStatus,
  McpStatus,
  ChatMessage,
  JsonValue,
  MediaProgressEvent,
  OpenCatApi,
  Post,
  PostMedia,
  PostsChangedEvent,
  VoiceChanged,
  VoiceProfile,
  WritingPrompt,
  XAccount
} from '@shared/api'
import { singlePart } from './parts'

type AgentEventInput = AgentEvent extends infer E
  ? E extends AgentEvent
    ? Omit<E, 'accountId' | 'sessionId'> & { accountId?: string | null; sessionId?: string | null }
    : never
  : never

export interface FakeApi {
  api: OpenCatApi
  /** Sends an agent event to the renderer, as main would. */
  /** accountId defaults to null, the conversation from before any account. */
  emit(event: AgentEventInput): void
  /** Tells the renderer posts changed, as main would. */
  changed(event: PostsChangedEvent): void
  /** Reports video conversion progress, as main would. */
  progress(event: MediaProgressEvent): void
  posts: Map<string, Post>
  settings: Map<string, JsonValue>
  /** What agent.status answers; tests change it. */
  agentStatus: AgentStatus
  /** What auth.status answers: no accounts until a test adds some. */
  authStatus: AuthStatus
  /** Changes auth.status and tells the renderer, as main does on connect, switch or sign-out. */
  authChanged(change: Partial<AuthStatus>): void
  /** What posts.pendingByAccount answers. */
  pendingByAccount: Record<string, number>
  /** Saved voices by account id; voice.get answers the defaults for the rest. */
  voices: Map<string, VoiceProfile>
  /** Tells the renderer a voice was saved elsewhere, as main does. */
  voiceChanged(accountId: string, profile: VoiceProfile): void
  /** The writing guide and Video mode's prompt, as main keeps them. */
  prompts: { writing: WritingPrompt; video: WritingPrompt }
}

/** A voice with main's defaults, and any fields given. */
export function voiceProfile(fields: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    description: '',
    examples: [],
    language: 'auto',
    emoji: false,
    hashtags: false,
    images: 'ask',
    ...fields
  }
}

export const DEFAULT_WRITING_GUIDE = 'Write for X, not a blog.'
export const DEFAULT_VIDEO_PROMPT = 'Make a {duration}-second showreel for this post.'

/** A signed-in X account; the handle doubles as its id. */
export function xAccount(handle: string, fields: Partial<XAccount> = {}): XAccount {
  return {
    id: handle,
    handle,
    name: null,
    avatarUrl: null,
    mode: 'oauth2',
    needsReconnect: false,
    ...fields
  }
}

let nextId = 0

let mediaId = 0

/** A file as media.import returns it; a .mp4 name makes a video. */
export function media(name: string): PostMedia {
  const video = name.endsWith('.mp4')
  return {
    id: `media-${++mediaId}`,
    kind: video ? 'video' : 'image',
    mime: video ? 'video/mp4' : 'image/png',
    bytes: video ? 12 * 1024 * 1024 : 200 * 1024,
    width: video ? null : 1200,
    height: video ? null : 800,
    durationMs: video ? 24_000 : null,
    alt: null,
    url: `opencat-media://${name}`
  }
}

export function chatMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id: `m${++nextId}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    via: null,
    media: [],
    accountId: null,
    mode: 'text',
    preface: null,
    sessionId: null
  }
}

export function post(fields: Partial<Post> & Pick<Post, 'id' | 'text' | 'scheduledAt'>): Post {
  const base: Omit<Post, 'parts'> & { parts?: Post['parts'] } = {
    accountId: null,
    nextAttemptAt: null,
    createdBy: 'user',
    status: 'scheduled',
    postedAt: null,
    remoteId: null,
    remoteUrl: null,
    error: null,
    errorCode: null,
    createdAt: fields.scheduledAt,
    updatedAt: fields.scheduledAt,
    ...fields
  }
  return { ...base, parts: base.parts ?? singlePart(base) }
}

/** A window.opencat backed by maps, with agent and posts events the test drives. */
export function fakeApi(history: ChatMessage[] = []): FakeApi {
  const agentStatus: AgentStatus = {
    hasKey: true,
    canStoreKey: true,
    model: 'claude-opus-5',
    models: [
      { id: 'claude-opus-5', label: 'Claude Opus 5, best results' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5, cheaper' }
    ],
    provider: 'api',
    providerChosen: false,
    cli: { found: false, path: null, version: null, loggedIn: false, plan: null, error: null },
    ready: true,
    sendImages: true
  }
  // ready follows the rest, as main works it out.
  const status = (): Promise<AgentStatus> =>
    Promise.resolve({
      ...agentStatus,
      cli: { ...agentStatus.cli },
      ready:
        agentStatus.provider === 'cli'
          ? agentStatus.cli.found && agentStatus.cli.loggedIn
          : agentStatus.hasKey
    })
  const mcpStatus: McpStatus & { tokenVersion: number } = {
    enabled: false,
    running: false,
    error: null,
    tokenVersion: 1
  }
  const agentListeners = new Set<(e: AgentEvent) => void>()
  const postListeners = new Set<(e: PostsChangedEvent) => void>()
  const progressListeners = new Set<(e: MediaProgressEvent) => void>()
  const authListeners = new Set<(s: AuthStatus) => void>()
  const authStatus: AuthStatus = { accounts: [], activeAccountId: null, secureStorage: true }
  const authChanged = (change: Partial<AuthStatus>): void => {
    Object.assign(authStatus, change)
    authListeners.forEach((l) => l({ ...authStatus }))
  }
  const pendingByAccount: Record<string, number> = {}
  const posts = new Map<string, Post>()
  const settings = new Map<string, JsonValue>()
  const voices = new Map<string, VoiceProfile>()
  const voiceListeners = new Set<(e: VoiceChanged) => void>()
  const voiceChanged = (accountId: string, profile: VoiceProfile): void =>
    voiceListeners.forEach((l) => l({ accountId, profile: { ...profile } }))
  const prompts = {
    writing: { text: DEFAULT_WRITING_GUIDE, isDefault: true },
    video: { text: DEFAULT_VIDEO_PROMPT, isDefault: true }
  }
  // Like main: an empty text or one over the limit is refused with a plain message.
  const prompt = (which: 'writing' | 'video', fallback: string, limit: number) => ({
    get: vi.fn(() => Promise.resolve({ ...prompts[which] })),
    set: vi.fn((text: string) => {
      if (text.trim() === '') return Promise.reject(new Error('The text is empty.'))
      if (text.length > limit) return Promise.reject(new Error('The text is too long.'))
      prompts[which] = { text, isDefault: text === fallback }
      return Promise.resolve({ ...prompts[which] })
    }),
    reset: vi.fn(() => {
      prompts[which] = { text: fallback, isDefault: true }
      return Promise.resolve({ ...prompts[which] })
    })
  })
  const writing = prompt('writing', DEFAULT_WRITING_GUIDE, 20_000)
  const video = prompt('video', DEFAULT_VIDEO_PROMPT, 4_000)

  const api = {
    ping: vi.fn().mockResolvedValue({ message: 'pong', electron: '44.0.0', platform: 'linux' }),
    locale: { weekStart: vi.fn().mockResolvedValue(1) },
    app: {
      getOpenAtLogin: vi.fn().mockResolvedValue(false),
      setOpenAtLogin: vi.fn().mockResolvedValue(undefined)
    },
    posts: {
      get: vi.fn((id: string) => Promise.resolve(posts.get(id) ?? null)),
      withMedia: vi.fn((mediaId: string) =>
        Promise.resolve(
          [...posts.values()].find((p) =>
            p.parts.some((part) => part.media.some((m) => m.id === mediaId))
          ) ?? null
        )
      ),
      pending: vi.fn(() => Promise.resolve({ count: 0, first: null })),
      pendingByAccount: vi.fn(() => Promise.resolve({ ...pendingByAccount })),
      // Like main: the post becomes scheduled, at the new time when given, and listeners hear it.
      approve: vi.fn((id: string, scheduledAt?: string) => {
        const found = posts.get(id)
        if (!found) return Promise.reject(new Error(`No post with id ${id}`))
        const approved: Post = {
          ...found,
          status: 'scheduled',
          scheduledAt: scheduledAt ?? found.scheduledAt
        }
        posts.set(id, approved)
        postListeners.forEach((l) => l({ ids: [id] }))
        return Promise.resolve(approved)
      }),
      onChanged: (listener: (e: PostsChangedEvent) => void) => {
        postListeners.add(listener)
        return () => postListeners.delete(listener)
      }
    },
    auth: {
      status: vi.fn(() => Promise.resolve({ ...authStatus })),
      // Like main: switching answers with the new status and tells every window.
      setActive: vi.fn((accountId: string) => {
        authChanged({ activeAccountId: accountId })
        return Promise.resolve({ ...authStatus })
      }),
      connect: vi.fn(() => Promise.reject(new Error('No X sign-in in tests'))),
      disconnect: vi.fn(() => Promise.resolve({ ...authStatus })),
      onChanged: (listener: (s: AuthStatus) => void) => {
        authListeners.add(listener)
        return () => authListeners.delete(listener)
      }
    },
    settings: {
      get: vi.fn((key: string) => Promise.resolve(settings.get(key) ?? null)),
      set: vi.fn((key: string, value: JsonValue) => {
        settings.set(key, value)
        return Promise.resolve()
      })
    },
    voice: {
      get: vi.fn((accountId: string) =>
        Promise.resolve({ ...(voices.get(accountId) ?? voiceProfile()) })
      ),
      // Like main: saves the given fields and tells every window.
      set: vi.fn((accountId: string, patch: Partial<VoiceProfile>) => {
        const next = { ...(voices.get(accountId) ?? voiceProfile()), ...patch }
        voices.set(accountId, next)
        voiceChanged(accountId, next)
        return Promise.resolve({ ...next })
      }),
      onChanged: (listener: (e: VoiceChanged) => void) => {
        voiceListeners.add(listener)
        return () => voiceListeners.delete(listener)
      },
      getWritingPrompt: writing.get,
      setWritingPrompt: writing.set,
      resetWritingPrompt: writing.reset
    },
    video: {
      getPrePrompt: video.get,
      setPrePrompt: video.set,
      resetPrePrompt: video.reset
    },
    chat: {
      list: vi.fn(() => Promise.resolve(history)),
      clear: vi.fn(() => Promise.resolve()),
      sessions: {
        list: vi.fn(() => Promise.resolve([])),
        create: vi.fn(() => Promise.reject(new Error('not faked'))),
        rename: vi.fn(() => Promise.reject(new Error('not faked'))),
        delete: vi.fn(() => Promise.resolve()),
        setActive: vi.fn(() => Promise.reject(new Error('not faked'))),
        onChanged: vi.fn(() => () => {})
      }
    },
    agent: {
      send: vi.fn(() => Promise.resolve({ turnId: 't1' })),
      retry: vi.fn(() => Promise.resolve({ turnId: 't2' })),
      cancel: vi.fn(() => Promise.resolve()),
      onEvent: (listener: (e: AgentEvent) => void) => {
        agentListeners.add(listener)
        return () => agentListeners.delete(listener)
      },
      status: vi.fn(status),
      setKey: vi.fn((key: string) => {
        if (key !== 'sk-good') {
          return Promise.reject(
            new Error(
              "Error invoking remote method 'agent:setKey': AgentError: Anthropic refused the API key."
            )
          )
        }
        agentStatus.hasKey = true
        return status()
      }),
      clearKey: vi.fn(() => {
        agentStatus.hasKey = false
        return status()
      }),
      setProvider: vi.fn((provider: AgentStatus['provider']) => {
        agentStatus.provider = provider
        agentStatus.providerChosen = true
        return status()
      }),
      recheck: vi.fn(status),
      capabilities: vi.fn(() => Promise.resolve({ videoUnavailable: null as string | null })),
      setModel: vi.fn((model: string) => {
        agentStatus.model = model
        return status()
      }),
      setSendImages: vi.fn((on: boolean) => {
        agentStatus.sendImages = on
        return status()
      })
    },
    mcp: {
      status: vi.fn(() => Promise.resolve({ ...mcpStatus })),
      setEnabled: vi.fn((enabled: boolean) => {
        Object.assign(
          mcpStatus,
          enabled
            ? {
                enabled: true,
                running: true,
                claudeCode: `claude mcp add --transport http opencat http://127.0.0.1:47824/mcp --header "Authorization: Bearer tok-${mcpStatus.tokenVersion}"`,
                claudeDesktop: '{ "mcpServers": { "opencat": {} } }'
              }
            : { enabled: false, running: false, claudeCode: undefined, claudeDesktop: undefined }
        )
        return Promise.resolve({ ...mcpStatus })
      }),
      regenerateToken: vi.fn(() => {
        mcpStatus.tokenVersion++
        mcpStatus.claudeCode = mcpStatus.claudeCode?.replace(
          /tok-\d+/,
          `tok-${mcpStatus.tokenVersion}`
        )
        return Promise.resolve({ ...mcpStatus })
      })
    },
    media: {
      import: vi.fn((paths: string[]) =>
        Promise.resolve(paths.map((path) => media(path.split('/').pop() ?? path)))
      ),
      pick: vi.fn(() => Promise.resolve([media('picked.png')])),
      discard: vi.fn(() => Promise.resolve()),
      saveAs: vi.fn(() => Promise.resolve(true)),
      pathForFile: vi.fn((file: File) => `/Users/me/${file.name}`),
      savePasted: vi.fn((_data: Uint8Array, type: string) =>
        Promise.resolve(`/tmp/pasted/clip.${type.split('/')[1]}`)
      ),
      cancelImport: vi.fn(() => Promise.resolve()),
      onProgress: vi.fn((listener: (e: MediaProgressEvent) => void) => {
        progressListeners.add(listener)
        return () => progressListeners.delete(listener)
      })
    }
  } as unknown as OpenCatApi

  return {
    api,
    posts,
    settings,
    agentStatus,
    authStatus,
    authChanged,
    pendingByAccount,
    voices,
    voiceChanged,
    prompts,
    emit: (event) =>
      agentListeners.forEach((l) =>
        l({ accountId: null, sessionId: null, ...event } as AgentEvent)
      ),
    changed: (event) => postListeners.forEach((l) => l(event)),
    progress: (event) => progressListeners.forEach((l) => l(event))
  }
}
