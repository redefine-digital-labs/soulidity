import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import { marketListDigest } from '../animacraft/market-list-operation'
import { validateEpochCheckpoint, type EpochCheckpoint } from '../sui/epoch-checkpoint'
import { readEpochExpiry } from '../sui/epoch-expiry'
import { historicalMoveObjectType } from '../sui/historical-object'
import { proveExplicitInputConflict, validateExplicitGasConflict } from '../soulidity/commerce/explicit-gas-conflict'
import { readIndexedRetirementSnapshot } from '../soulidity/commerce/indexed-retirement-snapshot'
import { readCollectionGasWindow } from './collection-command-gas'
import { check, collectionCommandRaw, exact, type CollectionCommandRecord } from './collection-command-plan'
import type { CollectionBuyRecord } from './collection-buy-plan'

type CollectionTradeRecord = CollectionBuyRecord | CollectionCommandRecord
export interface CollectionRetirement {
  checkpoint: EpochCheckpoint
  objectId: string
  conflict?: { digest: string; checkpoint: string }
}
const prefix = 'COLLECTION_RETIREMENT'

function witnessIds(record: CollectionTradeRecord) {
  return record.schema === 'soulidity.collection-buy.v1' ? record.plan.paymentCoinIds : [record.plan.kioskCapId]
}

export function validateCollectionRetirement(record: CollectionTradeRecord) {
  const { packet, retirement } = record
  check((packet.phase === 'RETIRED') === (retirement !== undefined), 'RETIREMENT_PHASE')
  if (!retirement) return
  exact(retirement, retirement.conflict === undefined ? ['checkpoint', 'objectId'] : ['checkpoint', 'objectId', 'conflict'])
  exact(retirement.checkpoint, ['bytes', 'digest', 'epoch', 'sequenceNumber'])
  validateEpochCheckpoint(retirement.checkpoint, packet.expirationEpoch)
  check(witnessIds(record).includes(retirement.objectId), 'RETIREMENT_WITNESS_ID')
  if (retirement.conflict !== undefined) {
    exact(retirement.conflict, ['digest', 'checkpoint'])
    validateExplicitGasConflict({ ...retirement.conflict, coinId: retirement.objectId }, packet, retirement.checkpoint, prefix)
  }
}

/** Sui advances address-owned exclusive input versions in effects. A purchase
 * commits exact payment Coins and seller actions commit an exact personal Kiosk
 * Cap. Either can witness expiry when gas is paid from an address balance. */
export async function verifyCollectionExpiry(input: {
  client: SuiGrpcClient; record: CollectionTradeRecord; signal: AbortSignal; conflictDigest?: string; queryOriginal: () => Promise<{ status: string }>
}): Promise<CollectionRetirement> {
  const { client, signal, queryOriginal, conflictDigest } = input
  const { packet, plan, retirement } = input.record
  check(plan.target.chainIdentifier === '35834a8a', 'RETIREMENT_MAINNET')
  check(conflictDigest === undefined || !retirement && marketListDigest(conflictDigest) && conflictDigest !== packet.digest,
    'RETIREMENT_CONFLICT_DIGEST')
  const tx = Transaction.from(fromBase64(packet.bytes)).getData()
  readCollectionGasWindow(tx, packet.expirationEpoch, plan.target.chainIdentifier, MAINNET_GENESIS_DIGEST)
  const ownedTypes = new Map<string, string>()
  const refs = witnessIds(input.record).map(objectId => {
    const row = plan.objects.find(object => object.objectId === objectId)
    const ref = tx.inputs.find(input => input.Object?.ImmOrOwnedObject?.objectId === objectId)?.Object?.ImmOrOwnedObject
    check(row && ref && ref.digest === row.digest && String(ref.version) === row.version, 'RETIREMENT_WITNESS_REF')
    const raw = collectionCommandRaw(row)
    check(raw.data.Move && raw.owner.AddressOwner === plan.author, 'RETIREMENT_WITNESS_OWNER')
    ownedTypes.set(objectId, historicalMoveObjectType(raw.data.Move.type))
    return ref
  })
  const saved = retirement?.checkpoint, savedConflict = retirement?.conflict && { ...retirement.conflict, coinId: retirement.objectId }
  const candidate = savedConflict?.digest ?? conflictDigest
  const primary = refs.find(ref => ref.objectId === retirement?.objectId) ?? refs[0]
  const expiry = (sequence?: string) => readEpochExpiry(client, packet.expirationEpoch, signal, MAINNET_GENESIS_DIGEST, saved, prefix, sequence)
  const proof = (checkpoint: EpochCheckpoint, conflict: Parameters<typeof proveExplicitInputConflict>[0]['candidate']) =>
    proveExplicitInputConflict({ client, signal, originalDigest: packet.digest, author: plan.author, originalRefs: refs,
      ownedTypes, maxCheckpoint: checkpoint.sequenceNumber, candidate: conflict, saved: savedConflict, prefix })

  let checkpoint: EpochCheckpoint, conflict: Awaited<ReturnType<typeof proof>> | undefined
  if (candidate !== undefined) {
    checkpoint = await expiry()
    conflict = await proof(checkpoint, candidate)
  } else {
    const indexed = await readIndexedRetirementSnapshot({ packet, saved, objectId: primary.objectId, signal, prefix })
    const object = indexed.query.object
    check(object?.address === primary.objectId && Number.isSafeInteger(object.version) && BigInt(object.version!) >= BigInt(primary.version)
      && typeof object.digest === 'string' && typeof object.objectBcs === 'string' && object.objectBcs.length <= 16384,
    'RETIREMENT_WITNESS_UNAVAILABLE')
    const version = String(object.version), unchanged = version === String(primary.version)
    check(unchanged ? object.digest === primary.digest : !retirement && object.digest !== primary.digest, 'RETIREMENT_WITNESS_CHANGED')
    const raw = collectionCommandRaw({ objectId: primary.objectId, version, digest: object.digest, bcs: object.objectBcs })
    check(raw.data.Move && historicalMoveObjectType(raw.data.Move.type) === ownedTypes.get(primary.objectId)
      && raw.owner.AddressOwner && (!unchanged || raw.owner.AddressOwner === plan.author), 'RETIREMENT_WITNESS_OBJECT')
    checkpoint = await expiry(String(indexed.sequenceNumber))
    check(checkpoint.digest === indexed.digest && checkpoint.epoch === String(indexed.epoch!.epochId), 'RETIREMENT_CHECKPOINT_MISMATCH')
    if (!unchanged) conflict = await proof(checkpoint, { version, digest: object.digest, writer: raw.previousTransaction })
  }
  check((await queryOriginal()).status === 'MISSING', 'RETIREMENT_ORIGINAL_FOUND')
  signal.throwIfAborted()
  return conflict
    ? { checkpoint, objectId: conflict.coinId, conflict: { digest: conflict.digest, checkpoint: conflict.checkpoint } }
    : { checkpoint, objectId: primary.objectId }
}
