/**
 * Phase 2 transitional bridge for the publish/import/wrap-publish UI.
 *
 * The mint hooks (use-publish, use-import, use-wrap-publish, use-collection-publish)
 * still expose the legacy single-blob API to their callers (`protectedBlobObjectId`,
 * `foundingMemoryBlobObjectId`, `skillsBlobObjectId`, `initialSprite`,
 * `contentAccess*`). Internally they now hand off to the Phase 2 builders that
 * take `vector<InitialContentEntry>` + `vector<StateConfigEntry>`.
 *
 * This helper centralises the legacy → unified-content translation so the four
 * hooks share one source of truth. The new ContentPanel UI (post-migration)
 * should bypass this helper entirely and pass `initialContent` directly to the
 * hook.
 */
import {
  CANONICAL_MEMORY_NAME,
  CANONICAL_SOUL_DOC_NAME,
  KIND_AUDIO,
  KIND_MEMORY,
  KIND_SKILL,
  KIND_SOUL_DOC,
  KIND_SPRITE,
  READ_GRANT,
  READ_OWNER,
  READ_PUBLIC,
} from './kinds'
import type {
  InitialContentEntryInput,
  StateConfigEntryInput,
} from './tx/shared'
import type { SoulDownloadPolicy } from './types'

export interface LegacyInitialSpriteInput {
  blobObjectId: string
  assetName?: string | null
  versionIndex?: number | null
  visibility?: 'public' | 'private'
  downloadPolicy?: SoulDownloadPolicy | null
  spriteConfigJson: string
  spriteMoodMapJson?: string | null
}

export interface LegacyMintParams {
  /** Walrus blob object id holding soul.md. Required. */
  protectedBlobObjectId: string
  /** Walrus blob object id for the founding memory entry. Required for Phase 2. */
  foundingMemoryBlobObjectId?: string | null
  skillsBlobObjectId?: string | null
  initialSkillName?: string | null
  skillsVisibility?: 'public' | 'private'
  initialSprite?: LegacyInitialSpriteInput | null
  /** Optional explicit asset blob (for audio or non-sprite assets). */
  assetBlobObjectId?: string | null
  initialAssetName?: string | null
  assetVisibility?: 'public' | 'private'
  assetType?: 'sprite' | 'live2d' | 'audio'
}

const INVARIANT_READ_MODE = READ_OWNER | READ_GRANT
const SPRITE_DEFAULT_NAME = 'persona-sprite'

function deriveAudioReadMode(visibility: 'public' | 'private' | null | undefined): {
  mask: number
  policy: SoulDownloadPolicy
} {
  if (visibility === 'public') {
    return { mask: READ_OWNER | READ_GRANT | READ_PUBLIC, policy: 'public' }
  }
  return { mask: INVARIANT_READ_MODE, policy: 'owner_only' }
}

function deriveSpriteReadMode(sprite: LegacyInitialSpriteInput): {
  mask: number
  policy: SoulDownloadPolicy
} {
  if (sprite.downloadPolicy === 'public' || sprite.visibility === 'public') {
    return { mask: READ_OWNER | READ_GRANT | READ_PUBLIC, policy: 'public' }
  }
  return { mask: INVARIANT_READ_MODE, policy: sprite.downloadPolicy ?? 'owner_only' }
}

/**
 * Build the Phase 2 `initialContent` vector from the legacy single-blob params.
 * Throws if required invariants are missing.
 */
export function buildLegacyInitialContent(
  params: LegacyMintParams,
): InitialContentEntryInput[] {
  if (!params.protectedBlobObjectId) {
    throw new Error('protectedBlobObjectId (soul.md) is required')
  }
  if (!params.foundingMemoryBlobObjectId) {
    throw new Error('foundingMemoryBlobObjectId is required (Phase 2 mints must seed at least one MEMORY entry)')
  }

  const entries: InitialContentEntryInput[] = [
    {
      kind: KIND_SOUL_DOC,
      name: CANONICAL_SOUL_DOC_NAME,
      slotReadModeMask: INVARIANT_READ_MODE,
      downloadPolicy: 'owner_only',
      setActive: false,
      blobObjectId: params.protectedBlobObjectId,
    },
    {
      kind: KIND_MEMORY,
      name: CANONICAL_MEMORY_NAME,
      slotReadModeMask: INVARIANT_READ_MODE,
      downloadPolicy: 'owner_only',
      setActive: false,
      blobObjectId: params.foundingMemoryBlobObjectId,
    },
  ]

  if (params.skillsBlobObjectId) {
    entries.push({
      kind: KIND_SKILL,
      name: params.initialSkillName ?? 'default',
      slotReadModeMask: INVARIANT_READ_MODE,
      downloadPolicy: 'owner_only',
      setActive: false,
      blobObjectId: params.skillsBlobObjectId,
    })
  }

  if (params.initialSprite?.blobObjectId) {
    const { mask, policy } = deriveSpriteReadMode(params.initialSprite)
    entries.push({
      kind: KIND_SPRITE,
      name: params.initialSprite.assetName ?? SPRITE_DEFAULT_NAME,
      slotReadModeMask: mask,
      downloadPolicy: policy,
      setActive: true,
      blobObjectId: params.initialSprite.blobObjectId,
    })
  } else if (params.assetBlobObjectId && params.assetType !== 'audio') {
    // Phase 2 treats `(assetType=sprite/live2d)` the same — both go to KIND_SPRITE.
    const visibility = params.assetVisibility ?? 'private'
    const { mask, policy } = deriveAudioReadMode(visibility)
    entries.push({
      kind: KIND_SPRITE,
      name: params.initialAssetName ?? SPRITE_DEFAULT_NAME,
      slotReadModeMask: mask,
      downloadPolicy: policy,
      setActive: true,
      blobObjectId: params.assetBlobObjectId,
    })
  } else if (params.assetBlobObjectId && params.assetType === 'audio') {
    const visibility = params.assetVisibility ?? 'private'
    const { mask, policy } = deriveAudioReadMode(visibility)
    entries.push({
      kind: KIND_AUDIO,
      name: params.initialAssetName ?? 'default',
      slotReadModeMask: mask,
      downloadPolicy: policy,
      setActive: true,
      blobObjectId: params.assetBlobObjectId,
    })
  }

  return entries
}

/**
 * Build the Phase 2 `initialStateConfig` vector from the legacy sprite/voice
 * config JSON blobs.
 */
export function buildLegacyInitialStateConfig(
  params: LegacyMintParams,
): StateConfigEntryInput[] {
  const entries: StateConfigEntryInput[] = []
  const sprite = params.initialSprite
  if (sprite?.spriteConfigJson) {
    entries.push({ key: 'sprite_config_json', valueUtf8: sprite.spriteConfigJson })
  }
  if (sprite?.spriteMoodMapJson) {
    entries.push({ key: 'sprite_mood_map_json', valueUtf8: sprite.spriteMoodMapJson })
  }
  return entries
}
