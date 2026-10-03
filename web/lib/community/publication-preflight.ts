import { WalrusClient } from '@mysten/walrus'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { createPublicCommunityPublishIntent, validatePublicCommunityUploadReceipt, readMyWalletProfile,
  readPublicCommunityPost, readPublicCommunityDocument, profileReadStep,
  type PublicCommunityPublishIntent, type PublicCommunityUploadReceipt } from '@soulidity/sdk'
import type { BrowserCommunityReadConfig } from './public-post-read'

type Dependencies = {
  profile?: typeof readMyWalletProfile
  post?: typeof readPublicCommunityPost
  document?: typeof readPublicCommunityDocument
  walrus?: (client: SuiGrpcClient) => Pick<WalrusClient, 'reset' | 'getBlobType' | 'systemState'>
}
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`COMMUNITY_PUBLICATION_${code}`) }
/** Read-only prerequisite, never a signing authorization. The caller separately
 * checks the live wallet/write switch before prompting and before broadcast. */
export async function assertCommunityPublicationReady(params: {
  client: SuiGrpcClient; config: BrowserCommunityReadConfig
  intent: PublicCommunityPublishIntent; receipt: PublicCommunityUploadReceipt; signal?: AbortSignal
}, dependencies: Dependencies = {}): Promise<void> {
  const intent = createPublicCommunityPublishIntent(params.intent), config = structuredClone(params.config)
  const rawReceipt = structuredClone(params.receipt), { client } = params
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000)
  check(JSON.stringify(intent.deployment) === JSON.stringify(config.deployment), 'RELEASE_CHANGED')
  check(config.storage.chainIdentifier === config.deployment.profile.chainIdentifier, 'STORAGE_CHAIN_MISMATCH')
  signal.throwIfAborted()
  const receipt = await validatePublicCommunityUploadReceipt(intent, rawReceipt)
  const profileRead = dependencies.profile ?? readMyWalletProfile
  const postRead = dependencies.post ?? readPublicCommunityPost
  const documentRead = dependencies.document ?? readPublicCommunityDocument
  const author = () => profileReadStep(signal, () => profileRead({ client: client.core,
    deployment: config.deployment.profile, owner: intent.owner, signal }))
  const before = await author()
  check(before?.id === intent.authorId && before.owner === intent.owner, 'AUTHOR_CHANGED')
  const parent = intent.kind === 'comment' ? await profileReadStep(signal, () => postRead({ client,
    deployment: config.deployment, postId: intent.postId, signal })) : null
  if (intent.kind === 'comment') check(parent?.id === intent.postId
    && parent.registryId === config.deployment.registryId
    && parent.profileRegistryId === config.deployment.profile.registryId, 'PARENT_MISMATCH')
  let walrus: Pick<WalrusClient, 'reset' | 'getBlobType' | 'systemState'> | undefined
  let lastEpoch = -1
  const freshWalrusState = async (currentSignal: AbortSignal) => {
    if (!walrus) {
      const chain = config.deployment.profile.chainIdentifier
      if (dependencies.walrus) walrus = dependencies.walrus(client)
      else {
        check(chain === '35834a8a' || chain === '4c78adac', 'WALRUS_NETWORK_UNSUPPORTED')
        walrus = new WalrusClient({ suiClient: client, network: chain === '35834a8a' ? 'mainnet' : 'testnet' })
      }
    }
    currentSignal.throwIfAborted(); walrus.reset()
    const blobType = await profileReadStep(currentSignal, async () => walrus!.getBlobType())
    const state = await profileReadStep(currentSignal, () => walrus!.systemState())
    const epoch = state.committee.epoch
    check(blobType === config.storage.blobType && Number.isInteger(epoch) && epoch >= 0
      && epoch <= 0xffff_ffff, 'WALRUS_STATE_INVALID')
    check(epoch >= lastEpoch, 'WALRUS_EPOCH_REGRESSION')
    lastEpoch = epoch
    return { blobType, epoch }
  }
  const stored = await profileReadStep(signal, () => documentRead({ client, storage: config.storage,
    reference: receipt.reference, kind: intent.kind, freshWalrusState, signal }))
  check(JSON.stringify(stored.document) === JSON.stringify(intent.document), 'DOCUMENT_MISMATCH')
  const after = await author()
  check(JSON.stringify(after) === JSON.stringify(before), 'AUTHOR_CHANGED')
  if (intent.kind === 'comment') {
    const latest = await profileReadStep(signal, () => postRead({ client, deployment: config.deployment, postId: intent.postId, signal }))
    check(JSON.stringify(latest) === JSON.stringify(parent), 'PARENT_CHANGED_RETRY')
  }
  // Profile/parent rereads may cross a storage epoch after the document reader's
  // own certificate check. Recheck expiry before returning to the write adapter.
  const state = await freshWalrusState(signal)
  check(state.blobType === config.storage.blobType && Number.isInteger(state.epoch) && state.epoch >= 0
    && state.epoch <= 0xffff_ffff && Number.isInteger(stored.storageEndEpoch)
    && stored.storageEndEpoch <= 0xffff_ffff && stored.storageEndEpoch > state.epoch, 'STORAGE_EXPIRED_OR_INVALID')
  signal.throwIfAborted()
}
