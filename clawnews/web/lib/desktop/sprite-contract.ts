import { getBlobUrl } from '@soulidity/sdk'
import {
  CANONICAL_PERSONA_SPRITE_ASSET_NAME,
  buildDesktopSpriteSheetConfig,
  resolveMirroredSoulSpriteContract,
} from '@soulidity/sdk'
import { KIND_SPRITE, READ_PUBLIC } from '@soulidity/sdk'
import type {
  SoulContentVersionRecord,
  SoulDownloadPolicy,
} from '@soulidity/sdk'
import type { DesktopSpriteManifest } from '@/lib/types/desktop'

const CANONICAL_SPRITE_FILE_NAME = 'persona-sprite.png'
const CANONICAL_SPRITE_CONFIG_FILE_NAME = 'persona-sprite-config.json'

function normalizeDownloadPolicy(value: string | null): SoulDownloadPolicy | null {
  if (value === 'public' || value === 'owner_only' || value === 'allowlist') {
    return value
  }
  return null
}

function buildMissingManifest(params: {
  contentOnChainId: string | null
  error: string
  status?: 'missing' | 'invalid'
}): DesktopSpriteManifest {
  return {
    assetName: null,
    versionIndex: null,
    fileName: CANONICAL_SPRITE_FILE_NAME,
    configFileName: CANONICAL_SPRITE_CONFIG_FILE_NAME,
    downloadPolicy: params.status ?? 'missing',
    config: null,
    contentOnChainId: params.contentOnChainId,
    error: params.error,
  }
}

/**
 * Phase 2: resolve the persona sprite manifest for a desktop catalog entry.
 *
 * Inputs come from the unified `SoulContent` mirror:
 *   - `contentOnChainId` mirrors `SoulState.content_id` (the typed-content root).
 *   - `activeSpriteName / activeSpriteVersionIndex / activeSpriteDownloadPolicy`
 *     mirror `SoulContent.active_table[KIND_SPRITE]`.
 *   - `contentVersions` is the unified slot mirror; this resolver filters it
 *     to `kind === KIND_SPRITE` rows for the active binding name.
 */
export async function resolveDesktopSpriteManifest(params: {
  contentOnChainId: string | null
  activeSpriteName: string | null
  activeSpriteVersionIndex: number | null
  activeSpriteDownloadPolicy: string | null
  spriteConfigJson: string | null
  contentVersions?: SoulContentVersionRecord[] | null
}): Promise<DesktopSpriteManifest> {
  if (!params.contentOnChainId) {
    return buildMissingManifest({
      contentOnChainId: null,
      error: 'Soul content root is missing',
    })
  }

  const activeSpriteDownloadPolicy = normalizeDownloadPolicy(params.activeSpriteDownloadPolicy)

  if (
    !params.activeSpriteName
    || params.activeSpriteVersionIndex == null
    || !activeSpriteDownloadPolicy
  ) {
    return buildMissingManifest({
      contentOnChainId: params.contentOnChainId,
      error: 'Active sprite binding is missing',
    })
  }

  const spriteVersions = (params.contentVersions ?? []).filter(
    (version) =>
      version.kind === KIND_SPRITE
      && version.name === params.activeSpriteName
      && version.deletedAt == null,
  )
  const activeVersion = spriteVersions.find(
    (version) => version.versionIndex === params.activeSpriteVersionIndex,
  ) ?? null

  // Phase 2: with `kind === KIND_SPRITE` already filtered above, the slot is
  // intrinsically a sprite — there is no separate `assetType` to validate.
  // The legacy `visibility: 'public' | 'private'` is replaced by the
  // `(readModeMask, downloadPolicy)` pair: a slot is considered public iff
  // its `readModeMask` includes `READ_PUBLIC` AND its `downloadPolicy` is
  // `public`. Anything else is treated as private.
  const issues: string[] = []
  if (activeVersion) {
    const isPublicSlot =
      (activeVersion.readModeMask & READ_PUBLIC) !== 0
      && activeVersion.downloadPolicy === 'public'

    if (activeSpriteDownloadPolicy === 'public' && !isPublicSlot) {
      issues.push('public active sprite must point to a public asset version')
    }
    if (
      (activeSpriteDownloadPolicy === 'owner_only' || activeSpriteDownloadPolicy === 'allowlist')
      && isPublicSlot
    ) {
      issues.push('private sprite download policies must point to a private asset version')
    }
  }

  const publicAssetUrl = activeVersion?.blobId ? getBlobUrl(activeVersion.blobId) : null
  const contract = resolveMirroredSoulSpriteContract({
    contentOnChainId: params.contentOnChainId,
    activeSprite: {
      name: params.activeSpriteName,
      versionIndex: params.activeSpriteVersionIndex,
      downloadPolicy: activeSpriteDownloadPolicy,
    },
    spriteConfigJson: params.spriteConfigJson,
  }, {
    publicAssetUrl,
    availableVersionIndexes: spriteVersions.map((version) => version.versionIndex),
  })

  const error = [...issues, ...contract.issues].filter(Boolean).join('; ') || null
  if (issues.length > 0 || contract.policy === 'missing' || contract.policy === 'invalid') {
    return {
      assetName: contract.protectedAssets?.assetName ?? params.activeSpriteName,
      versionIndex: contract.protectedAssets?.versionIndex ?? params.activeSpriteVersionIndex,
      fileName: CANONICAL_SPRITE_FILE_NAME,
      configFileName: CANONICAL_SPRITE_CONFIG_FILE_NAME,
      downloadPolicy: issues.length > 0 ? 'invalid' : contract.policy,
      config: buildDesktopSpriteSheetConfig(contract),
      contentOnChainId: params.contentOnChainId,
      error,
    }
  }

  if (contract.policy === 'public') {
    return {
      assetName: CANONICAL_PERSONA_SPRITE_ASSET_NAME,
      versionIndex: params.activeSpriteVersionIndex,
      fileName: CANONICAL_SPRITE_FILE_NAME,
      configFileName: CANONICAL_SPRITE_CONFIG_FILE_NAME,
      downloadPolicy: 'public',
      config: buildDesktopSpriteSheetConfig(contract),
      publicUrl: publicAssetUrl,
      contentOnChainId: params.contentOnChainId,
      error,
    }
  }

  return {
    assetName: contract.protectedAssets?.assetName ?? CANONICAL_PERSONA_SPRITE_ASSET_NAME,
    versionIndex: contract.protectedAssets?.versionIndex ?? params.activeSpriteVersionIndex,
    fileName: CANONICAL_SPRITE_FILE_NAME,
    configFileName: CANONICAL_SPRITE_CONFIG_FILE_NAME,
    downloadPolicy: contract.policy,
    config: buildDesktopSpriteSheetConfig(contract),
    contentOnChainId: params.contentOnChainId,
    error,
  }
}
