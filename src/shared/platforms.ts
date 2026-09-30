// The package's ESM build has only a default export, whatever its types say.
import twitter from 'twitter-text'

/**
 * What each platform lets a post be (OP-118). This is the only place a platform's limits are
 * written: PostsService, the publisher, the editor, the agent and the MCP tools all read them here,
 * so they can't disagree.
 */
export type Platform = 'x' | 'tiktok'

export const PLATFORMS: readonly Platform[] = ['x', 'tiktok']

/**
 * How a platform counts text. X weighs it (a link is 23, most emoji and CJK characters 2);
 * TikTok counts UTF-16 code units.
 */
export type TextCounting = 'x-weighted' | 'utf16'

export interface VideoRules {
  /** File extensions the platform takes, lower case without the dot. */
  formats: readonly string[]
  maxBytes: number
  /** The platform's usual maximum; an account may be allowed another (see AccountLimits). */
  maxSeconds: number
  minSeconds: number
  /** Width divided by height; null when the platform takes any shape. */
  minAspect: number | null
  maxAspect: number | null
  /** The size the agent renders a video at when nobody asks for another (render_video, OP-122). */
  renderSize: { width: number; height: number }
}

export interface PlatformRules {
  platform: Platform
  /** How the app names it to the user. */
  name: string
  /** What the user writes is called this on the platform. */
  textName: 'post' | 'caption'
  maxText: number
  counting: TextCounting
  /** Parts a post may have; more than one is a thread. */
  maxParts: number
  /** A post may have text and no media. */
  textOnly: boolean
  /** A post may carry images (without a video). */
  images: boolean
  /** A post may carry a GIF. */
  gif: boolean
  /** Every post needs exactly one video. */
  videoRequired: boolean
  maxImages: number
  video: VideoRules
  /** Reading the account's stats costs money, so the Dashboard asks before a refresh. */
  paidStats: boolean
  /** Whether OpenCatt can publish to it yet: a post for a platform that can't fails, unretried. */
  publishes: boolean
  /** Whether OpenCatt reads its stats yet. */
  stats: boolean
}

const MB = 1024 * 1024

export const PLATFORM_RULES: Readonly<Record<Platform, PlatformRules>> = {
  x: {
    platform: 'x',
    name: 'X',
    textName: 'post',
    maxText: 280,
    counting: 'x-weighted',
    maxParts: 25,
    textOnly: true,
    images: true,
    gif: true,
    videoRequired: false,
    maxImages: 4,
    video: {
      formats: ['mp4', 'mov'],
      maxBytes: 512 * MB,
      maxSeconds: 140,
      minSeconds: 0.5,
      minAspect: 1 / 3,
      maxAspect: 3,
      renderSize: { width: 1280, height: 720 }
    },
    paidStats: true,
    publishes: true,
    stats: true
  },
  tiktok: {
    platform: 'tiktok',
    name: 'TikTok',
    textName: 'caption',
    maxText: 2200,
    counting: 'utf16',
    maxParts: 1,
    textOnly: false,
    // Photo posts need PULL_FROM_URL from a verified domain, which a local app doesn't have.
    images: false,
    gif: false,
    videoRequired: true,
    maxImages: 0,
    video: {
      formats: ['mp4', 'mov', 'webm'],
      maxBytes: 4096 * MB,
      maxSeconds: 600,
      minSeconds: 3,
      minAspect: null,
      maxAspect: null,
      // Vertical full screen, what TikTok shows best.
      renderSize: { width: 1080, height: 1920 }
    },
    paidStats: false,
    // OP-120 and OP-121 turn these on.
    publishes: false,
    stats: false
  }
}

/** What one account may do beyond its platform's usual rules, e.g. TikTok's creator_info. */
export interface AccountLimits {
  maxVideoSeconds?: number
}

export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value)
}

/** The rules for one account: its platform's, with anything the platform told us about it. */
export function rulesFor(platform: Platform, limits: AccountLimits | null = null): PlatformRules {
  const rules = PLATFORM_RULES[platform]
  if (!limits?.maxVideoSeconds) return rules
  return { ...rules, video: { ...rules.video, maxSeconds: limits.maxVideoSeconds } }
}

/** The text's length the way the platform counts it. */
export function textLength(rules: PlatformRules, text: string): number {
  return rules.counting === 'x-weighted' ? twitter.parseTweet(text).weightedLength : text.length
}

export type MediaKind = 'image' | 'gif' | 'video'

/**
 * Why this media can't go on one part of a post on this platform, or null when it can. Worded to
 * follow "Part 2: ", without a full stop.
 */
export function mediaProblem(rules: PlatformRules, kinds: readonly MediaKind[]): string | null {
  const images = kinds.filter((k) => k === 'image').length
  const gifs = kinds.filter((k) => k === 'gif').length
  const videos = kinds.filter((k) => k === 'video').length
  if (images > 0 && !rules.images) return `${rules.name} posts can't have images here, only a video`
  if (gifs > 0 && !rules.gif) return `${rules.name} doesn't take GIFs. Use a video`
  if (rules.videoRequired && videos === 0) return `a ${rules.name} post needs a video`
  if (kinds.length > 1 && images < kinds.length) {
    return 'a GIF or video has to be the only media in its post'
  }
  if (images > rules.maxImages)
    return `${rules.name} allows up to ${rules.maxImages} images per post`
  return null
}
