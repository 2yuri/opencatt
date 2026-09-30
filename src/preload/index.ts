import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import {
  IpcChannel,
  IpcEvent,
  type AgentEvent,
  type AuthStatus,
  type AutopilotChanged,
  type ChatSessionsChanged,
  type MediaProgressEvent,
  type OpenCatApi,
  type PostsChangedEvent,
  type VoiceChanged
} from '@shared/api'
import { untagAuthError } from '@shared/authErrors'

const api: OpenCatApi = {
  ping: () => ipcRenderer.invoke(IpcChannel.Ping),
  locale: {
    weekStart: () => ipcRenderer.invoke(IpcChannel.LocaleWeekStart)
  },
  posts: {
    create: (post) => ipcRenderer.invoke(IpcChannel.PostsCreate, post),
    get: (id) => ipcRenderer.invoke(IpcChannel.PostsGet, id),
    withMedia: (id) => ipcRenderer.invoke(IpcChannel.PostsWithMedia, id),
    listByDay: (date, accountId) => ipcRenderer.invoke(IpcChannel.PostsListByDay, date, accountId),
    listRange: (from, to, accountId) =>
      ipcRenderer.invoke(IpcChannel.PostsListRange, from, to, accountId),
    listPending: (accountId) => ipcRenderer.invoke(IpcChannel.PostsListPending, accountId),
    listByStatus: (status, accountId) =>
      ipcRenderer.invoke(IpcChannel.PostsListByStatus, status, accountId),
    countsByDay: (from, to, accountId) =>
      ipcRenderer.invoke(IpcChannel.PostsCountsByDay, from, to, accountId),
    update: (id, patch) => ipcRenderer.invoke(IpcChannel.PostsUpdate, id, patch),
    reschedule: (id, scheduledAt) =>
      ipcRenderer.invoke(IpcChannel.PostsReschedule, id, scheduledAt),
    delete: (id) => ipcRenderer.invoke(IpcChannel.PostsDelete, id),
    approve: (id, scheduledAt) => ipcRenderer.invoke(IpcChannel.PostsApprove, id, scheduledAt),
    reject: (id) => ipcRenderer.invoke(IpcChannel.PostsReject, id),
    pending: (accountId) => ipcRenderer.invoke(IpcChannel.PostsPending, accountId),
    pendingByAccount: () => ipcRenderer.invoke(IpcChannel.PostsPendingByAccount),
    onChanged: (listener) => {
      const handler = (_e: IpcRendererEvent, event: PostsChangedEvent): void => listener(event)
      ipcRenderer.on(IpcEvent.PostsChanged, handler)
      return () => ipcRenderer.off(IpcEvent.PostsChanged, handler)
    }
  },
  settings: {
    get: (key) => ipcRenderer.invoke(IpcChannel.SettingsGet, key),
    set: (key, value) => ipcRenderer.invoke(IpcChannel.SettingsSet, key, value)
  },
  chat: {
    list: () => ipcRenderer.invoke(IpcChannel.ChatList),
    clear: () => ipcRenderer.invoke(IpcChannel.ChatClear),
    sessions: {
      list: (accountId) => ipcRenderer.invoke(IpcChannel.ChatSessionsList, accountId),
      create: (accountId) => ipcRenderer.invoke(IpcChannel.ChatSessionsCreate, accountId),
      rename: (id, title) => ipcRenderer.invoke(IpcChannel.ChatSessionsRename, id, title),
      delete: (id) => ipcRenderer.invoke(IpcChannel.ChatSessionsDelete, id),
      setActive: (id) => ipcRenderer.invoke(IpcChannel.ChatSessionsSetActive, id),
      onChanged: (listener) => {
        const handler = (_e: IpcRendererEvent, event: ChatSessionsChanged): void => listener(event)
        ipcRenderer.on(IpcEvent.ChatSessionsChanged, handler)
        return () => ipcRenderer.off(IpcEvent.ChatSessionsChanged, handler)
      }
    }
  },
  agent: {
    send: (text, mediaIds, mode, videoSeconds) =>
      ipcRenderer.invoke(IpcChannel.AgentSend, text, mediaIds, mode, videoSeconds),
    capabilities: () => ipcRenderer.invoke(IpcChannel.AgentCapabilities),
    retry: () => ipcRenderer.invoke(IpcChannel.AgentRetry),
    cancel: () => ipcRenderer.invoke(IpcChannel.AgentCancel),
    running: () => ipcRenderer.invoke(IpcChannel.AgentRunning),
    onEvent: (listener) => {
      const handler = (_e: IpcRendererEvent, event: AgentEvent): void => listener(event)
      ipcRenderer.on(IpcEvent.Agent, handler)
      return () => ipcRenderer.off(IpcEvent.Agent, handler)
    },
    status: () => ipcRenderer.invoke(IpcChannel.AgentStatus),
    setKey: (key) => ipcRenderer.invoke(IpcChannel.AgentSetKey, key),
    clearKey: () => ipcRenderer.invoke(IpcChannel.AgentClearKey),
    setModel: (model) => ipcRenderer.invoke(IpcChannel.AgentSetModel, model),
    setSendImages: (on) => ipcRenderer.invoke(IpcChannel.AgentSetSendImages, on),
    setProvider: (provider) => ipcRenderer.invoke(IpcChannel.AgentSetProvider, provider),
    recheck: () => ipcRenderer.invoke(IpcChannel.AgentRecheck)
  },
  video: {
    getPrePrompt: () => ipcRenderer.invoke(IpcChannel.VideoPrePromptGet),
    setPrePrompt: (text) => ipcRenderer.invoke(IpcChannel.VideoPrePromptSet, text),
    resetPrePrompt: () => ipcRenderer.invoke(IpcChannel.VideoPrePromptReset)
  },
  comments: {
    estimate: () => ipcRenderer.invoke(IpcChannel.CommentsEstimate),
    refresh: () => ipcRenderer.invoke(IpcChannel.CommentsRefresh),
    list: () => ipcRenderer.invoke(IpcChannel.CommentsList),
    lastRefresh: () => ipcRenderer.invoke(IpcChannel.CommentsLastRefresh),
    markRead: (remoteIds) => ipcRenderer.invoke(IpcChannel.CommentsMarkRead, remoteIds),
    reply: (remoteId, reply) => ipcRenderer.invoke(IpcChannel.CommentsReply, remoteId, reply),
    onChanged: (listener) => {
      const handler = (_e: IpcRendererEvent, event: { accountId: string | null }): void =>
        listener(event)
      ipcRenderer.on(IpcEvent.CommentsChanged, handler)
      return () => ipcRenderer.off(IpcEvent.CommentsChanged, handler)
    }
  },
  stats: {
    estimate: () => ipcRenderer.invoke(IpcChannel.StatsEstimate),
    sync: () => ipcRenderer.invoke(IpcChannel.StatsSync),
    list: () => ipcRenderer.invoke(IpcChannel.StatsList),
    totals: () => ipcRenderer.invoke(IpcChannel.StatsTotals),
    lastSync: () => ipcRenderer.invoke(IpcChannel.StatsLastSync),
    history: () => ipcRenderer.invoke(IpcChannel.StatsHistory),
    filter: {
      get: () => ipcRenderer.invoke(IpcChannel.StatsFilterGet),
      set: (filter) => ipcRenderer.invoke(IpcChannel.StatsFilterSet, filter)
    },
    onChanged: (listener) => {
      const handler = (_e: IpcRendererEvent, event: { accountId: string | null }): void =>
        listener(event)
      ipcRenderer.on(IpcEvent.StatsChanged, handler)
      return () => ipcRenderer.off(IpcEvent.StatsChanged, handler)
    },
    prices: {
      get: () => ipcRenderer.invoke(IpcChannel.StatsPricesGet),
      set: (prices) => ipcRenderer.invoke(IpcChannel.StatsPricesSet, prices),
      reset: () => ipcRenderer.invoke(IpcChannel.StatsPricesReset)
    }
  },
  autopilot: {
    get: (accountId) => ipcRenderer.invoke(IpcChannel.AutopilotGet, accountId),
    set: (accountId, on) => ipcRenderer.invoke(IpcChannel.AutopilotSet, accountId, on),
    onChanged: (listener) => {
      const handler = (_e: IpcRendererEvent, event: AutopilotChanged): void => listener(event)
      ipcRenderer.on(IpcEvent.AutopilotChanged, handler)
      return () => ipcRenderer.off(IpcEvent.AutopilotChanged, handler)
    }
  },
  voice: {
    get: (accountId) => ipcRenderer.invoke(IpcChannel.VoiceGet, accountId),
    set: (accountId, patch) => ipcRenderer.invoke(IpcChannel.VoiceSet, accountId, patch),
    onChanged: (listener) => {
      const handler = (_e: IpcRendererEvent, event: VoiceChanged): void => listener(event)
      ipcRenderer.on(IpcEvent.VoiceChanged, handler)
      return () => ipcRenderer.off(IpcEvent.VoiceChanged, handler)
    },
    getWritingPrompt: () => ipcRenderer.invoke(IpcChannel.WritingPromptGet),
    setWritingPrompt: (text) => ipcRenderer.invoke(IpcChannel.WritingPromptSet, text),
    resetWritingPrompt: () => ipcRenderer.invoke(IpcChannel.WritingPromptReset)
  },
  mcp: {
    status: () => ipcRenderer.invoke(IpcChannel.McpStatus),
    setEnabled: (enabled) => ipcRenderer.invoke(IpcChannel.McpSetEnabled, enabled),
    regenerateToken: () => ipcRenderer.invoke(IpcChannel.McpRegenerateToken)
  },
  media: {
    import: (paths) => ipcRenderer.invoke(IpcChannel.MediaImport, paths),
    pick: () => ipcRenderer.invoke(IpcChannel.MediaPick),
    discard: (id) => ipcRenderer.invoke(IpcChannel.MediaDiscard, id),
    saveAs: (id) => ipcRenderer.invoke(IpcChannel.MediaSaveAs, id),
    pathForFile: (file) => webUtils.getPathForFile(file),
    savePasted: (data, type) => ipcRenderer.invoke(IpcChannel.MediaSavePasted, data, type),
    cancelImport: () => ipcRenderer.invoke(IpcChannel.MediaCancelImport),
    onProgress: (listener) => {
      const handler = (_e: IpcRendererEvent, event: MediaProgressEvent): void => listener(event)
      ipcRenderer.on(IpcEvent.MediaProgress, handler)
      return () => ipcRenderer.off(IpcEvent.MediaProgress, handler)
    }
  },
  onboarding: {
    status: () => ipcRenderer.invoke(IpcChannel.OnboardingStatus),
    saveClientId: (clientId) => ipcRenderer.invoke(IpcChannel.OnboardingSaveClientId, clientId),
    saveOAuth1Keys: (keys) => ipcRenderer.invoke(IpcChannel.OnboardingSaveOAuth1Keys, keys),
    complete: () => ipcRenderer.invoke(IpcChannel.OnboardingComplete)
  },
  auth: {
    connect: () =>
      ipcRenderer.invoke(IpcChannel.AuthConnect).catch((err: unknown) => {
        throw untagAuthError(err)
      }),
    status: () => ipcRenderer.invoke(IpcChannel.AuthStatus),
    setActive: (accountId) => ipcRenderer.invoke(IpcChannel.AuthSetActive, accountId),
    disconnect: (accountId) => ipcRenderer.invoke(IpcChannel.AuthDisconnect, accountId),
    onChanged: (listener) => {
      const handler = (_e: IpcRendererEvent, status: AuthStatus): void => listener(status)
      ipcRenderer.on(IpcEvent.AuthChanged, handler)
      return () => ipcRenderer.off(IpcEvent.AuthChanged, handler)
    }
  },
  app: {
    getOpenAtLogin: () => ipcRenderer.invoke(IpcChannel.AppGetOpenAtLogin),
    setOpenAtLogin: (openAtLogin) => ipcRenderer.invoke(IpcChannel.AppSetOpenAtLogin, openAtLogin)
  }
}

contextBridge.exposeInMainWorld('opencat', api)
