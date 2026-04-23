import type { SoulDownloadPolicy, SoulMetadataBindingRecord } from '@/lib/soulidity/types'

export type LegacyPersonaState =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'needs-attention'
  | 'completed'
  | 'error'
  | 'dragging'

export type Mood =
  | 'idle'
  | 'happy'
  | 'love'
  | 'excited'
  | 'celebrate'
  | 'sleepy'
  | 'snoring'
  | 'working'
  | 'angry'
  | 'surprised'
  | 'shy'
  | 'dragging'

export const ALL_MOODS: readonly Mood[] = [
  'idle',
  'happy',
  'love',
  'excited',
  'celebrate',
  'sleepy',
  'snoring',
  'working',
  'angry',
  'surprised',
  'shy',
  'dragging',
] as const

export const CANONICAL_PERSONA_SPRITE_ASSET_NAME = 'persona-sprite'

const LEGACY_STATE_BY_MOOD: Record<Mood, LegacyPersonaState> = {
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

const RENDERER_ANIMATION_BY_MOOD: Record<Mood, string> = {
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

export interface SpriteAnimation {
  frames: number[]
  fps: number
  loop: boolean
}

export interface SpriteSheetAssetBase {
  type: 'sprite-sheet'
  frameWidth: number
  frameHeight: number
  columns: number
  animations: Record<string, SpriteAnimation>
}

export interface PublicSpriteSheetAsset extends SpriteSheetAssetBase {
  sheetUrl: string
}

export interface ProtectedSpriteSheetAsset extends SpriteSheetAssetBase {
  assetName: string
  versionIndex: number
}

export type SpriteSheetAsset = PublicSpriteSheetAsset

type PersonaMetadataInput = {
  format: 'sprite-sheet' | 'live2d'
  moodMap?: Partial<Record<Mood, string>>
  stateMap?: Partial<Record<LegacyPersonaState, string>>
  publicAssets?: unknown
  protectedAssets?: unknown
}

export interface SoulMetadata {
  version: 1

  persona?: PersonaMetadataInput

  voice?: {
    format: 'clips' | 'tts-profile'
    clips?: Record<string, string>
    ttsProfile?: {
      provider: string
      voiceId: string
      config?: Record<string, unknown>
    }
  }

  extra?: Record<string, unknown>
}

export interface NormalizedSoulMetadata {
  version: 1
  persona?: {
    format: 'sprite-sheet' | 'live2d'
    moodMap: Partial<Record<Mood, string>>
    stateMap?: Partial<Record<LegacyPersonaState, string>>
    publicAssets?: unknown
    protectedAssets?: unknown
  }
  voice?: SoulMetadata['voice']
  extra?: Record<string, unknown>
}

export type SoulSpriteDownloadPolicy = SoulDownloadPolicy | 'missing' | 'invalid'

export interface ResolvedSoulSpriteContract {
  policy: SoulSpriteDownloadPolicy
  persona: NormalizedSoulMetadata['persona'] | null
  publicAssets: PublicSpriteSheetAsset | null
  protectedAssets: ProtectedSpriteSheetAsset | null
  issues: string[]
}

export interface DesktopSpriteSheetConfig {
  src: string
  frameWidth: number
  frameHeight: number
  columns: number
  animations: Record<string, SpriteAnimation>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asTrimmedString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizeMoodMap(persona: PersonaMetadataInput | null | undefined): Partial<Record<Mood, string>> {
  const normalized: Partial<Record<Mood, string>> = {}

  if (persona?.stateMap && isRecord(persona.stateMap)) {
    for (const mood of ALL_MOODS) {
      const legacyState = LEGACY_STATE_BY_MOOD[mood]
      const value = asTrimmedString(persona.stateMap[legacyState])
      if (value) {
        normalized[mood] = value
      }
    }
  }

  if (persona?.moodMap && isRecord(persona.moodMap)) {
    for (const mood of ALL_MOODS) {
      const value = asTrimmedString(persona.moodMap[mood])
      if (value) {
        normalized[mood] = value
      }
    }
  }

  return normalized
}

function normalizeSpriteAnimation(value: unknown): SpriteAnimation | null {
  if (!isRecord(value)) {
    return null
  }

  const frames = Array.isArray(value.frames)
    ? value.frames.filter((frame): frame is number =>
      Number.isInteger(frame) && frame >= 0)
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

function normalizeSpriteAnimations(value: unknown): Record<string, SpriteAnimation> | null {
  if (!isRecord(value)) {
    return null
  }

  const normalized: Record<string, SpriteAnimation> = {}
  for (const [name, rawAnimation] of Object.entries(value)) {
    const trimmedName = name.trim()
    const animation = normalizeSpriteAnimation(rawAnimation)
    if (!trimmedName || !animation) {
      continue
    }
    normalized[trimmedName] = animation
  }

  return Object.keys(normalized).length > 0 ? normalized : null
}

function normalizeSpriteSheetAssetBase(value: unknown): SpriteSheetAssetBase | null {
  if (!isRecord(value) || value.type !== 'sprite-sheet') {
    return null
  }

  const frameWidth = typeof value.frameWidth === 'number' && Number.isFinite(value.frameWidth) && value.frameWidth > 0
    ? value.frameWidth
    : null
  const frameHeight = typeof value.frameHeight === 'number' && Number.isFinite(value.frameHeight) && value.frameHeight > 0
    ? value.frameHeight
    : null
  const columns = typeof value.columns === 'number' && Number.isInteger(value.columns) && value.columns > 0
    ? value.columns
    : null
  const animations = normalizeSpriteAnimations(value.animations)

  if (frameWidth == null || frameHeight == null || columns == null || !animations) {
    return null
  }

  return {
    type: 'sprite-sheet',
    frameWidth,
    frameHeight,
    columns,
    animations,
  }
}

function normalizePublicSpriteSheetAsset(value: unknown): PublicSpriteSheetAsset | null {
  const asset = normalizeSpriteSheetAssetBase(value)
  const sheetUrl = isRecord(value) ? asTrimmedString(value.sheetUrl) : null
  if (!asset || !sheetUrl) {
    return null
  }

  return {
    ...asset,
    sheetUrl,
  }
}

function normalizeProtectedSpriteSheetAsset(value: unknown): ProtectedSpriteSheetAsset | null {
  const asset = normalizeSpriteSheetAssetBase(value)
  if (!asset || !isRecord(value)) {
    return null
  }

  const assetName = asTrimmedString(value.assetName)
  const versionIndex = typeof value.versionIndex === 'number' && Number.isInteger(value.versionIndex) && value.versionIndex >= 0
    ? value.versionIndex
    : null

  if (!assetName || versionIndex == null) {
    return null
  }

  return {
    ...asset,
    assetName,
    versionIndex,
  }
}

export function parseSoulMetadata(raw: string): NormalizedSoulMetadata | null {
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.version !== 1) return null
    return normalizeSoulMetadata(parsed as SoulMetadata)
  } catch {
    return null
  }
}

export function normalizeSoulMetadata(input: SoulMetadata | null | undefined): NormalizedSoulMetadata | null {
  if (!input || input.version !== 1) {
    return null
  }

  const persona = input.persona
  if (!persona || typeof persona.format !== 'string') {
    return {
      version: 1,
      voice: input.voice,
      extra: input.extra,
    }
  }

  return {
    version: 1,
    persona: {
      format: persona.format,
      moodMap: normalizeMoodMap(persona),
      stateMap: persona.stateMap,
      publicAssets: persona.publicAssets,
      protectedAssets: persona.protectedAssets,
    },
    voice: input.voice,
    extra: input.extra,
  }
}

export function resolveSoulSpriteContract(
  metadata: NormalizedSoulMetadata | null | undefined,
  options: {
    availableProtectedVersionIndexes?: number[] | null
  } = {},
): ResolvedSoulSpriteContract {
  const persona = metadata?.persona
  if (!persona || persona.format !== 'sprite-sheet') {
    return {
      policy: 'missing',
      persona: persona ?? null,
      publicAssets: null,
      protectedAssets: null,
      issues: ['persona.sprite-sheet metadata is missing'],
    }
  }

  const issues: string[] = []
  const publicAssets = normalizePublicSpriteSheetAsset(persona.publicAssets)
  const protectedAssets = normalizeProtectedSpriteSheetAsset(persona.protectedAssets)

  if (persona.publicAssets && !publicAssets) {
    issues.push('publicAssets is invalid')
  }

  if (persona.protectedAssets && !protectedAssets) {
    issues.push('protectedAssets is invalid')
  }

  if (!persona.publicAssets && !persona.protectedAssets) {
    issues.push('persona sprite asset is missing')
    return {
      policy: 'missing',
      persona,
      publicAssets: null,
      protectedAssets: null,
      issues,
    }
  }

  if (publicAssets && protectedAssets) {
    issues.push('persona cannot declare both publicAssets and protectedAssets')
    return {
      policy: 'invalid',
      persona,
      publicAssets,
      protectedAssets,
      issues,
    }
  }

  if (publicAssets) {
    return {
      policy: 'public',
      persona,
      publicAssets,
      protectedAssets: null,
      issues,
    }
  }

  if (!protectedAssets) {
    return {
      policy: 'invalid',
      persona,
      publicAssets: null,
      protectedAssets: null,
      issues,
    }
  }

  if (protectedAssets.assetName !== CANONICAL_PERSONA_SPRITE_ASSET_NAME) {
    issues.push(`protectedAssets.assetName must be ${CANONICAL_PERSONA_SPRITE_ASSET_NAME}`)
  }

  if (
    options.availableProtectedVersionIndexes
    && !options.availableProtectedVersionIndexes.includes(protectedAssets.versionIndex)
  ) {
    issues.push('protected sprite asset version is missing')
  }

  if (issues.length > 0) {
    return {
      policy: 'invalid',
      persona,
      publicAssets: null,
      protectedAssets,
      issues,
    }
  }

  return {
    policy: 'owner_only',
    persona,
    publicAssets: null,
    protectedAssets,
    issues,
  }
}

export function buildDesktopSpriteSheetConfig(
  contract: Pick<ResolvedSoulSpriteContract, 'policy' | 'persona' | 'publicAssets' | 'protectedAssets'>,
): DesktopSpriteSheetConfig | null {
  const asset = contract.publicAssets ?? contract.protectedAssets
  const moodMap = contract.persona?.moodMap ?? {}
  if (!asset) {
    return null
  }

  const animations: Record<string, SpriteAnimation> = {
    ...asset.animations,
  }

  for (const mood of ALL_MOODS) {
    const mappedAnimationName = moodMap[mood]
    const rendererAnimationName = RENDERER_ANIMATION_BY_MOOD[mood]
    if (!mappedAnimationName || animations[rendererAnimationName]) {
      continue
    }

    const mappedAnimation = asset.animations[mappedAnimationName]
    if (mappedAnimation) {
      animations[rendererAnimationName] = mappedAnimation
    }
  }

  if (!animations.idle) {
    const firstAnimation = Object.values(animations)[0]
    if (firstAnimation) {
      animations.idle = firstAnimation
    }
  }

  return {
    src: 'persona-sprite.png',
    frameWidth: asset.frameWidth,
    frameHeight: asset.frameHeight,
    columns: asset.columns,
    animations,
  }
}

export function buildCanonicalSoulMetadata(params: {
  moodMap: Partial<Record<Mood, string>>
  publicAssets?: PublicSpriteSheetAsset | null
  protectedAssets?: Omit<ProtectedSpriteSheetAsset, 'assetName'> & { assetName?: string } | null
  voice?: SoulMetadata['voice']
  extra?: Record<string, unknown>
}): NormalizedSoulMetadata {
  const protectedAssets = params.protectedAssets
    ? {
        ...params.protectedAssets,
        assetName: CANONICAL_PERSONA_SPRITE_ASSET_NAME,
      }
    : undefined

  return {
    version: 1,
    persona: {
      format: 'sprite-sheet',
      moodMap: normalizeMoodMap({
        format: 'sprite-sheet',
        moodMap: params.moodMap,
      }),
      ...(params.publicAssets ? { publicAssets: params.publicAssets } : {}),
      ...(protectedAssets ? { protectedAssets } : {}),
    },
    voice: params.voice,
    extra: params.extra,
  }
}

export interface MirroredSoulMetadataInput {
  metadataOnChainId: string | null
  activeSprite: SoulMetadataBindingRecord | null
  activeVoice?: SoulMetadataBindingRecord | null
  spriteConfigJson: string | null
  spriteMoodMapJson: string | null
  voiceConfigJson?: string | null
}

function parseSpriteConfigJson(raw: string | null | undefined): SpriteSheetAssetBase | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
      return null
    }
    return normalizeSpriteSheetAssetBase({
      type: 'sprite-sheet',
      ...parsed,
    })
  } catch {
    return null
  }
}

function buildFallbackMoodMap(animations: Record<string, SpriteAnimation>): Partial<Record<Mood, string>> {
  const names = new Set(Object.keys(animations))
  const moodMap: Partial<Record<Mood, string>> = {}

  for (const mood of ALL_MOODS) {
    const direct = names.has(mood) ? mood : null
    const legacy = names.has(LEGACY_STATE_BY_MOOD[mood]) ? LEGACY_STATE_BY_MOOD[mood] : null
    if (direct) {
      moodMap[mood] = direct
    } else if (legacy) {
      moodMap[mood] = legacy
    }
  }

  return moodMap
}

function parseMoodMapJson(
  raw: string | null | undefined,
  animations: Record<string, SpriteAnimation>,
): Partial<Record<Mood, string>> {
  if (!raw) {
    return buildFallbackMoodMap(animations)
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
      return buildFallbackMoodMap(animations)
    }
    return normalizeMoodMap({
      format: 'sprite-sheet',
      moodMap: parsed as Partial<Record<Mood, string>>,
    })
  } catch {
    return buildFallbackMoodMap(animations)
  }
}

export function resolveMirroredSoulSpriteContract(
  metadata: MirroredSoulMetadataInput,
  options: {
    publicAssetUrl?: string | null
    availableVersionIndexes?: number[] | null
  } = {},
): ResolvedSoulSpriteContract {
  if (!metadata.metadataOnChainId) {
    return {
      policy: 'missing',
      persona: null,
      publicAssets: null,
      protectedAssets: null,
      issues: ['soul metadata object is missing'],
    }
  }

  if (!metadata.activeSprite) {
    return {
      policy: 'missing',
      persona: null,
      publicAssets: null,
      protectedAssets: null,
      issues: ['active sprite binding is missing'],
    }
  }

  const issues: string[] = []
  const config = parseSpriteConfigJson(metadata.spriteConfigJson)
  if (!config) {
    return {
      policy: 'invalid',
      persona: null,
      publicAssets: null,
      protectedAssets: null,
      issues: ['sprite.config.v1 is missing or invalid'],
    }
  }

  const moodMap = parseMoodMapJson(metadata.spriteMoodMapJson, config.animations)
  const persona = {
    format: 'sprite-sheet' as const,
    moodMap,
  }

  if (metadata.activeSprite.assetName !== CANONICAL_PERSONA_SPRITE_ASSET_NAME) {
    issues.push(`active sprite assetName must be ${CANONICAL_PERSONA_SPRITE_ASSET_NAME}`)
  }

  if (
    options.availableVersionIndexes
    && !options.availableVersionIndexes.includes(metadata.activeSprite.versionIndex)
  ) {
    issues.push('active sprite asset version is missing')
  }

  if (issues.length > 0 && metadata.activeSprite.downloadPolicy === 'public') {
    return {
      policy: 'invalid',
      persona,
      publicAssets: null,
      protectedAssets: null,
      issues,
    }
  }

  if (metadata.activeSprite.downloadPolicy === 'public') {
    if (!options.publicAssetUrl) {
      issues.push('public active sprite asset URL is missing')
      return {
        policy: 'invalid',
        persona,
        publicAssets: null,
        protectedAssets: null,
        issues,
      }
    }

    return {
      policy: 'public',
      persona,
      publicAssets: {
        ...config,
        sheetUrl: options.publicAssetUrl,
      },
      protectedAssets: null,
      issues,
    }
  }

  if (issues.length > 0) {
    return {
      policy: 'invalid',
      persona,
      publicAssets: null,
      protectedAssets: {
        ...config,
        assetName: metadata.activeSprite.assetName,
        versionIndex: metadata.activeSprite.versionIndex,
      },
      issues,
    }
  }

  return {
    policy: metadata.activeSprite.downloadPolicy,
    persona,
    publicAssets: null,
    protectedAssets: {
      ...config,
      assetName: metadata.activeSprite.assetName,
      versionIndex: metadata.activeSprite.versionIndex,
    },
    issues,
  }
}
