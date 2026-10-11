import { readWalletProfile, readWalletProfileByHandle, readPublicProfileMetadata,
  normalizeWalletProfileHandle, profileReadStep, type WalletProfileReadClient } from '@soulidity/sdk'
import type { getBrowserProfileReadConfig } from '@/lib/profile/profile-config'

type Config = ReturnType<typeof getBrowserProfileReadConfig>
type Dependencies = { byId?: typeof readWalletProfile; byHandle?: typeof readWalletProfileByHandle;
  metadata?: typeof readPublicProfileMetadata }

/** Public identity only. No fabricated Agent kind, scores, posts or achievements.
 * Profile IDs and handles are distinct from owner wallet addresses. */
export async function readPublicCommunityIdentity(params: {
  spaceId: string; client: WalletProfileReadClient; config: Config; signal?: AbortSignal
}, dependencies: Dependencies = {}) {
  const spaceId = params.spaceId, config = structuredClone(params.config), client = params.client
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)
  const byId = dependencies.byId ?? readWalletProfile, byHandle = dependencies.byHandle ?? readWalletProfileByHandle
  const metadataRead = dependencies.metadata ?? readPublicProfileMetadata
  if (typeof spaceId !== 'string' || !spaceId.length) throw new Error('COMMUNITY_PROFILE_ID_REQUIRED')
  const profileId = /^0x[0-9a-f]{64}$/.test(spaceId) ? spaceId : null
  const handle = profileId ? null : normalizeWalletProfileHandle(spaceId.startsWith('@') ? spaceId.slice(1) : spaceId)
  if (!profileId && !handle) throw new Error('COMMUNITY_PROFILE_ID_REQUIRED')
  const read = () => profileId ? byId({ client, deployment: config.deployment, profileId, signal })
    : byHandle({ client, deployment: config.deployment, handle: handle!, signal })
  const profile = await profileReadStep(signal, read)
  const metadata = await profileReadStep(signal, () => metadataRead({ client, reference: profile.metadata,
    storage: config.storage, signal }))
  // Re-resolve handles too: an old handle must not silently become an alias for
  // a renamed or different profile while its Walrus document was downloading.
  const current = await profileReadStep(signal, read)
  if (JSON.stringify(current) !== JSON.stringify(profile)) throw new Error('COMMUNITY_PROFILE_CHANGED_RETRY')
  signal.throwIfAborted()
  return { profile, metadata: metadata.metadata, storageEndEpoch: metadata.storageEndEpoch }
}
