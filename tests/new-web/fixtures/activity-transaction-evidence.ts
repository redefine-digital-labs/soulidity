import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, fromBase64, toBase58, toBase64 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { vi } from 'vitest'
import { MarketCancelCheckpointSummaryBcs } from '../../../web/lib/animacraft/market-cancel-checkpoint'

// Controlled ledger, NOT executed Move or a validator certificate. Transaction
// bytes come from the actual installed SDK. The independent fixture schemas
// below follow the approved Sui 722 source; no tested codec is imported.
export const aid = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
export const adigest = (n: number) => toBase58(new Uint8Array(32).fill(n))
export const activityGenesis = '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S'
export function activityHash(domain: string, bytes: Uint8Array) {
  return toBase58(blake2b(new Uint8Array([...new TextEncoder().encode(`${domain}::`), ...bytes]), { dkLen: 32 }))
}
const D = bcs.byteVector().transform({ input: (v: string) => fromBase58(v), output: (v: Uint8Array) => toBase58(v) })
const ED = bcs.struct('ExecutionDigests', { transaction: D, effects: D })
export const ActivityFixtureContentsBcs = bcs.enum('CheckpointContents', {
  V1: bcs.struct('CheckpointContentsV1', { transactions: bcs.vector(ED), user_signatures: bcs.vector(bcs.vector(bcs.byteVector())) }),
  V2: bcs.struct('CheckpointContentsV2', { transactions: bcs.vector(bcs.struct('CheckpointTransactionContents', {
    digest: ED, user_signatures: bcs.vector(bcs.tuple([bcs.byteVector(), bcs.option(bcs.u64())])),
  })) }),
})
export const ActivityFixtureEventsBcs = bcs.struct('TransactionEvents', { data: bcs.vector(bcs.struct('Event', {
  package_id: bcs.Address, transaction_module: bcs.string(), sender: bcs.Address,
  type_: bcs.StructTag, contents: bcs.byteVector(),
})) })
const gas = { computationCost: '1', storageCost: '2', storageRebate: '0', nonRefundableStorageFee: '0' }
export async function activityEvidenceFixture(options: { effectsVersion?: 1 | 2; contentsVersion?: 1 | 2; wrapper?: boolean; empty?: boolean } = {}) {
  const effectsVersion = options.effectsVersion ?? 2, contentsVersion = options.contentsVersion ?? 2
  const deployment = { originalPackageId: aid(42), callablePackageId: aid(43), callableDigest: adigest(1), chainIdentifier: '35834a8a' }
  const sender = aid(7), external = aid(90)
  const tx = new Transaction()
  tx.setSender(sender); tx.setGasOwner(sender); tx.setGasPrice(1); tx.setGasBudget(1000)
  tx.setGasPayment([{ objectId: aid(8), version: '2', digest: adigest(8) }])
  tx.moveCall({ target: `${deployment.callablePackageId}::market::buy`, arguments: [] })
  tx.moveCall({ target: `${options.wrapper ? external : deployment.callablePackageId}::${options.wrapper ? 'wrapper::forward' : 'grant::issue'}`, arguments: [] })
  tx.moveCall({ target: `${external}::pool::swap`, arguments: [] })
  const originalTransactionBytes = await tx.build()
  const transactionData = bcs.TransactionData.parse(originalTransactionBytes)
  const event = (module: string, name: string, headerModule = module, headerPackage = deployment.callablePackageId) => ({
    package_id: headerPackage, transaction_module: headerModule, sender,
    type_: { address: deployment.originalPackageId, module, name, typeParams: [] }, contents: new Uint8Array([1, 2, 3]),
  })
  const eventsData = ActivityFixtureEventsBcs.parse(ActivityFixtureEventsBcs.serialize({ data: options.empty ? [] : [
    event('soul', 'SoulOwnershipRotated', 'market'),
    event('grant', 'SoulGrantIssued', options.wrapper ? 'wrapper' : 'grant', options.wrapper ? external : deployment.callablePackageId),
    event('grant', 'SoulGrantSuperseded', options.wrapper ? 'wrapper' : 'grant', options.wrapper ? external : deployment.callablePackageId),
    { ...event('pool', 'Swap', 'pool', external), type_: { address: external, module: 'pool', name: 'Swap', typeParams: [{ vector: { u64: null } }] } },
  ] }).toBytes())
  const packageData = bcs.Object.parse(bcs.Object.serialize({ data: { Package: {
    id: deployment.callablePackageId, version: '2', moduleMap: new Map([['grant', new Uint8Array([1])], ['market', new Uint8Array([2])], ['soul', new Uint8Array([3])]]),
    typeOriginTable: [
      { moduleName: 'grant', datatypeName: 'SoulGrantIssued', package: deployment.originalPackageId },
      { moduleName: 'grant', datatypeName: 'SoulGrantSuperseded', package: deployment.originalPackageId },
      { moduleName: 'soul', datatypeName: 'SoulOwnershipRotated', package: deployment.originalPackageId },
    ], linkageTable: new Map(),
  } }, owner: { Immutable: true }, previousTransaction: adigest(9), storageRebate: '0' }).toBytes())
  const effectsData = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize(effectsVersion === 2 ? { V2: {
    status: { Success: true }, executedEpoch: '5', gasUsed: gas, transactionDigest: adigest(1), gasObjectIndex: null,
    eventsDigest: null, dependencies: [], lamportVersion: '10', changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null,
  } } : { V1: { status: { Success: true }, executedEpoch: '5', gasUsed: gas, transactionDigest: adigest(1),
    modifiedAtVersions: [], sharedObjects: [], created: [], mutated: [], unwrapped: [], deleted: [], unwrappedThenDeleted: [], wrapped: [],
    gasObject: [{ objectId: aid(8), version: '10', digest: adigest(8) }, { AddressOwner: sender }], eventsDigest: null, dependencies: [],
  } }).toBytes())
  const contentsData = ActivityFixtureContentsBcs.parse(ActivityFixtureContentsBcs.serialize(contentsVersion === 2 ? { V2: { transactions: [
    { digest: { transaction: adigest(80), effects: adigest(81) }, user_signatures: [] },
    { digest: { transaction: adigest(1), effects: adigest(2) }, user_signatures: [[new Uint8Array(97), '9007199254740993']] },
  ] } } : { V1: { transactions: [{ transaction: adigest(80), effects: adigest(81) }, { transaction: adigest(1), effects: adigest(2) }],
    user_signatures: [[], [new Uint8Array(97)]] } }).toBytes())
  const summaryData = MarketCancelCheckpointSummaryBcs.parse(MarketCancelCheckpointSummaryBcs.serialize({ epoch: '5', sequence_number: '100',
    network_total_transactions: '9007199254740997', content_digest: [...fromBase58(adigest(1))], previous_digest: [...fromBase58(adigest(3))],
    epoch_rolling_gas_cost_summary: { computation_cost: '1', storage_cost: '2', storage_rebate: '0', non_refundable_storage_fee: '0' },
    timestamp_ms: '1789464703686', checkpoint_commitments: [], end_of_epoch_data: null, version_specific_data: [],
  }).toBytes())
  const ledger: any = {}, checkpoint: any = {}, pkg: any = {}
  let transactionDigest = ''
  function rehashPackage() {
    const raw = bcs.Object.serialize(packageData).toBytes(), value = packageData.data.Package!
    const hash = activityHash('Object', raw)
    Object.assign(pkg, { objectId: value.id, version: BigInt(value.version), digest: hash, bcs: { value: raw }, owner: { kind: 4 },
      package: { storageId: value.id, originalId: deployment.originalPackageId, version: BigInt(value.version) } })
    deployment.callableDigest = hash
  }
  function rehashSummary() {
    const raw = MarketCancelCheckpointSummaryBcs.serialize(summaryData).toBytes(), hash = activityHash('CheckpointSummary', raw)
    Object.assign(checkpoint, { sequenceNumber: BigInt(summaryData.sequence_number), digest: hash, summary: {
      bcs: { value: raw }, digest: hash, epoch: BigInt(summaryData.epoch), sequenceNumber: BigInt(summaryData.sequence_number),
      totalNetworkTransactions: BigInt(summaryData.network_total_transactions), contentDigest: toBase58(Uint8Array.from(summaryData.content_digest)),
      previousDigest: summaryData.previous_digest === null ? undefined : toBase58(Uint8Array.from(summaryData.previous_digest)),
      timestamp: { seconds: BigInt(summaryData.timestamp_ms) / 1000n, nanos: Number(BigInt(summaryData.timestamp_ms) % 1000n) * 1_000_000 },
    } })
  }
  function rehashContents() {
    const raw = ActivityFixtureContentsBcs.serialize(contentsData).toBytes(), hash = activityHash('CheckpointContents', raw)
    checkpoint.contents = { bcs: { value: raw }, digest: hash, version: contentsVersion }
    summaryData.content_digest = [...fromBase58(hash)]; rehashSummary()
  }
  function rehashEffects() {
    const raw = bcs.TransactionEffects.serialize(effectsData).toBytes(), hash = activityHash('TransactionEffects', raw)
    const e = effectsData.V2 ?? effectsData.V1!
    ledger.effects = { bcs: { value: raw }, digest: hash, transactionDigest: e.transactionDigest, version: effectsVersion,
      epoch: BigInt(e.executedEpoch), status: { success: e.status.$kind === 'Success' }, eventsDigest: e.eventsDigest ?? undefined }
    const entry = contentsData.V2 ? contentsData.V2.transactions[1].digest : contentsData.V1!.transactions[1]
    entry.transaction = transactionDigest; entry.effects = hash; rehashContents()
  }
  function rehashEvents() {
    const raw = ActivityFixtureEventsBcs.serialize(eventsData).toBytes(), hash = activityHash('TransactionEvents', raw)
    const e = effectsData.V2 ?? effectsData.V1!
    e.eventsDigest = eventsData.data.length ? hash : null
    ledger.events = eventsData.data.length ? { bcs: { value: raw }, digest: hash } : undefined
    rehashEffects()
  }
  function rehashTransaction() {
    const raw = bcs.TransactionData.serialize(transactionData).toBytes()
    transactionDigest = TransactionDataBuilder.getDigestFromBytes(raw)
    Object.assign(ledger, { digest: transactionDigest, transaction: { bcs: { value: raw }, digest: transactionDigest, sender: transactionData.V1.sender },
      checkpoint: BigInt(summaryData.sequence_number), timestamp: { seconds: BigInt(summaryData.timestamp_ms) / 1000n, nanos: Number(BigInt(summaryData.timestamp_ms) % 1000n) * 1_000_000 } })
    ;(effectsData.V2 ?? effectsData.V1!).transactionDigest = transactionDigest
    rehashEvents()
  }
  rehashPackage(); rehashTransaction()
  const client = { ledgerService: {
    getServiceInfo: vi.fn(async (..._args: unknown[]) => ({ response: { chainId: activityGenesis } })),
    getTransaction: vi.fn(async (..._args: unknown[]) => ({ response: { transaction: ledger } })),
    getCheckpoint: vi.fn(async (..._args: unknown[]) => ({ response: { checkpoint } })),
    getObject: vi.fn(async (..._args: unknown[]) => ({ response: { object: pkg } })),
  } }
  return { deployment, client, sender, ledger, checkpoint, pkg, transactionData, effectsData, eventsData, contentsData, summaryData, packageData,
    originalTransactionBytes: toBase64(originalTransactionBytes), rehashPackage, rehashSummary, rehashContents, rehashEffects, rehashEvents, rehashTransaction,
    params: (signal?: AbortSignal) => ({ client: client as any, deployment, transactionDigest, signal }),
    checkpointParams: (signal?: AbortSignal) => ({ client: client as any, chainIdentifier: deployment.chainIdentifier, checkpoint: summaryData.sequence_number, signal }),
  }
}

// Public read-only mainnet wire capture, 2026-09-15, checkpoint 322877185.
// Raw BCS was returned by the official ledger, not constructed by our schemas.
// This is wire compatibility evidence only, not a target-release certificate.
export function capturedActivityCheckpoint() {
  return {
    sequenceNumber: 322877185n, digest: "FLF59G7m5G9hHhx9iqhVKkQyCg4eS7Yp9XqQWuxY5dco",
    summary: {
      bcs: { value: fromBase64("4wQAAAAAAAABtz4TAAAAAFiHRWEBAAAAIBNRQwqm2i794XV5MyfUqWGtHCK2hLUK/TjHLL2oix83ASAQJpP7RhAycDqQU8LkOUIKDou9hMlm+CQo6z7pLffg34qNkOWaAAAAQK4uDGc4AAC4o+0XiDcAAOiuzpiPAAAA53FopKABAAABASDaYbxt9ShxnjlyxYbT8J1THU7f5IDQuFKZ+lY/2E0KAAACAAA=") },
      digest: "FLF59G7m5G9hHhx9iqhVKkQyCg4eS7Yp9XqQWuxY5dco", epoch: 1251n, sequenceNumber: 322877185n,
      totalNetworkTransactions: 5926913880n, contentDigest: "2JQcemuH3Hz7iKcBxayZr4AdCW5at4x23EWdCMeKPsgi",
      previousDigest: "263eDyskZpumqYREJVFYVPj17jJCsrDpDXZqHScsQDs4", timestamp: { seconds: 1789464703n, nanos: 463000000 },
    },
    contents: { bcs: { value: fromBase64("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") }, digest: "2JQcemuH3Hz7iKcBxayZr4AdCW5at4x23EWdCMeKPsgi", version: 2 },
  }
}
