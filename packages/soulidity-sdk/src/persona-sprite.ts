import {
  buildCanonicalSoulMetadata,
  type Mood,
  type SpriteAnimation,
} from './metadata'

const LEGACY_ANIMATION_BY_MOOD: Record<Mood, string> = {
  idle: 'idle',
  happy: 'completed',
  love: 'idle',
  excited: 'thinking',
  celebrate: 'completed',
  sleepy: 'idle',
  snoring: 'error',
  working: 'working',
  angry: 'error',
  surprised: 'needs-attention',
  shy: 'idle',
  dragging: 'dragging',
}

const PUBLIC_SPRITE_CONFIG_FILE_NAME = 'persona-sprite-config.json'
export const PERSONA_SPRITE_PAIR_ERROR = 'Upload both persona sprite sheet and sprite config, or leave both empty.'
export const PERSONA_SPRITE_CONFIG_ERROR = 'Persona sprite config JSON is invalid.'

export type PersonaSpriteVisibility = 'public' | 'private'

export interface PersonaSpriteConfig {
  src?: string
  frameWidth: number
  frameHeight: number
  columns: number
  animations: Record<string, SpriteAnimation>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeAnimation(value: unknown): SpriteAnimation | null {
  if (!isRecord(value)) {
    return null
  }

  const frames = Array.isArray(value.frames)
    ? value.frames.filter((frame): frame is number => Number.isInteger(frame) && frame >= 0)
    : []
  const fps = typeof value.fps === 'number' && Number.isFinite(value.fps) && value.fps > 0
    ? value.fps
    : null
  const loop = typeof value.loop === 'boolean' ? value.loop : null

  if (frames.length === 0 || fps == null || loop == null) {
    return null
  }

  return { frames, fps, loop }
}

function normalizeAnimations(value: unknown): Record<string, SpriteAnimation> | null {
  if (!isRecord(value)) {
    return null
  }

  const animations: Record<string, SpriteAnimation> = {}
  for (const [name, raw] of Object.entries(value)) {
    const animation = normalizeAnimation(raw)
    const trimmedName = name.trim()
    if (!trimmedName || !animation) {
      continue
    }
    animations[trimmedName] = animation
  }

  return Object.keys(animations).length > 0 ? animations : null
}

export function parsePersonaSpriteConfig(raw: string): PersonaSpriteConfig | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
      return null
    }

    const frameWidth = typeof parsed.frameWidth === 'number' && Number.isFinite(parsed.frameWidth) && parsed.frameWidth > 0
      ? parsed.frameWidth
      : null
    const frameHeight = typeof parsed.frameHeight === 'number' && Number.isFinite(parsed.frameHeight) && parsed.frameHeight > 0
      ? parsed.frameHeight
      : null
    const columns = typeof parsed.columns === 'number' && Number.isInteger(parsed.columns) && parsed.columns > 0
      ? parsed.columns
      : null
    const animations = normalizeAnimations(parsed.animations)
    const src = typeof parsed.src === 'string' && parsed.src.trim().length > 0 ? parsed.src.trim() : undefined

    if (frameWidth == null || frameHeight == null || columns == null || !animations) {
      return null
    }

    return {
      src,
      frameWidth,
      frameHeight,
      columns,
      animations,
    }
  } catch {
    return null
  }
}

export async function validatePersonaSpriteDraft(params: {
  sheetFile?: Blob | null
  configFile?: Blob | null
}): Promise<
  | { ok: true; config: PersonaSpriteConfig | null }
  | { ok: false; error: string }
> {
  const hasSheet = Boolean(params.sheetFile)
  const hasConfig = Boolean(params.configFile)

  if (hasSheet !== hasConfig) {
    return { ok: false, error: PERSONA_SPRITE_PAIR_ERROR }
  }

  if (!params.sheetFile || !params.configFile) {
    return { ok: true, config: null }
  }

  const config = parsePersonaSpriteConfig(await params.configFile.text())
  if (!config) {
    return { ok: false, error: PERSONA_SPRITE_CONFIG_ERROR }
  }

  return { ok: true, config }
}

export function buildPersonaSpriteMoodMap(animations: Record<string, SpriteAnimation>) {
  const names = new Set(Object.keys(animations))
  const moodMap: Partial<Record<Mood, string>> = {}

  for (const [mood, legacyName] of Object.entries(LEGACY_ANIMATION_BY_MOOD) as Array<[Mood, string]>) {
    if (names.has(mood)) {
      moodMap[mood] = mood
      continue
    }
    if (names.has(legacyName)) {
      moodMap[mood] = legacyName
    }
  }

  return moodMap
}

export function buildPersonaSpriteMetadata(params: {
  config: PersonaSpriteConfig
  visibility: PersonaSpriteVisibility
  sheetUrl?: string | null
  versionIndex?: number
}) {
  const moodMap = buildPersonaSpriteMoodMap(params.config.animations)

  return buildCanonicalSoulMetadata({
    moodMap,
    ...(params.visibility === 'public'
      ? {
          publicAssets: {
            type: 'sprite-sheet' as const,
            sheetUrl: params.sheetUrl ?? '',
            frameWidth: params.config.frameWidth,
            frameHeight: params.config.frameHeight,
            columns: params.config.columns,
            animations: params.config.animations,
          },
        }
      : {
          protectedAssets: {
            versionIndex: params.versionIndex ?? 0,
            type: 'sprite-sheet' as const,
            frameWidth: params.config.frameWidth,
            frameHeight: params.config.frameHeight,
            columns: params.config.columns,
            animations: params.config.animations,
          },
        }),
  })
}

export function buildPersonaSpriteMetadataUploadFile(params: {
  config: PersonaSpriteConfig
  visibility: PersonaSpriteVisibility
  sheetUrl?: string | null
  versionIndex?: number
  fileName?: string
}) {
  const metadata = buildPersonaSpriteMetadata(params)
  const fileName = params.fileName?.trim() || PUBLIC_SPRITE_CONFIG_FILE_NAME
  const source = JSON.stringify(metadata, null, 2)
  return new File([source], fileName, { type: 'application/json' })
}
