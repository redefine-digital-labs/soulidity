import { Transaction, type TransactionArgument } from '@mysten/sui/transactions'
import { fromHex } from '@mysten/sui/utils'
import { appendCommitMintManifest, buildBuyerKioskArgs, finishBuyerKioskArgs, buildInitialContentArgs,
  appendFinalizeSoulState } from '@soulidity/sdk'
import { walrusBatchAddress, walrusBatchJsonHash, walrusBatchKeys, type WalrusBatchPreparation } from '../upload/walrus-batch-preparation'
import type { createWalrusBatchAdapter } from '../upload/walrus-batch-adapter'
import { createSoulAuthoringMaterializer, resolveSoulAuthoringImage, validateSoulAuthoringManifest,
  type SoulAuthoringManifest, type SoulAuthoringTarget } from './soul-authoring-manifest'

function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`SOUL_AUTHORING_TX_${code}`) }
export type SoulAuthoringKiosk = { kind: 'NEW'; kioskId: null; capId: null }
  | { kind: 'EXISTING'; kioskId: string; capId: string }
export interface SoulAuthoringMintChunk {
  /** Ordered indices from the original committed manifest, never new nonces. */
  mintIndices: number[]
  /** Public images are certified exactly once by the parent chunk journal. */
  includePublicFiles: boolean
  collectionObjectId: string | null
  kiosk: SoulAuthoringKiosk
}
function kioskInput(input: SoulAuthoringKiosk) {
  const k = structuredClone(input)
  walrusBatchKeys(k, ['kind', 'kioskId', 'capId'])
  check(k.kind === 'NEW' && k.kioskId === null && k.capId === null
    || k.kind === 'EXISTING' && walrusBatchAddress(k.kioskId) && walrusBatchAddress(k.capId) && k.kioskId !== k.capId, 'KIOSK_INVALID')
  return k
}
function kioskArgs(tx: Transaction, target: SoulAuthoringTarget, input: SoulAuthoringKiosk) {
  return buildBuyerKioskArgs(tx, { buyerKioskId: input.kioskId, buyerKioskCapOnChainId: input.capId,
    runtime: { packageId: target.callablePackageId, marketConfigId: target.marketConfigId,
      kioskRegistryId: target.kioskRegistryId, kioskPackageId: target.kioskPackageId } })
}

/** Business fragments for the parent register/create and certify/mint packets.
 * This performs no network, signing, gas selection, recovery or proof acceptance.
 * The parent appends the verified Walrus prefix first, then this exact suffix,
 * and freezes/proves the WHOLE packet. No ambient deployment variables are read.
 */
export function createSoulAuthoringTransactionComposer(manifestInput: SoulAuthoringManifest, preparationInput: WalrusBatchPreparation) {
  const manifest = validateSoulAuthoringManifest(manifestInput, preparationInput)
  const request = manifest.request, target = request.target, pkg = target.callablePackageId
  const metadata = { manifest: structuredClone(preparationInput.manifest) }
  const manifestHash = walrusBatchJsonHash(manifest)
  function collectionId(input: string | null) {
    if (request.collection) check(walrusBatchAddress(input), 'CREATED_COLLECTION_REQUIRED')
    else check(input === request.bindCollectionId, 'BIND_COLLECTION_MISMATCH')
  }
  return {
    manifestHash,
    appendRegistrationBusiness(tx: Transaction, kiosk: SoulAuthoringKiosk) {
      const selected = kioskInput(kiosk)
      appendCommitMintManifest(tx, { callablePackageId: pkg, manifestHash: fromHex(manifestHash) })
      if (!request.collection) return
      const c = request.collection, handles = kioskArgs(tx, target, selected)
      const collection = tx.moveCall({ target: `${pkg}::market::create_collection_in_personal_kiosk_v2`, arguments: [
        tx.object(target.marketConfigId), tx.object(target.kioskRegistryId), tx.object(target.collectionTransferPolicyId),
        handles.buyerKiosk, handles.buyerKioskCap, tx.pure.string(c.name), tx.pure.string(c.description),
        tx.pure.string(resolveSoulAuthoringImage(c.image, request, metadata)), tx.pure.u16(c.extraRoyaltyBps), tx.pure.bool(c.tradeable),
        tx.pure.option('u64', c.maxSupply === null ? null : BigInt(c.maxSupply)),
        tx.pure.option('u128', c.floorPriceAtomic === null ? null : BigInt(c.floorPriceAtomic)),
      ] })
      if (c.listingPriceAtomic !== null) {
        const listing = tx.moveCall({ target: `${pkg}::market::list_collection_right_fixed_price_v2`, arguments: [
          tx.object(target.marketConfigId), tx.object(target.kioskRegistryId), collection, handles.buyerKiosk,
          handles.buyerKioskCap, tx.pure.u64(BigInt(c.listingPriceAtomic)),
        ] })
        tx.moveCall({ target: `${pkg}::market::finalize_collection_listing`, arguments: [listing] })
      }
      tx.moveCall({ target: `${pkg}::market::finalize_collection`, arguments: [collection] })
      finishBuyerKioskArgs(tx, handles)
    },
    /** IDs must be supplied only after actual historical registration proof.
     * Current owned objects or a returned digest are not sufficient evidence.
     * The returned closure cannot observe later edits to input bytes or IDs. */
    prepareMintBusiness(preparation: WalrusBatchPreparation, blobIds: readonly string[], chunkInput: SoulAuthoringMintChunk) {
      const chunk = structuredClone(chunkInput)
      walrusBatchKeys(chunk, ['mintIndices', 'includePublicFiles', 'collectionObjectId', 'kiosk'])
      check(Array.isArray(chunk.mintIndices) && typeof chunk.includePublicFiles === 'boolean', 'CHUNK_INVALID')
      chunk.kiosk = kioskInput(chunk.kiosk); collectionId(chunk.collectionObjectId)
      let previous = -1
      for (const index of chunk.mintIndices) {
        check(Number.isSafeInteger(index) && index > previous && index < request.mints.length, 'CHUNK_INDICES_INVALID'); previous = index
      }
      check(chunk.mintIndices.length > 0 || request.mints.length === 0 && chunk.includePublicFiles, 'EMPTY_CHUNK')
      const materialize = createSoulAuthoringMaterializer(manifest, preparation, blobIds)
      const rows = chunk.mintIndices.map(index => ({ mint: structuredClone(request.mints[index]), args: materialize(index) }))
      const files = new Set(rows.flatMap(row => row.mint.slots.map(slot => slot.fileIndex)))
      if (chunk.includePublicFiles) metadata.manifest.files.forEach(file => { if (file.uploadType === 'public') files.add(file.index) })
      const fileIndices = [...files].sort((a, b) => a - b)
      check(fileIndices.length > 0, 'NO_MINT_STAGE_REQUIRED')
      return {
        fileIndices: Object.freeze(fileIndices),
        append(tx: Transaction) {
          if (!rows.length) return // empty Collection: only the paid image certify prefix
          const handles = kioskArgs(tx, target, chunk.kiosk)
          for (const { mint, args } of rows) {
            if (mint.source) {
              const [cap, promise] = tx.moveCall({ target: `${target.kioskPackageId}::personal_kiosk::borrow_val`, arguments: [handles.buyerKioskCap] })
              tx.moveCall({ target: '0x2::kiosk::place', typeArguments: [mint.source.objectType],
                arguments: [handles.buyerKiosk, cap, tx.object(mint.source.objectId)] })
              tx.moveCall({ target: `${target.kioskPackageId}::personal_kiosk::return_val`, arguments: [handles.buyerKioskCap, cap, promise] })
            }
            const content = buildInitialContentArgs(tx, pkg, args, target.originalPackageId)
            const callArgs: TransactionArgument[] = [tx.object(target.marketConfigId), tx.object(target.kindRegistryId),
              tx.object(target.kioskRegistryId), tx.object(target.soulTransferPolicyId), handles.buyerKiosk, handles.buyerKioskCap]
            if (mint.source) callArgs.push(tx.pure.id(mint.source.objectId))
            callArgs.push(tx.pure.string(args.name), tx.pure.string(args.description), tx.pure.string(args.imageUrl),
              content.initialContentVec, content.initialStateConfigVec)
            if (mint.originRef !== null) callArgs.push(tx.pure.string(mint.originRef))
            callArgs.push(tx.pure.u16(args.creatorRoyaltyBps), tx.pure.vector('u8', args.mintNonce),
              tx.pure.id(args.expectedContentObjectId), tx.object('0x6'))
            const variant = mint.kind === 'ORDINARY' ? 'native' : mint.kind === 'IMPORTED' ? 'imported' : 'joined'
            const state = tx.moveCall({ target: `${pkg}::market::mint_${variant}_in_personal_kiosk_v2`,
              typeArguments: mint.source ? [mint.source.objectType] : [], arguments: callArgs })
            if (chunk.collectionObjectId) tx.moveCall({ target: `${pkg}::collection::add_soul`, arguments: [tx.object(chunk.collectionObjectId), state] })
            if (mint.listingPriceAtomic !== null) {
              const listingArgs: TransactionArgument[] = [tx.object(target.marketConfigId), tx.object(target.kioskRegistryId)]
              if (chunk.collectionObjectId) listingArgs.push(tx.object(chunk.collectionObjectId))
              listingArgs.push(handles.buyerKiosk, handles.buyerKioskCap, state, tx.pure.u64(BigInt(mint.listingPriceAtomic)))
              const listing = tx.moveCall({ target: chunk.collectionObjectId
                ? `${pkg}::market::list_soul_fixed_price_with_collection_v2`
                : `${pkg}::market::list_soul_fixed_price_v2`, arguments: listingArgs })
              tx.moveCall({ target: `${pkg}::market::finalize_soul_listing`, arguments: [listing] })
            }
            appendFinalizeSoulState(tx, pkg, state)
          }
          finishBuyerKioskArgs(tx, handles)
        },
      }
    },
  }
}

type AuthoringUploader = Pick<ReturnType<typeof createWalrusBatchAdapter>, 'appendRegisterCalls' | 'appendCertifyCalls'>
/** Fresh construction only, not a resume API. The caller must first exclude
 * any unknown parent packet, then freeze/read back the complete built bytes
 * before invoking a wallet. The uploader's production verifier is mandatory. */
export async function buildSoulAuthoringRegistrationTransaction(input: {
  manifest: SoulAuthoringManifest; preparation: WalrusBatchPreparation; kiosk: SoulAuthoringKiosk
  uploader: Pick<AuthoringUploader, 'appendRegisterCalls'>
}) {
  const composer = createSoulAuthoringTransactionComposer(input.manifest, input.preparation), selected = kioskInput(input.kiosk)
  const author = input.manifest.request.author, hasFiles = input.preparation.manifest.files.length > 0
  const tx = new Transaction(); tx.setSender(author)
  if (hasFiles) await input.uploader.appendRegisterCalls(tx)
  check(tx.getData().sender === author, 'SENDER_CHANGED')
  composer.appendRegistrationBusiness(tx, selected)
  return tx
}
/** Certify the selected original files and consume private Blob objects in
 * the same mint transaction. Public cover-only completion has no mint suffix. */
export async function buildSoulAuthoringMintTransaction(input: {
  manifest: SoulAuthoringManifest; preparation: WalrusBatchPreparation; blobIds: readonly string[]
  chunk: SoulAuthoringMintChunk; uploader: Pick<AuthoringUploader, 'appendCertifyCalls'>
}) {
  const composer = createSoulAuthoringTransactionComposer(input.manifest, input.preparation)
  const stage = composer.prepareMintBusiness(input.preparation, input.blobIds, input.chunk)
  const author = input.manifest.request.author, tx = new Transaction(); tx.setSender(author)
  await input.uploader.appendCertifyCalls(tx, stage.fileIndices)
  check(tx.getData().sender === author, 'SENDER_CHANGED')
  stage.append(tx)
  return { transaction: tx, fileIndices: stage.fileIndices }
}
