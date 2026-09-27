import { MediaStore, type ImageProbe } from '../media/store'
import { AccountsStore } from './accounts'
import { XMediaStore } from './xMedia'
import { ChatStore } from './chat'
import { ChatSessionStore } from './chatSessions'
import { openDatabase, type Database } from './database'
import { PostsService } from './posts'
import { SettingsStore } from './settings'

export { PostRuleError, PostsService } from './posts'
export { SettingsStore } from './settings'
export { ChatStore } from './chat'
export { ChatSessionStore } from './chatSessions'
export { AccountsStore } from './accounts'
export { XMediaStore } from './xMedia'
export { MediaError, MediaStore } from '../media/store'

export interface Stores {
  db: Database
  posts: PostsService
  settings: SettingsStore
  chat: ChatStore
  chatSessions: ChatSessionStore
  media: MediaStore
  accounts: AccountsStore
  xMedia: XMediaStore
}

export function openStores(path: string, mediaDir: string, probe?: ImageProbe): Stores {
  const db = openDatabase(path)
  const media = new MediaStore(db, mediaDir, probe)
  const settings = new SettingsStore(db)
  return {
    db,
    posts: new PostsService(db, undefined, media),
    settings,
    chat: new ChatStore(db),
    chatSessions: new ChatSessionStore(db, settings),
    media,
    accounts: new AccountsStore(db),
    xMedia: new XMediaStore(db)
  }
}
