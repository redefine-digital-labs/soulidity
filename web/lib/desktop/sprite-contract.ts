import { getBlobUrl } from '@/lib/services/walrus'
import {
  CANONICAL_PERSONA_SPRITE_ASSET_NAME,
  buildDesktopSpriteSheetConfig,
  resolveMirroredSoulSpriteContract,
} from '@/lib/soulidity/metadata'
import type { SoulDownloadPolicy } from '@/lib/soulidity/types'
import type { DesktopSpriteManifest } from '@/lib/types/desktop'

const CANONICAL_SPRITE_FILE_NAME = 'persona-sprite.png'
const CANONICAL_SPRITE_CONFIG_FILE_NAME = 'persona-sprite-config.json'

type SpriteAssetVersionLike = {
  assetName: string
  versionIndex: number
  visibility: string
  assetType?: string | null
  blobId?: string | null
  blobObjectId?: string
}

function normalizeDownloadPolicy(value: string | null): SoulDownloadPolicy | null {
  if (value === 'public' || value === 'owner_only' || value === 'allowlist') {
    return value
  }
  return null
}

function buildMissingManifest(params: {
  metadataOnChainId: string | null
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
    metadataOnChainId: params.metadataOnChainId,
    error: params.error,
  }
}

export async function resolveDesktopSpriteManifest(params: {
  metadataOnChainId: string | null
  activeSpriteAssetName: string | null
  activeSpriteVersionIndex: number | null
  activeSpriteDownloadPolicy: string | null
  spriteConfigJson: string | null
  spriteMoodMapJson: string | null
  assetVersions?: SpriteAssetVersionLike[] | null
}): Promise<DesktopSpriteManifest> {
  if (!params.metadataOnChainId) {
    return buildMissingManifest({
      metadataOnChainId: null,
      error: 'Soul metadata object is missing',
    })
  }

  const activeSpriteDownloadPolicy = normalizeDownloadPolicy(params.activeSpriteDownloadPolicy)

  if (
    !params.activeSpriteAssetName
    || params.activeSpriteVersionIndex == null
    || !activeSpriteDownloadPolicy
  ) {
    return buildMissingManifest({
      metadataOnChainId: params.metadataOnChainId,
      error: 'Active sprite binding is missing',
    })
  }

  const assetVersions = params.assetVersions ?? []
  const activeVersion = assetVersions.find((version) =>
    version.assetName === params.activeSpriteAssetName
      && version.versionIndex === params.activeSpriteVersionIndex,
  ) ?? null

  const issues: string[] = []
  if (activeVersion && activeVersion.assetType && activeVersion.assetType !== 'sprite') {
    issues.push('active sprite binding does not point to a sprite asset')
  }
  if (activeSpriteDownloadPolicy === 'public' && activeVersion && activeVersion.visibility !== 'public') {
    issues.push('public active sprite must point to a public asset version')
  }
  if (
    (activeSpriteDownloadPolicy === 'owner_only' || activeSpriteDownloadPolicy === 'allowlist')
    && activeVersion
    && activeVersion.visibility !== 'private'
  ) {
    issues.push('private sprite download policies must point to a private asset version')
  }

  const publicAssetUrl = activeVersion?.blobId ? getBlobUrl(activeVersion.blobId) : null
  const contract = resolveMirroredSoulSpriteContract({
    metadataOnChainId: params.metadataOnChainId,
    activeSprite: {
      assetName: params.activeSpriteAssetName,
      versionIndex: params.activeSpriteVersionIndex,
      downloadPolicy: activeSpriteDownloadPolicy,
    },
    spriteConfigJson: params.spriteConfigJson,
    spriteMoodMapJson: params.spriteMoodMapJson,
  }, {
    publicAssetUrl,
    availableVersionIndexes: assetVersions
      .filter((version) => version.assetName === params.activeSpriteAssetName)
      .map((version) => version.versionIndex),
  })

  const error = [...issues, ...contract.issues].filter(Boolean).join('; ') || null
  if (issues.length > 0 || contract.policy === 'missing' || contract.policy === 'invalid') {
    return {
      assetName: contract.protectedAssets?.assetName ?? params.activeSpriteAssetName,
      versionIndex: contract.protectedAssets?.versionIndex ?? params.activeSpriteVersionIndex,
      fileName: CANONICAL_SPRITE_FILE_NAME,
      configFileName: CANONICAL_SPRITE_CONFIG_FILE_NAME,
      downloadPolicy: issues.length > 0 ? 'invalid' : contract.policy,
      config: buildDesktopSpriteSheetConfig(contract),
      metadataOnChainId: params.metadataOnChainId,
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
      metadataOnChainId: params.metadataOnChainId,
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
    metadataOnChainId: params.metadataOnChainId,
    error,
  }
}
