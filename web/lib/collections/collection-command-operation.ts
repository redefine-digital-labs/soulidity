import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { profileReadStep, buildListCollectionTx, buildDelistCollectionTx, buildUpdateCollectionListingPriceTx } from '@soulidity/sdk'
import { check, id, uint, digest, exact, same, decode, freeze, parseCollectionCommandPlan, collectionCommandRaw,
  COLLECTION_COMMAND_MAX, type CollectionCommandPlan, type CollectionCommandRecord, type CollectionCommandQuery } from './collection-command-plan'
import { assertCollectionCommandCurrent, collectionCommandSignal, collectionCommandChain } from './collection-command-state'
import { readCollectionOriginalEvidence, verifyCollectionOriginalSignature } from './collection-original-evidence'
import { proveCollectionCommandHistory } from './collection-command-history'
import { readCollectionGasWindow, setCollectionGasWindow } from './collection-command-gas'

export function buildCollectionCommandTransaction(input: CollectionCommandPlan) {
  const p = parseCollectionCommandPlan(input), tx = new Transaction(), pkg = p.target.callablePackageId
  const cap = p.objects.find(row => row.objectId === p.kioskCapId)!
  tx.objectRef({ objectId: cap.objectId, version: cap.version, digest: cap.digest })
  const guard = (name: string, objectId: string, bytes: string) => tx.moveCall({ target: `${pkg}::market::${name}`,
    arguments: [tx.object(objectId), tx.pure.vector('u8', fromBase64(bytes))] })
  guard('assert_collection_command_snapshot', p.request.collectionId, p.expected.collectionBcs)
  if (p.oldListingId) guard('assert_collection_listing_snapshot', p.oldListingId, p.expected.listingBcs!)
  if (p.request.action !== 'delist') guard('assert_collection_market_snapshot_v2', p.target.marketConfigId, p.expected.marketBcs!)
  const target = { packageId: pkg, marketConfigId: p.target.marketConfigId, kioskRegistryId: p.target.kioskRegistryId }
  const roots = { currentKioskId: p.kioskId, currentKioskCapOnChainId: p.kioskCapId, collectionObjectId: p.request.collectionId }
  if (p.request.action === 'list') buildListCollectionTx({ ...roots, priceAtomic: BigInt(p.request.priceAtomic!) }, target, tx)
  else if (p.request.action === 'reprice') buildUpdateCollectionListingPriceTx({ ...roots, listingObjectId: p.oldListingId!, newPriceAtomic: BigInt(p.request.priceAtomic!) }, target, tx)
  else buildDelistCollectionTx({ ...roots, listingObjectId: p.oldListingId! }, target, tx)
  return tx
}
export function parseCollectionCommandRecord(input: unknown): CollectionCommandRecord {
  const r = structuredClone(input) as CollectionCommandRecord
  exact(r, ['schema', 'plan', 'packet']); check(r.schema === 'soulidity.collection-command.v1', 'RECORD_SCHEMA')
  r.plan = parseCollectionCommandPlan(r.plan); const p = r.plan, packet = r.packet
  exact(packet, ['bytes', 'digest', 'expirationEpoch', 'phase', 'signature']); uint(packet.expirationEpoch); digest(packet.digest)
  check(['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(packet.phase), 'PHASE_INVALID')
  check(packet.signature === null || typeof packet.signature === 'string' && packet.signature.length > 0
    && packet.signature.length <= 32768 && toBase64(fromBase64(packet.signature)) === packet.signature, 'SIGNATURE_INVALID')
  check(packet.phase !== 'SIGNED' || packet.signature !== null, 'SIGNATURE_REQUIRED')
  check(!['PREPARED', 'SIGNING', 'CANCELLED'].includes(packet.phase) || packet.signature === null, 'UNEXPECTED_SIGNATURE')
  check(typeof packet.bytes === 'string' && packet.bytes.length > 0 && packet.bytes.length <= 180000, 'PACKET_BUDGET')
  const bytes = fromBase64(packet.bytes), raw = decode(bcs.TransactionData, bytes), data = Transaction.from(bytes).getData()
  check(toBase64(bytes) === packet.bytes && TransactionDataBuilder.getDigestFromBytes(bytes) === packet.digest, 'PACKET_DIGEST')
  check(raw.V1 && data.sender === p.author && data.gasData.owner === p.author, 'PACKET_AUTHORITY')
  uint(data.gasData.price, true); uint(data.gasData.budget, true)
  readCollectionGasWindow(data, packet.expirationEpoch, p.target.chainIdentifier)
  const template = buildCollectionCommandTransaction(p).getData()
  const commands = (rows: typeof data.commands) => rows.map(row => {
    check(row.$kind === 'MoveCall', 'UNEXPECTED_COMMAND')
    return toBase64(bcs.Command.serialize(row as Parameters<typeof bcs.Command.serialize>[0]).toBytes())
  })
  check(same(commands(data.commands), commands(template.commands)) && data.inputs.length === template.inputs.length, 'TEMPLATE_CHANGED')
  const objectIds = new Set(p.objects.map(row => row.objectId))
  template.inputs.forEach((wanted, index) => {
    const actual = data.inputs[index]
    if (wanted.Pure) { check(actual?.Pure?.bytes === wanted.Pure.bytes, 'PURE_CHANGED'); return }
    if (wanted.Object?.ImmOrOwnedObject) { check(same(actual?.Object?.ImmOrOwnedObject, wanted.Object.ImmOrOwnedObject), 'CAP_REFERENCE_CHANGED'); return }
    const objectId = wanted.UnresolvedObject?.objectId, observed = p.objects.find(row => row.objectId === objectId)
    check(objectId && observed, 'UNKNOWN_OBJECT_INPUT')
    const birth = collectionCommandRaw(observed).owner.Shared?.initialSharedVersion
    const mutable = objectId === p.kioskId || objectId === p.oldListingId || objectId === p.target.kioskRegistryId
    check(birth && same(actual.Object?.SharedObject, { objectId, initialSharedVersion: birth, mutable }), 'SHARED_REFERENCE_CHANGED')
  })
  const gas = data.gasData.payment
  check(gas && new Set(gas.map(row => row.objectId)).size === gas.length, 'GAS_REQUIRED')
  gas.forEach(row => { id(row.objectId); uint(row.version, true); digest(row.digest); check(!objectIds.has(row.objectId) && !p.absentIds.includes(row.objectId), 'GAS_ALIAS') })
  return freeze(r)
}
export async function queryCollectionCommandOriginal({ client, record: input, signal: parent }: {
  client: SuiGrpcClient; record: CollectionCommandRecord; signal?: AbortSignal
}): Promise<CollectionCommandQuery> {
  const record = parseCollectionCommandRecord(input), signal = collectionCommandSignal(parent)
  const result = await readCollectionOriginalEvidence(client, record, signal)
  if (result.status !== 'SUCCEEDED') return result
  const receipt = await proveCollectionCommandHistory({ client, record, effects: result.effects, events: result.events, signal })
  return { status: 'SUCCEEDED', checkpoint: result.checkpoint, receipt }
}

export interface CollectionCommandAdapter {
  prepare(plan: CollectionCommandPlan): Promise<CollectionCommandRecord>
  preflight(record: CollectionCommandRecord, signing: boolean): Promise<void>
  sign(record: CollectionCommandRecord): Promise<{ bytes: string; signature: string }>
  verifySignature(record: CollectionCommandRecord): Promise<void>
  broadcast(record: CollectionCommandRecord): Promise<void>
  query(record: CollectionCommandRecord): Promise<CollectionCommandQuery>
}
export function createCollectionCommandAdapter(params: {
  client: SuiGrpcClient; getAddress: () => string | null; sign: (tx: Transaction) => Promise<{ bytes: string; signature: string }>
  preflight?: (plan: CollectionCommandPlan, signing: boolean) => Promise<void>
  read?: (plan: CollectionCommandPlan, signal: AbortSignal) => Promise<void>
}): CollectionCommandAdapter {
  const { client } = params
  const wallet = (p: CollectionCommandPlan) => check(params.getAddress() === p.author, 'WALLET_OR_LIFECYCLE_CHANGED')
  async function epoch(signal: AbortSignal) {
    const value = (await profileReadStep(signal, () => client.ledgerService.getEpoch({ readMask: { paths: ['epoch'] } }, { abort: signal }))).response.epoch?.epoch
    check(typeof value === 'bigint' && value >= 0n && value < COLLECTION_COMMAND_MAX, 'EPOCH_UNAVAILABLE'); return value
  }
  async function ready(p: CollectionCommandPlan, packet: CollectionCommandRecord['packet'] | null, signing: boolean) {
    const signal = collectionCommandSignal(); wallet(p)
    const genesis = await collectionCommandChain(client, p.target, signal)
    if (params.preflight) await profileReadStep(signal, () => params.preflight!(p, signing))
    if (params.read) await profileReadStep(signal, () => params.read!(p, signal))
    else await assertCollectionCommandCurrent({ client, plan: p, signal })
    if (packet) {
      const now = await epoch(signal), data = Transaction.from(fromBase64(packet.bytes)).getData()
      const { min, max } = readCollectionGasWindow(data, packet.expirationEpoch, p.target.chainIdentifier, genesis)
      check(min <= now && now <= max && max <= now + 1n, 'EXPIRED_QUERY_ONLY')
    }
    wallet(p)
    return genesis
  }
  async function simulate(r: CollectionCommandRecord) {
    const signal = collectionCommandSignal(), bytes = fromBase64(r.packet.bytes), tx = Transaction.from(bytes).getData()
    const { protocolConfig } = await profileReadStep(signal, () => client.core.getProtocolConfig())
    const limit = (key: string) => { const n = protocolConfig.attributes[key]; uint(n, true); return BigInt(n) }
    check(BigInt(bytes.length) <= limit('max_tx_size_bytes') && BigInt(tx.commands.length) <= limit('max_programmable_tx_commands'), 'PROTOCOL_LIMIT')
    for (const input of tx.inputs) if (input.Pure) check(BigInt(fromBase64(input.Pure.bytes).length) <= limit('max_pure_argument_size'), 'PURE_LIMIT')
    const { response } = await profileReadStep(signal, () => client.transactionExecutionService.simulateTransaction({ transaction: { bcs: { value: bytes } },
      checks: 0, doGasSelection: false, readMask: { paths: ['transaction.transaction.bcs', 'transaction.effects.status'] } }, { abort: signal }))
    check(response.transaction?.transaction?.bcs?.value && toBase64(response.transaction.transaction.bcs.value) === r.packet.bytes
      && response.transaction.effects?.status?.success === true, 'SIMULATION_REJECTED')
  }
  const verify = (record: CollectionCommandRecord) => verifyCollectionOriginalSignature(client, record, collectionCommandSignal())
  return {
    async prepare(input) {
      const plan = parseCollectionCommandPlan(input), genesis = await ready(plan, null, true)
      const signal = collectionCommandSignal(), tx = buildCollectionCommandTransaction(plan)
      tx.setSender(plan.author)
      const expirationEpoch = setCollectionGasWindow(tx, genesis, await epoch(signal))
      const bytes = await profileReadStep(signal, () => tx.build({ client })); wallet(plan)
      const record = parseCollectionCommandRecord({ schema: 'soulidity.collection-command.v1', plan,
        packet: { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch, phase: 'PREPARED', signature: null } })
      await simulate(record); wallet(plan); return record
    },
    async preflight(input, signing) { const r = parseCollectionCommandRecord(input); await ready(r.plan, r.packet, signing); await simulate(r); wallet(r.plan) },
    async sign(input) {
      const r = parseCollectionCommandRecord(input); check(['PREPARED', 'SIGNING'].includes(r.packet.phase), 'NOT_SIGNABLE')
      await ready(r.plan, r.packet, true); await simulate(r); wallet(r.plan)
      // No post-wallet lifecycle guard here: the caller must durably save an
      // exact late signature before the subsequent preflight blocks broadcast.
      const signed = await params.sign(Transaction.from(fromBase64(r.packet.bytes)))
      check(signed.bytes === r.packet.bytes, 'WALLET_CHANGED_BYTES')
      await verify(parseCollectionCommandRecord({ ...r, packet: { ...r.packet, phase: 'SIGNED', signature: signed.signature } })); return signed
    },
    async verifySignature(input) { await verify(parseCollectionCommandRecord(input)) },
    async broadcast(input) {
      const r = parseCollectionCommandRecord(input); check(r.packet.phase === 'SIGNED', 'NOT_SIGNED')
      await ready(r.plan, r.packet, false); await verify(r); wallet(r.plan)
      await profileReadStep(collectionCommandSignal(), () => client.core.executeTransaction({ transaction: fromBase64(r.packet.bytes), signatures: [r.packet.signature!] }))
    },
    query: record => queryCollectionCommandOriginal({ client, record }),
  }
}
