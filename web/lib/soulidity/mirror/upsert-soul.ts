import { prisma } from '@/lib/prisma'
import { inferPersonaKind } from '@/lib/soulidity/persona'
import type { SoulContentObject, SoulObject, SoulStateObject } from '@/lib/soulidity/types'

interface ActiveBindingMirror {
  name: string
  versionIndex: number
  downloadPolicy: string
}

interface StateConfigMirror {
  spriteConfigJson?: string | null
  spriteMoodMapJson?: string | null
  voiceConfigJson?: string | null
}

/**
 * Phase 2 SoulAsset projection. Only mirrors fields the on-chain Soul +
 * SoulState carry directly; per-version content (soul.md, memory entries,
 * skill versions, sprite/audio versions) lives in
 * `SoulContentVersionRecord` rows written by `upsertContentVersionProjection`
 * — never inline here.
 *
 * Active sprite/voice bindings are passed in by the caller (event-driven mirror)
 * because they live in `SoulContent.active_table` which the projection
 * already fetched. Same for state-config map snapshots.
 */
export async function upsertSoulProjection(params: {
  soul: SoulObject
  state: SoulStateObject
  /** Optional projection of the typed-content root. */
  content?: Pick<SoulContentObject, 'objectId'> | null
  currentKioskCapOnChainId: string
  creatorMemberId?: string | null
  currentOwnerMemberId?: string | null
  tags: string[]
  previewImages: string[]
  readme?: string | null
  listingObjectOnChainId?: string | null
  listedPriceAtomic?: bigint | null
  listingStatus?: 'held' | 'listed' | 'floor-violation'
  /** Cached active sprite binding from `SoulContent.active_table[KIND_SPRITE]`. */
  activeSprite?: ActiveBindingMirror | null
  /** Cached active voice binding from `SoulContent.active_table[KIND_AUDIO]`. */
  activeVoice?: ActiveBindingMirror | null
  /** Cached snapshots of `SoulState.config_ext` keys we mirror by name. */
  stateConfig?: StateConfigMirror
}) {
  const personaKind = inferPersonaKind(params.tags)

  // Avoid nulling out previously-mirrored on-chain pointers when the chain
  // read transiently returns null (RPC indexing lag). Only overwrite when
  // the chain provided a concrete value this time.
  const contentUpdate = params.content?.objectId
    ? { contentOnChainId: params.content.objectId }
    : params.state.contentId
      ? { contentOnChainId: params.state.contentId }
      : {}

  const paidAccessUpdate = params.state.paidAccessListId
    ? { paidAccessListOnChainId: params.state.paidAccessListId }
    : {}

  const result = await prisma.soulAsset.upsert({
    where: { onChainId: params.soul.objectId },
    update: {
      stateOnChainId: params.state.objectId,
      creatorMemberId: params.creatorMemberId ?? null,
      creatorAddress: params.soul.creatorAddress,
      creatorRoyaltyBps: params.state.creatorRoyaltyBps,
      currentOwnerMemberId: params.currentOwnerMemberId ?? null,
      currentOwnerAddress: params.state.currentOwnerAddress,
      currentKioskId: params.state.currentKioskId,
      currentKioskCapOnChainId: params.currentKioskCapOnChainId,
      listingObjectOnChainId: params.listingObjectOnChainId ?? null,
      listedPriceAtomic: params.listedPriceAtomic?.toString() ?? null,
      listingStatus: params.listingStatus ?? 'held',
      name: params.soul.name,
      description: params.soul.description,
      imageUrl: params.soul.imageUrl,
      activeSpriteName: params.activeSprite?.name ?? null,
      activeSpriteVersionIndex: params.activeSprite?.versionIndex ?? null,
      activeSpriteDownloadPolicy: params.activeSprite?.downloadPolicy ?? null,
      activeVoiceName: params.activeVoice?.name ?? null,
      activeVoiceVersionIndex: params.activeVoice?.versionIndex ?? null,
      activeVoiceDownloadPolicy: params.activeVoice?.downloadPolicy ?? null,
      spriteConfigJson: params.stateConfig?.spriteConfigJson ?? null,
      spriteMoodMapJson: params.stateConfig?.spriteMoodMapJson ?? null,
      voiceConfigJson: params.stateConfig?.voiceConfigJson ?? null,
      provenanceKind: params.soul.provenanceKind,
      personaKind,
      originRef: params.soul.originRef,
      collectionOnChainId: params.state.collectionId,
      grantCapacity: params.state.grantCapacity,
      activeGrantCount: params.state.activeGrantCount,
      ...contentUpdate,
      ...paidAccessUpdate,
      tags: params.tags,
      previewImages: params.previewImages,
      readme: params.readme ?? null,
    },
    create: {
      onChainId: params.soul.objectId,
      stateOnChainId: params.state.objectId,
      contentOnChainId: params.content?.objectId ?? params.state.contentId ?? null,
      paidAccessListOnChainId: params.state.paidAccessListId ?? null,
      creatorMemberId: params.creatorMemberId ?? null,
      creatorAddress: params.soul.creatorAddress,
      creatorRoyaltyBps: params.state.creatorRoyaltyBps,
      currentOwnerMemberId: params.currentOwnerMemberId ?? null,
      currentOwnerAddress: params.state.currentOwnerAddress,
      currentKioskId: params.state.currentKioskId,
      currentKioskCapOnChainId: params.currentKioskCapOnChainId,
      listingObjectOnChainId: params.listingObjectOnChainId ?? null,
      listedPriceAtomic: params.listedPriceAtomic?.toString() ?? null,
      listingStatus: params.listingStatus ?? 'held',
      name: params.soul.name,
      description: params.soul.description,
      imageUrl: params.soul.imageUrl,
      activeSpriteName: params.activeSprite?.name ?? null,
      activeSpriteVersionIndex: params.activeSprite?.versionIndex ?? null,
      activeSpriteDownloadPolicy: params.activeSprite?.downloadPolicy ?? null,
      activeVoiceName: params.activeVoice?.name ?? null,
      activeVoiceVersionIndex: params.activeVoice?.versionIndex ?? null,
      activeVoiceDownloadPolicy: params.activeVoice?.downloadPolicy ?? null,
      spriteConfigJson: params.stateConfig?.spriteConfigJson ?? null,
      spriteMoodMapJson: params.stateConfig?.spriteMoodMapJson ?? null,
      voiceConfigJson: params.stateConfig?.voiceConfigJson ?? null,
      provenanceKind: params.soul.provenanceKind,
      personaKind,
      originRef: params.soul.originRef,
      collectionOnChainId: params.state.collectionId,
      grantCapacity: params.state.grantCapacity,
      activeGrantCount: params.state.activeGrantCount,
      tags: params.tags,
      previewImages: params.previewImages,
      readme: params.readme ?? null,
    },
  })

  return result
}
