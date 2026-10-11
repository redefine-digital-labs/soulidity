import { bcs } from '@mysten/sui/bcs'
import { blake2b } from '@noble/hashes/blake2.js'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64, toBase58 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { validateMarketCancelCheckpoint } from './market-cancel-checkpoint'
import { MAINNET_GENESIS_DIGEST } from './mainnet-chain'
import { buildMarketCancelOperationTransaction, marketCancelCheck as check, marketCancelReleaseKey,
  validateMarketCancelOperationRecord, validateMarketCancelSnapshot,
  type MarketCancelSnapshot, type MarketCancelOperationRecord, type MarketCancelOperationAdapter } from './market-cancel-operation'

const TIMEOUT_MS = 25_000
const WALLET_TIMEOUT_MS = 120_000
/** A late provider/RPC promise has no continuation into signing or broadcasting.
 * Timeout is unknown, never a wallet rejection or a failed transaction. */
async function bounded<T>(work: (signal: AbortSignal) => PromiseLike<T>, timeoutMs = TIMEOUT_MS): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([Promise.resolve().then(() => work(controller.signal)), new Promise<never>((_resolve,reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Cancellation request timed out; recover the saved transaction')) }, timeoutMs)
    })])
  } finally { clearTimeout(timer) }
}
// Exact sui_types::effects::TransactionEvents and sui_types::event::Event BCS.
const EventBcs = bcs.struct('Event', { package_id: bcs.Address, transaction_module: bcs.string(), sender: bcs.Address,
  type_: bcs.StructTag, contents: bcs.vector(bcs.u8()) })
const EventsBcs = bcs.struct('TransactionEvents', { data: bcs.vector(EventBcs) })
const CancelEventBcs = bcs.struct('SoulListingCancelled', { listing_id: bcs.Address, soul_id: bcs.Address, seller: bcs.Address })

/** Queries and receipt synchronization deliberately do not request live write
 * configuration or a connected wallet. A saved transaction remains recoverable. */
export function createMarketCancelOperationAdapter(params: {
  client: SuiGrpcClient
  read: (listingId?: string, capId?: string) => Promise<MarketCancelSnapshot>
  observed?: MarketCancelSnapshot
  getAddress: () => string | null
  sign: (transaction: Transaction) => Promise<{ bytes: string; signature: string }>
  sync: (record: MarketCancelOperationRecord) => Promise<'COMPLETE' | 'SUPERSEDED'>
}): MarketCancelOperationAdapter {
  const { client, read, getAddress, sign, sync } = params
  const observed = params.observed ? validateMarketCancelSnapshot(params.observed) : undefined
  async function chain() {
    const { response } = await bounded(abort => client.ledgerService.getServiceInfo({}, { abort, timeout: TIMEOUT_MS }))
    check(response.chainId === MAINNET_GENESIS_DIGEST, 'Mainnet cancellation RPC required')
  }
  async function epoch() {
    const { response } = await bounded(abort => client.ledgerService.getEpoch({ readMask: { paths: ['epoch'] } }, { abort, timeout: TIMEOUT_MS }))
    const value = response.epoch?.epoch
    check(typeof value === 'bigint' && value >= 0n && value < 18446744073709551615n, 'Current epoch unavailable')
    return value
  }
  async function fresh(listingId?: string, capId?: string) {
    await chain(); return validateMarketCancelSnapshot(await bounded(() => read(listingId, capId)))
  }
  function same(snapshot: MarketCancelSnapshot, expected: Pick<MarketCancelOperationRecord,
    'soulId'|'stateId'|'bindingId'|'owner'|'kioskId'|'kioskCapId'|'ownershipEpoch'|'listingId'|'release'>) {
    check(['soulId','stateId','bindingId','owner','kioskId','kioskCapId','ownershipEpoch','listingId'].every(
      key => snapshot[key as 'soulId'] === expected[key as 'soulId'])
      && marketCancelReleaseKey(snapshot.release) === marketCancelReleaseKey(expected.release),
    'Cancellation identity, listing or release changed; refresh before acting')
  }
  function writable(snapshot: MarketCancelSnapshot, owner: string) {
    check(snapshot.release.writesEnabled, 'Cancellation signing is disabled until this release is accepted')
    check(getAddress() === owner && snapshot.owner === owner, 'Connect the current Soul owner wallet')
    check(snapshot.listed && snapshot.listingActive, 'This native listing is no longer active')
  }
  return {
    async expiryCheckpoint(value) {
      const record = validateMarketCancelOperationRecord(value)
      await chain()
      const { response } = await bounded(abort => client.ledgerService.getCheckpoint({ checkpointId: { oneofKind: undefined },
        readMask: { paths: ['sequence_number','digest','summary','signature'] } }, { abort, timeout: TIMEOUT_MS }))
      const checkpoint = response.checkpoint; const summary = checkpoint?.summary
      check(checkpoint && summary?.bcs?.value && checkpoint.digest === summary.digest
        && typeof summary.epoch === 'bigint' && typeof summary.sequenceNumber === 'bigint'
        && checkpoint.sequenceNumber === summary.sequenceNumber && checkpoint.signature?.epoch === summary.epoch
        && checkpoint.signature.signature?.length === 48 && checkpoint.signature.bitmap?.length,
      'Executed cancellation checkpoint evidence unavailable or inconsistent')
      return validateMarketCancelCheckpoint({ bytes: toBase64(summary.bcs.value),digest:checkpoint.digest,
        epoch:String(summary.epoch),sequenceNumber:String(summary.sequenceNumber) },record.expirationEpoch)
    },
    async prepare() {
      check(observed, 'Refresh the native listing before acting')
      const snapshot = await fresh(observed.listingId, observed.kioskCapId)
      same(snapshot, observed); writable(snapshot, observed.owner)
      const expirationEpoch = String(await epoch() + 1n)
      const tx = buildMarketCancelOperationTransaction(snapshot)
      tx.setSender(snapshot.owner); tx.setExpiration({ Epoch: expirationEpoch })
      const bytes = await bounded(() => tx.build({ client }))
      check(getAddress() === snapshot.owner, 'Wallet changed while preparing cancellation')
      const { soulId,stateId,bindingId,owner,kioskId,kioskCapId,ownershipEpoch,listingId,release } = snapshot
      return validateMarketCancelOperationRecord({ schema: 1, kind: 'cancel-listing',
        soulId,stateId,bindingId,owner,kioskId,kioskCapId,ownershipEpoch,listingId,release,
        bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes),
        expirationEpoch, phase: 'PREPARED', signature: null })
    },
    async preflight(value) {
      const record = validateMarketCancelOperationRecord(value)
      check(['PREPARED','SIGNING','SIGNED'].includes(record.phase), 'Terminal cancellation cannot sign or rebroadcast')
      const snapshot = await fresh(record.listingId, record.kioskCapId)
      same(snapshot, record); writable(snapshot, record.owner)
      check(await epoch() <= BigInt(record.expirationEpoch), 'Saved cancellation expired; query its result without rebuilding it')
      check(getAddress() === record.owner, 'Wallet changed during cancellation preflight')
    },
    async sign(value) {
      const record = validateMarketCancelOperationRecord(value)
      check(record.phase === 'PREPARED' || record.phase === 'SIGNING', 'Terminal or signed cancellation cannot request a signature')
      check(getAddress() === record.owner, 'Wallet changed before cancellation signature')
      return bounded(() => sign(Transaction.from(fromBase64(record.bytes))), WALLET_TIMEOUT_MS)
    },
    async verifySignature(value) {
      const record = validateMarketCancelOperationRecord(value)
      check(record.signature, 'Cancellation signature missing')
      await bounded(() => verifyTransactionSignature(fromBase64(record.bytes), record.signature!, { address: record.owner, client }))
    },
    async broadcast(value) {
      const record = validateMarketCancelOperationRecord(value)
      check(record.phase === 'SIGNED', 'Only an active signed cancellation can broadcast')
      check(getAddress() === record.owner && record.signature, 'Wallet changed; query the saved cancellation')
      await bounded(signal => client.core.executeTransaction({ transaction: fromBase64(record.bytes), signatures: [record.signature!], signal }))
    },
    async query(value) { return (await queryMarketCancelOperationEvidence(value, client)).status },
    async sync(value) { const record = validateMarketCancelOperationRecord(value); return bounded(() => sync(record)) },
  }
}

export type MarketCancelOperationEvidence = { status: 'MISSING' | 'PENDING' | 'FAILED' } | {
  status: 'SUCCEEDED'; checkpoint: string; receipt: ReturnType<typeof CancelEventBcs.parse>;
  effects: ReturnType<typeof bcs.TransactionEffects.parse>; originalPackageId: string
}
/** Shared historical proof for query and browser post-success readback. */
export async function queryMarketCancelOperationEvidence(value: MarketCancelOperationRecord, client: SuiGrpcClient): Promise<MarketCancelOperationEvidence> {
      const record = validateMarketCancelOperationRecord(value)
      const { response: service } = await bounded(abort => client.ledgerService.getServiceInfo({}, { abort, timeout: TIMEOUT_MS }))
      check(service.chainId === MAINNET_GENESIS_DIGEST, 'Mainnet cancellation RPC required')
      let response
      try {
        response = (await bounded(abort => client.ledgerService.getTransaction({ digest: record.digest, readMask: { paths: [
          'digest','transaction.digest','transaction.bcs','effects.bcs','effects.transaction_digest','effects.status','checkpoint','events',
        ] } }, { abort, timeout: TIMEOUT_MS }))).response
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return { status: 'MISSING' }
        throw error
      }
      const found = structuredClone(response.transaction)
      check(found?.digest === record.digest && found.transaction?.digest === record.digest
        && found.transaction.bcs?.value && toBase64(found.transaction.bcs.value) === record.bytes
        && found.effects?.transactionDigest === record.digest && found.effects.bcs?.value,
      'Cancellation transaction evidence mismatch')
      const bytes = found.effects.bcs.value
      const decoded = bcs.TransactionEffects.parse(bytes)
      check(toBase64(bcs.TransactionEffects.serialize(decoded).toBytes()) === toBase64(bytes), 'Noncanonical cancellation effects')
      const effects = decoded.V2 ?? decoded.V1
      check(effects?.transactionDigest === record.digest && ['Success','Failure'].includes(effects.status.$kind)
        && found.effects.status?.success === (effects.status.$kind === 'Success'), 'Cancellation transaction status mismatch')
      if (found.checkpoint === undefined) return { status: 'PENDING' }
      check(found.checkpoint >= 0n, 'Invalid cancellation checkpoint')
      if (effects.status.$kind === 'Success') {
        // Historical immutable callable evidence, not today's release/write gate.
        const packageId = record.release.soulidityCallablePackageId
        const { response } = await bounded(abort => client.ledgerService.getObject({ objectId: packageId,
          readMask: { paths: ['object_id','version','digest','owner','package'] } }, { abort, timeout: TIMEOUT_MS }))
        const object = response.object; const pkg = object?.package
        check(object?.objectId === packageId && object.digest === record.release.soulidityCallableDigest
          && object.owner?.kind === 4 && pkg?.storageId === packageId && pkg.version === object.version
          && pkg.originalId && /^0x[0-9a-f]{64}$/.test(pkg.originalId), 'Cancellation historical package mismatch')
        const origins = pkg.typeOrigins.filter(row => row.moduleName === 'market' && row.datatypeName === 'SoulListingCancelled')
        check(origins.length === 1 && origins[0].packageId === pkg.originalId, 'Cancellation event type origin mismatch')
        const eventBytes = found.events?.bcs?.value
        check(eventBytes && eventBytes.length <= 65536, 'Cancellation receipt events unavailable')
        const events = EventsBcs.parse(eventBytes)
        const prefix = new TextEncoder().encode('TransactionEvents::')
        const hash = toBase58(blake2b(new Uint8Array([...prefix,...eventBytes]), { dkLen: 32 }))
        check(toBase64(EventsBcs.serialize(events).toBytes()) === toBase64(eventBytes)
          && found.events?.digest === hash && effects.eventsDigest === hash, 'Cancellation receipt events digest mismatch')
        const matches = events.data.filter(event => event.type_.address === origins[0].packageId
          && event.type_.module === 'market' && event.type_.name === 'SoulListingCancelled')
        check(matches.length === 1, 'Unique native cancellation receipt required')
        const event = matches[0]
        check(event.package_id === packageId && event.transaction_module === 'market' && event.sender === record.owner
          && event.type_.typeParams.length === 0 && event.contents.length === 96, 'Cancellation event authority mismatch')
        const contents = Uint8Array.from(event.contents); const receipt = CancelEventBcs.parse(contents)
        check(toBase64(CancelEventBcs.serialize(receipt).toBytes()) === toBase64(contents)
          && receipt.listing_id === record.listingId && receipt.soul_id === record.soulId && receipt.seller === record.owner,
        'Cancellation receipt identity mismatch')
        return { status: 'SUCCEEDED', checkpoint: String(found.checkpoint), receipt, effects: decoded, originalPackageId: pkg.originalId }
      }
      return { status: 'FAILED' }
}
