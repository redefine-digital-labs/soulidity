import { resolveDesktopSpriteManifest } from '@/lib/desktop/sprite-contract'
import {
  AssetAccessDeniedError,
  resolveSoulAssetVersionAccessPayload,
} from '@/lib/soulidity/asset-version-access'
import { findSoulAssetDetailByRouteId } from '@/lib/soulidity/repository'

export async function resolveDesktopSoulAccess(params: {
  soulOnChainId: string
  viewerAddresses: string[]
  viewerMemberId: string
}): Promise<
  | { ok: true; blobUrl: string | null; blobId: string | null; isEncrypted: boolean }
  | { ok: false; error: string; status: number }
> {
  const soul = await findSoulAssetDetailByRouteId(params.soulOnChainId)
  if (!soul) {
    return { ok: false, error: 'Soul not found', status: 404 }
  }

  const sprite = await resolveDesktopSpriteManifest({
    metadataOnChainId: soul.metadataOnChainId,
    activeSpriteAssetName: soul.activeSpriteAssetName,
    activeSpriteVersionIndex: soul.activeSpriteVersionIndex,
    activeSpriteDownloadPolicy: soul.activeSpriteDownloadPolicy,
    spriteConfigJson: soul.spriteConfigJson,
    spriteMoodMapJson: soul.spriteMoodMapJson,
    assetVersions: soul.assetVersions
      .filter((version) => version.deletedAt == null)
      .map((version) => ({
        assetName: version.assetName,
        versionIndex: version.versionIndex,
        visibility: version.visibility,
        assetType: version.assetType,
        blobId: version.blobId,
        blobObjectId: version.blobObjectId,
      })),
  })

  if (sprite.downloadPolicy === 'public') {
    return {
      ok: true,
      blobUrl: sprite.publicUrl ?? null,
      blobId: null,
      isEncrypted: false,
    }
  }

  if (sprite.downloadPolicy === 'missing' || sprite.downloadPolicy === 'invalid') {
    return {
      ok: false,
      error: sprite.error ?? 'Soul sprite metadata is invalid',
      status: sprite.downloadPolicy === 'missing' ? 404 : 409,
    }
  }

  if (!sprite.assetName || sprite.versionIndex == null) {
    return {
      ok: false,
      error: 'Soul sprite metadata is incomplete',
      status: 409,
    }
  }

  try {
    const access = await resolveSoulAssetVersionAccessPayload({
      soulOnChainId: soul.onChainId,
      assetName: sprite.assetName,
      versionIndex: sprite.versionIndex,
      viewerAddresses: params.viewerAddresses,
    })

    return {
      ok: true,
      blobUrl: access.artifact.walrusBlobUrl,
      blobId: access.artifact.walrusBlobId,
      isEncrypted: access.visibility === 'private',
    }
  } catch (error) {
    if (error instanceof AssetAccessDeniedError) {
      return { ok: false, error: error.message, status: error.status }
    }
    throw error
  }
}
