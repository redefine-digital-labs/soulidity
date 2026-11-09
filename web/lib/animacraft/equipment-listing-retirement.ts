import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { collectionCommandRaw } from '../collections/collection-command-plan'
import { historicalMoveObjectType, readHistoricalFailedSharedRoot, readHistoricalMoveObject } from '../sui/historical-object'
import { readHistoricalParentTransaction } from '../sui/historical-parent-lineage'
import { readPinnedMovePackage } from '../sui/pinned-move-package'
import type { EpochCheckpoint } from '../sui/epoch-checkpoint'
import { MAINNET_GENESIS_DIGEST } from './mainnet-chain'
import { marketListCanonical as canonical, marketListCheck as check, marketListDigest } from './market-list-operation'
import { EquipmentMarketListingBcs } from './native-equipment-market-bcs'
import { decodeNativeBcs } from './native-receive'
import { equipmentOperationQuote } from './equipment-market-operation'
import type { EquipmentMarketOperationRecord, EquipmentRetirementWitness } from './equipment-market-operation-types'

type Listing = ReturnType<typeof EquipmentMarketListingBcs.parse>
type Pointer = { version: string; digest: string; writer: string }
type Indexed = { address?: string; version?: number; digest?: string; objectBcs?: string } | null
const zero = '0x' + '0'.repeat(64)
const hex = (value: number[]) => toHex(Uint8Array.from(value))
const functions = new Set(['reprice_equipment_listing_v8', 'purchase_base_equipment_v8', 'purchase_external_equipment_v8',
  'cancel_base_equipment_listing_v8', 'cancel_external_equipment_listing_v8',
  'recover_base_equipment_listing_v8', 'recover_external_equipment_listing_v8'])

function listingIdentity(listing: Listing) {
  const { gross_atomic: _gross, protocol_atomic: _fee, creator_atomic: _creator, source_atomic: _source, seller_atomic: _seller,
    quote_commitment: _quote, status: _status, revision: _revision, terminal_recipient: _recipient, ...identity } = listing
  return canonical(identity)
}

/** The paired Market V8 gates each successful edit/exit on its open revision,
 * advances it on success and retains the terminal listing. A newer version is
 * only a locator until checkpoint effects prove which transaction advanced it. */
export async function proveEquipmentListingRetirement(input: {
  client: SuiGrpcClient; signal: AbortSignal; record: EquipmentMarketOperationRecord; checkpoint: EpochCheckpoint
  candidate?: string; observed?: Indexed
}): Promise<EquipmentRetirementWitness> {
  const { client, signal, record, checkpoint, candidate, observed } = input
  const s = record.snapshot, t = s.target, saved = s.listing, pin = s.release.equipmentMarket!
  check(saved, 'Exact original component listing required')
  const { id: objectId, revision } = saved
  const original = Transaction.from(fromBase64(record.bytes)).getData()
  const shared = original.inputs.find(row => row.Object?.SharedObject?.objectId === objectId)?.Object?.SharedObject
  check(shared?.mutable, 'Exact original component listing birth required')
  const birth = String(shared.initialSharedVersion)
  const pkg = await readPinnedMovePackage(client, pin, signal), origin = pkg.origins.get('market_v8::EquipmentListingV8')
  check(origin, 'Component retirement listing type origin missing')
  const type = normalizeStructTag(`${origin}::market_v8::EquipmentListingV8<${t.paymentCoinType}>`)
  const decode = (contents: Uint8Array) => {
    const l = decodeNativeBcs(EquipmentMarketListingBcs, contents), c = l.custody, base = s.asset.kind === 'base'
    const quote = equipmentOperationQuote(s, l.gross_atomic)
    check(l.id === objectId && l.version === '8' && l.registry_id === t.registryId && l.treasury_id === t.treasuryId
      && l.package_config_id === t.packageConfigId && l.root_id === t.rootId && l.maker_version === s.quoteContext.makerVersion
      && hex(l.root_content_commitment) === s.quoteContext.rootContentCommitment
      && c.version === '8' && c.catalog_id === t.catalogId && c.listing_id === objectId && c.market_registry_id === l.registry_id
      && c.market_treasury_id === l.treasury_id && c.root_id === l.root_id && c.maker_version === l.maker_version
      && hex(c.root_content_commitment) === s.quoteContext.rootContentCommitment
      && c.asset_id === s.asset.itemId && c.holder === s.seller && c.ownership_epoch === s.ownershipEpoch
      && c.asset_kind === (base ? 0 : 2) && c.source_id === (s.asset.kind === 'base' ? s.asset.baseRegistryId : s.asset.productId)
      && hex(c.asset_commitment) === s.assetCommitment
      && l.protocol_atomic === quote.protocolAtomic && l.seller_atomic === quote.sellerAtomic
      && l.creator_atomic === '0' && l.source_atomic === '0' && hex(l.quote_commitment) === quote.commitment
      && [0, 1, 2, 3].includes(l.status)
      && (l.status === 0 ? l.terminal_recipient === zero : l.status === 1
        ? l.terminal_recipient !== zero && l.terminal_recipient !== s.seller : l.terminal_recipient === s.seller),
    'Component retirement listing identity or quote changed')
    return l
  }
  const exactOriginalState = (listing: Listing) => listing.status === 0 && listing.revision === revision
    && listing.gross_atomic === saved.priceAtomic && hex(listing.quote_commitment) === saved.quoteCommitment

  async function readStep(digest: string, maxCheckpoint: string, pointer?: Pointer) {
    check(marketListDigest(digest) && digest !== record.digest, 'Original component transaction found in listing history')
    const tx = await readHistoricalParentTransaction({ client, signal, transactionDigest: digest, maxCheckpoint,
      chainIdentifier: '35834a8a', genesisDigest: MAINNET_GENESIS_DIGEST })
    check(tx.sharedInputs.some(row => row.objectId === objectId && row.mutable && String(row.initialSharedVersion) === birth),
      'Component retirement candidate did not write the original listing')
    const params = { client, signal, objectId, type, maxBytes: 4096, effects: tx.effects, transactionDigest: digest }
    const failed = tx.executionStatus === 'Failure'
    const [input, output] = await Promise.all(failed ? [
      readHistoricalFailedSharedRoot({ ...params, mode: 'input' }), readHistoricalFailedSharedRoot({ ...params, mode: 'mutated' }),
    ] : [
      readHistoricalMoveObject({ ...params, mode: 'input' }), readHistoricalMoveObject({ ...params, mode: 'mutated' }),
    ])
    check(input.object.owner.Shared?.initialSharedVersion === birth && output.object.owner.Shared?.initialSharedVersion === birth
      && (!pointer || pointer.version === String(output.reference.version) && pointer.digest === output.reference.digest),
    'Component retirement listing lineage mismatch')
    const before = decode(input.bytes), after = decode(output.bytes)
    const advanced = BigInt(after.revision) > BigInt(before.revision)
    if (advanced) {
      const data = Transaction.from(tx.transactionBytes).getData()
      check(!failed && before.status === 0 && listingIdentity(before) === listingIdentity(after) && data.commands.some(({ MoveCall: call }) => {
        const first = call?.arguments[0]
        return call?.package === pin.callablePackageId && call.module === 'market_v8' && functions.has(call.function)
          && first?.$kind === 'Input' && data.inputs[first.Input]?.Object?.SharedObject?.objectId === objectId
      }), 'Component retirement listing transition not qualified')
    } else check(canonical(before) === canonical(after), 'Component retirement listing revision regressed or changed in place')
    return { before, advanced, checkpoint: tx.checkpoint,
      predecessor: { version: String(input.reference.version), digest: input.reference.digest, writer: input.object.previousTransaction } }
  }

  if (candidate !== undefined) {
    const step = await readStep(candidate, checkpoint.sequenceNumber)
    check(step.advanced && exactOriginalState(step.before), 'Conflicting transaction did not consume the original listing revision')
    return { kind: 'LISTING', objectId, conflict: { digest: candidate, checkpoint: step.checkpoint } }
  }
  check(observed?.address === objectId && Number.isSafeInteger(observed.version) && typeof observed.digest === 'string'
    && typeof observed.objectBcs === 'string' && observed.objectBcs.length <= 16384, 'Indexed original component listing unavailable')
  const version = String(observed.version), raw = collectionCommandRaw({ objectId, version, digest: observed.digest, bcs: observed.objectBcs })
  check(raw.previousTransaction !== record.digest, 'Original component transaction found in indexed listing')
  check(raw.owner.Shared?.initialSharedVersion === birth && raw.data.Move && historicalMoveObjectType(raw.data.Move.type) === type,
    'Indexed component listing type or birth mismatch')
  const listing = decode(raw.data.Move.contents)
  if (exactOriginalState(listing)) return { kind: 'LISTING', objectId }
  check(!record.retirement?.witness && BigInt(listing.revision) > BigInt(revision), 'Indexed component listing revision mismatch')
  let pointer = { version, digest: observed.digest, writer: raw.previousTransaction }, upper = checkpoint.sequenceNumber
  for (let hop = 0; hop < 8; hop++) {
    const step = await readStep(pointer.writer, upper, pointer)
    if (step.advanced && exactOriginalState(step.before)) return { kind: 'LISTING', objectId, conflict: { digest: pointer.writer, checkpoint: step.checkpoint } }
    check(BigInt(step.before.revision) > BigInt(revision), 'Original component listing revision could not be authenticated')
    pointer = step.predecessor
    upper = step.checkpoint
  }
  throw Error('Component listing history exceeds the search limit; supply the conflicting transaction digest')
}
