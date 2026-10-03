import { parseSoulAuthoringRequest, soulAuthoringRequestHash, soulAuthoringSealContext, soulAuthoringUploadScope,
  type SoulAuthoringRequest } from './soul-authoring-manifest'
import { parseSoulAuthoringPreparation, soulAuthoringPreparationHash, soulAuthoringStoreKey,
  type SoulAuthoringPreparation, type SoulAuthoringStore } from './soul-authoring-store'
import { createWalrusBatchSealProtector } from '../upload/walrus-batch-seal'
import { assertWalrusBatchLifetime, prepareWalrusBatch, walrusBatchPreparationHash } from '../upload/walrus-batch-preparation'

type UploadParameters = Parameters<typeof prepareWalrusBatch>[0]
type SealParameters = Parameters<typeof createWalrusBatchSealProtector>[0]
/** No signing, node writes, registration or mint. Return only after the exact
 * identity, initial envelopes AND upload bytes are durable and read back.
 * Callers must read their existing store record before generating a new nonce;
 * a mismatched request is an explicit recovery conflict, never a new payment. */
export async function prepareSoulAuthoring(params: {
  request: SoulAuthoringRequest; files: UploadParameters['files']; client: UploadParameters['client']
  lifetime: UploadParameters['lifetime']; wallet: SealParameters['wallet']
  sealConfig: Parameters<typeof soulAuthoringSealContext>[1]; recoveryNonce: string
  store: SoulAuthoringStore
}): Promise<SoulAuthoringPreparation> {
  const request = parseSoulAuthoringRequest(params.request), life = { ...params.lifetime }, store = params.store, client = params.client
  const files = params.files.map(file => ({ ...file })), wallet = { ...params.wallet }
  const sealConfig = structuredClone(params.sealConfig), recoveryNonce = params.recoveryNonce
  const scope = soulAuthoringUploadScope(request), key = soulAuthoringStoreKey(request)
  // Hold the author lock until IDB settles, even if the wallet changes. Racing
  // an uncancellable write against a timeout could let it commit after unlock.
  async function step<T>(run: () => Promise<T>) {
    assertWalrusBatchLifetime(scope, life)
    const value = await run(); assertWalrusBatchLifetime(scope, life); return value
  }
  return store.exclusive(key, async () => {
    const previous = await step(() => store.read(key))
    if (previous) {
      const saved = parseSoulAuthoringPreparation(previous)
      if (soulAuthoringRequestHash(saved.manifest.request) !== soulAuthoringRequestHash(request))
        throw new Error('SOUL_AUTHORING_UNRESOLVED_OPERATION_RESUME_REQUIRED')
      return saved
    }
    const context = request.mints.length ? soulAuthoringSealContext(request, sealConfig, recoveryNonce) : null
    const protector = context ? createWalrusBatchSealProtector({ context, wallet, lifetime: life }) : null
    const preparation = await prepareWalrusBatch({ scope, files, client, lifetime: life,
      protector: protector?.protector ?? null, storageEpochs: request.storageEpochs })
    const value = parseSoulAuthoringPreparation({ schema: 'soulidity.soul-authoring-preparation.v1', preparation,
      manifest: { schema: 'soulidity.soul-authoring-manifest.v1', request,
        preparationHash: walrusBatchPreparationHash(preparation), sealContext: context,
        sidecars: protector?.sidecars(preparation.manifestHash) ?? [] } })
    const fingerprint = soulAuthoringPreparationHash(value)
    await step(() => store.create(key, structuredClone(value)))
    const saved = await step(() => store.read(key))
    if (!saved || soulAuthoringPreparationHash(saved) !== fingerprint)
      throw new Error('SOUL_AUTHORING_DURABLE_READBACK_REQUIRED')
    return parseSoulAuthoringPreparation(saved)
  })
}
