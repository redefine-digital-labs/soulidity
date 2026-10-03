import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, fromBase64, toBase64, toHex } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { profileReadStep, SoulStatePublicBcs, addAssertGrantMutationSnapshotCalls,
  addAssertPaidMutationSnapshotCalls, addAssertPaidMarketSnapshotCalls, addIssueGrantCalls, addSetGrantCapacityCalls,
  buildRevokeGrantTx, buildRevokeGrantScopeTx, buildConfigurePaidAccessKindTx, buildUpdatePaidAccessKindTx,
  buildDeletePaidAccessKindTx, buildPurchasePaidAccessTx, buildRevokePaidAccessTx } from '@soulidity/sdk'
import { SOUL_ACCESS_MAX, SOUL_ACCESS_CLOCK, parseSoulAccessPlan, assertSoulAccessAuthority,
  soulAccessBcs, soulAccessCheck as check, soulAccessExact as exact, soulAccessAddress as id,
  soulAccessUint as uint, soulAccessDigest as digest, soulAccessDecode as decode, soulAccessSame as same,
  soulAccessIsGrant, soulAccessUsesMarket, type SoulAccessPlan, type SoulAccessRecord,
  type SoulAccessQuery, type SoulAccessState } from './soul-access-plan'
import { readSoulAccessState, readSoulAccessPaymentCoin, soulAccessSignal } from './soul-access-state'
import { proveSoulAccessHistory } from './soul-access-history'

export * from './soul-access-plan'
export * from './soul-access-state'

/** Every complete browser operation begins with exact on-chain preconditions.
 * Payment inputs are frozen owned references before SDK resolution; no coin can
 * be silently reselected between a displayed quote and its wallet prompt. */
export function buildSoulAccessTransaction(input: SoulAccessPlan): Transaction {
  const p = parseSoulAccessPlan(input), s = soulAccessBcs(SoulStatePublicBcs, p.expected.stateBcs), e = p.expected
  const d = { packageId: p.deployment.callablePackageId, marketConfigId: p.deployment.marketConfigId,
    kindRegistryId: p.deployment.kindRegistryId, paymentCoinType: p.deployment.paymentCoinType }
  const tx = new Transaction()
  for (const coin of p.input.paymentCoins) tx.objectRef({ objectId: coin.objectId, version: coin.version, digest: coin.digest })
  if (soulAccessIsGrant(p.action)) {
    addAssertGrantMutationSnapshotCalls(tx, { stateObjectId: p.stateId, soulObjectId: p.soulId,
      granteeAddress: p.granteeAddress!, snapshot: { ownershipEpoch: p.ownershipEpoch, capacity: s.grant_capacity,
        activeGrantCount: s.active_grant_count, slotBcs: e.grantSlotBcs, live: e.grantLive! } }, d)
    if (p.action === 'grant-issue') {
      if (BigInt(p.quote.capacity!) > BigInt(s.grant_capacity)) addSetGrantCapacityCalls(tx, { stateObjectId: p.stateId, capacity: Number(p.quote.capacity) }, d)
      addIssueGrantCalls(tx, { stateObjectId: p.stateId, granteeAddress: p.granteeAddress!, scopeMask: p.quote.scopeMask,
        expiresAtMs: p.input.expiresAtMs }, d)
    } else if (p.action === 'grant-revoke') buildRevokeGrantTx({ stateObjectId: p.stateId, granteeAddress: p.granteeAddress! }, d, tx)
    else buildRevokeGrantScopeTx({ stateObjectId: p.stateId, granteeAddress: p.granteeAddress!, revokedScopeMask: p.input.scopeMask! }, d, tx)
  } else {
    addAssertPaidMutationSnapshotCalls(tx, { paidAccessListObjectId: p.paidAccessListId, stateObjectId: p.stateId,
      soulObjectId: p.soulId, kind: p.kind!, granteeAddress: p.granteeAddress, snapshot: { ownershipEpoch: p.ownershipEpoch,
        configBcs: e.paidConfigBcs, buyerTableBcs: e.buyerTableBcs, entryBcs: e.paidEntryBcs } }, d)
    if (soulAccessUsesMarket(p.action)) addAssertPaidMarketSnapshotCalls(tx, { marketConfigObjectId: p.deployment.marketConfigId,
      marketConfigBcs: e.marketConfigBcs! }, d)
    const roots = { paidAccessListObjectId: p.paidAccessListId, stateObjectId: p.stateId, kind: p.kind! }
    if (p.action === 'paid-configure' || p.action === 'paid-update') {
      const params = { ...roots, kindRegistryObjectId: p.deployment.kindRegistryId, priceAtomic: p.input.priceAtomic!,
        scopeMask: p.quote.scopeMask, durationMs: p.input.durationMs }
      if (p.action === 'paid-configure') buildConfigurePaidAccessKindTx(params, d, tx)
      else buildUpdatePaidAccessKindTx(params, d, tx)
    } else if (p.action === 'paid-delete') buildDeletePaidAccessKindTx(roots, d, tx)
    else if (p.action === 'paid-revoke') buildRevokePaidAccessTx({ ...roots, granteeAddress: p.granteeAddress! }, d, tx)
    else buildPurchasePaidAccessTx({ ...roots, paymentCoinObjectIds: p.input.paymentCoins.map(coin => coin.objectId),
      totalAtomic: p.quote.totalAtomic }, d, tx)
  }
  return tx
}

export function parseSoulAccessRecord(input: unknown): SoulAccessRecord {
  const r = structuredClone(input) as SoulAccessRecord
  exact(r, ['schema', 'plan', 'packet']); check(r.schema === 'soulidity.soul-access.v1', 'INVALID_SCHEMA')
  r.plan = parseSoulAccessPlan(r.plan)
  const p = r.plan, packet = r.packet
  exact(packet, ['bytes', 'digest', 'expirationEpoch', 'phase', 'signature']); uint(packet.expirationEpoch); digest(packet.digest)
  check(['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(packet.phase), 'INVALID_PHASE')
  check(packet.signature === null || typeof packet.signature === 'string' && packet.signature.length > 0
    && packet.signature.length <= 32768 && toBase64(fromBase64(packet.signature)) === packet.signature, 'INVALID_SIGNATURE')
  check(packet.phase !== 'SIGNED' || packet.signature !== null, 'SIGNATURE_REQUIRED')
  check(!['PREPARED', 'SIGNING', 'CANCELLED'].includes(packet.phase) || packet.signature === null, 'UNEXPECTED_SIGNATURE')
  check(typeof packet.bytes === 'string' && packet.bytes.length > 0 && packet.bytes.length <= 180000, 'BYTE_BUDGET')
  const bytes = fromBase64(packet.bytes), raw = decode(bcs.TransactionData, bytes), data = Transaction.from(bytes).getData()
  check(toBase64(bytes) === packet.bytes && TransactionDataBuilder.getDigestFromBytes(bytes) === packet.digest, 'DIGEST_MISMATCH')
  check(raw.V1 && data.sender === p.author && data.gasData.owner === p.author
    && String(raw.V1.expiration.Epoch) === packet.expirationEpoch, 'SENDER_EXPIRATION_MISMATCH')
  uint(data.gasData.budget, true); uint(data.gasData.price, true)
  const expected = buildSoulAccessTransaction(p).getData()
  // SDK-only argument hints (Input.type) are not serialized. Compare the full
  // canonical command BCS, including every result/index and type argument.
  const commands = (rows: typeof data.commands) => rows.map(row => {
    check(['MoveCall', 'MergeCoins', 'SplitCoins'].includes(row.$kind), 'TEMPLATE_MISMATCH')
    return toBase64(bcs.Command.serialize(row as Parameters<typeof bcs.Command.serialize>[0]).toBytes())
  })
  check(same(commands(data.commands), commands(expected.commands)) && data.inputs.length === expected.inputs.length, 'TEMPLATE_MISMATCH')
  const objects = new Set<string>([p.soulId, p.stateId, p.contentId, p.paidAccessListId, p.deployment.originalPackageId,
    p.deployment.callablePackageId, p.deployment.marketConfigId, p.deployment.kindRegistryId, SOUL_ACCESS_CLOCK])
  expected.inputs.forEach((wanted, index) => {
    const actual = data.inputs[index]
    if (wanted.Pure) { check(actual?.Pure?.bytes === wanted.Pure.bytes, 'PURE_ARGUMENT_MISMATCH'); return }
    if (wanted.Object?.ImmOrOwnedObject) {
      const coin = wanted.Object.ImmOrOwnedObject
      check(same(actual?.Object?.ImmOrOwnedObject, coin), 'PAYMENT_REFERENCE_MISMATCH'); objects.add(coin.objectId); return
    }
    const objectId = wanted.UnresolvedObject?.objectId
    check(objectId, 'UNEXPECTED_TEMPLATE_INPUT'); objects.add(objectId)
    const shared = actual.Object?.SharedObject
    const mutable = objectId === (soulAccessIsGrant(p.action) ? p.stateId : p.paidAccessListId)
    check(shared?.objectId === objectId && shared.mutable === mutable, 'SHARED_REFERENCE_MISMATCH')
    uint(shared.initialSharedVersion, true)
  })
  const payments = data.gasData.payment
  check(payments && payments.length > 0 && payments.length <= 256
    && new Set(payments.map(row => row.objectId)).size === payments.length, 'GAS_REQUIRED')
  payments.forEach(row => { id(row.objectId); uint(row.version, true); digest(row.digest); check(!objects.has(row.objectId), 'GAS_OVERLAP') })
  return r
}

export interface SoulAccessAdapterParams {
  client: SuiGrpcClient; getAddress: () => string | null
  sign: (tx: Transaction) => Promise<{ bytes: string; signature: string }>
  /** Extra application release/lifecycle checks; never a replacement for raw authority. */
  preflight?: (plan: SoulAccessPlan, signing: boolean) => Promise<void>
  /** Testable transport boundary. Production defaults to the raw reader above. */
  read?: (plan: SoulAccessPlan, signal: AbortSignal) => Promise<SoulAccessState>
}
export function createSoulAccessAdapter(params: SoulAccessAdapterParams) {
  const { client, getAddress, sign } = params
  async function chain(p: SoulAccessPlan, signal: AbortSignal) {
    const { chainIdentifier } = await profileReadStep(signal, () => client.core.getChainIdentifier()); digest(chainIdentifier)
    check(toHex(fromBase58(chainIdentifier).subarray(0, 4)) === p.deployment.chainIdentifier, 'WRONG_CHAIN')
  }
  async function epoch(signal: AbortSignal) {
    const { response } = await profileReadStep(signal, () => client.ledgerService.getEpoch({ readMask: { paths: ['epoch'] } }, { abort: signal }))
    const value = response.epoch?.epoch
    check(typeof value === 'bigint' && value >= 0n && value < SOUL_ACCESS_MAX, 'EPOCH_UNAVAILABLE'); return value
  }
  const wallet = (p: SoulAccessPlan) => check(getAddress() === p.author, 'WALLET_CHANGED')
  async function ready(p: SoulAccessPlan, packet: SoulAccessRecord['packet'] | null, signing: boolean) {
    const signal = soulAccessSignal(); wallet(p); await chain(p, signal)
    if (params.preflight) await profileReadStep(signal, () => params.preflight!(structuredClone(p), signing))
    const observed = await profileReadStep(signal, () => params.read ? params.read(structuredClone(p), signal)
      : readSoulAccessState({ client, deployment: p.deployment, soulId: p.soulId, stateId: p.stateId, contentId: p.contentId,
        paidAccessListId: p.paidAccessListId, author: p.author, ...(p.kind === null ? {} : { kind: p.kind }),
        ...(p.granteeAddress === null ? {} : { granteeAddress: p.granteeAddress }), signal }))
    assertSoulAccessAuthority(p, observed)
    for (const coin of p.input.paymentCoins) {
      const current = await readSoulAccessPaymentCoin({ client, author: p.author, paymentCoinType: p.deployment.paymentCoinType, objectId: coin.objectId, signal })
      check(same(current, coin), 'PAYMENT_CHANGED')
    }
    if (packet) {
      const current = await epoch(signal), expiration = BigInt(packet.expirationEpoch)
      check(current <= expiration, 'EXPIRED_QUERY_ONLY')
      check(expiration <= current + 1n, 'EXPIRATION_OUTSIDE_PREPARED_WINDOW')
    }
    wallet(p)
  }
  async function simulate(r: SoulAccessRecord) {
    const signal = soulAccessSignal(), bytes = fromBase64(r.packet.bytes), tx = Transaction.from(bytes).getData()
    const { protocolConfig } = await profileReadStep(signal, () => client.core.getProtocolConfig())
    const limit = (key: string) => { const value = protocolConfig.attributes[key]; uint(value, true); return BigInt(value) }
    check(BigInt(bytes.length) <= limit('max_tx_size_bytes') && BigInt(tx.commands.length) <= limit('max_programmable_tx_commands'), 'PROTOCOL_LIMIT')
    for (const input of tx.inputs) if (input.Pure) check(BigInt(fromBase64(input.Pure.bytes).length) <= limit('max_pure_argument_size'), 'PURE_ARGUMENT_LIMIT')
    const { response } = await profileReadStep(signal, () => client.transactionExecutionService.simulateTransaction({
      transaction: { bcs: { value: bytes } }, checks: 0, doGasSelection: false,
      readMask: { paths: ['transaction.transaction.bcs', 'transaction.effects.status'] },
    }, { abort: signal }))
    check(response.transaction?.transaction?.bcs?.value && toBase64(response.transaction.transaction.bcs.value) === r.packet.bytes
      && response.transaction.effects?.status?.success === true, 'SIMULATION_REJECTED')
  }
  async function verify(r: SoulAccessRecord) {
    check(r.packet.signature, 'SIGNATURE_REQUIRED')
    await profileReadStep(soulAccessSignal(), () => verifyTransactionSignature(fromBase64(r.packet.bytes), r.packet.signature!, { address: r.plan.author, client }))
  }
  return {
    async prepare(input: SoulAccessPlan): Promise<SoulAccessRecord> {
      const plan = parseSoulAccessPlan(input); await ready(plan, null, true)
      const signal = soulAccessSignal(), expirationEpoch = String(await epoch(signal) + 1n), tx = buildSoulAccessTransaction(plan)
      tx.setSender(plan.author); tx.setExpiration({ Epoch: expirationEpoch })
      const bytes = await profileReadStep(signal, () => tx.build({ client })); wallet(plan)
      const record = parseSoulAccessRecord({ schema: 'soulidity.soul-access.v1', plan, packet: {
        bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch, phase: 'PREPARED', signature: null } })
      await simulate(record); wallet(plan); return record
    },
    async preflight(input: SoulAccessRecord, signing: boolean) {
      const r = parseSoulAccessRecord(input); await ready(r.plan, r.packet, signing); await simulate(r); wallet(r.plan)
    },
    async sign(input: SoulAccessRecord) {
      const r = parseSoulAccessRecord(input); check(['PREPARED', 'SIGNING'].includes(r.packet.phase), 'NOT_SIGNABLE')
      await ready(r.plan, r.packet, true); await simulate(r)
      const signed = await profileReadStep(soulAccessSignal(), () => sign(Transaction.from(fromBase64(r.packet.bytes))))
      wallet(r.plan); check(signed.bytes === r.packet.bytes, 'WALLET_CHANGED_BYTES')
      await verify(parseSoulAccessRecord({ ...r, packet: { ...r.packet, phase: 'SIGNED', signature: signed.signature } })); return signed
    },
    async verifySignature(input: SoulAccessRecord) { await verify(parseSoulAccessRecord(input)) },
    async broadcast(input: SoulAccessRecord) {
      const r = parseSoulAccessRecord(input); check(r.packet.phase === 'SIGNED', 'NOT_SIGNED')
      await ready(r.plan, r.packet, false); await verify(r); wallet(r.plan)
      await profileReadStep(soulAccessSignal(), () => client.core.executeTransaction({ transaction: fromBase64(r.packet.bytes), signatures: [r.packet.signature!] }))
    },
    async query(input: SoulAccessRecord): Promise<SoulAccessQuery> {
      const r = parseSoulAccessRecord(input), signal = soulAccessSignal(); await chain(r.plan, signal)
      let response
      try { response = (await profileReadStep(signal, () => client.ledgerService.getTransaction({ digest: r.packet.digest,
        readMask: { paths: ['digest', 'transaction.digest', 'transaction.bcs', 'effects.bcs', 'effects.transaction_digest', 'effects.status', 'checkpoint'] },
      }, { abort: signal }))).response }
      catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return { status: 'MISSING' }; throw error }
      const value = response.transaction
      check(value?.digest === r.packet.digest && value.transaction?.digest === r.packet.digest && value.transaction.bcs?.value
        && toBase64(value.transaction.bcs.value) === r.packet.bytes && value.effects?.transactionDigest === r.packet.digest
        && value.effects.bcs?.value && value.effects.bcs.value.length > 0 && value.effects.bcs.value.length <= 256 * 1024, 'EVIDENCE_MISMATCH')
      const effects = decode(bcs.TransactionEffects, value.effects.bcs.value), e = effects.V2
      check(e && e.transactionDigest === r.packet.digest && ['Success', 'Failure'].includes(e.status.$kind)
        && value.effects.status?.success === (e.status.$kind === 'Success') && BigInt(e.executedEpoch) <= BigInt(r.packet.expirationEpoch), 'STATUS_MISMATCH')
      if (value.checkpoint === undefined) return { status: 'PENDING' }
      check(typeof value.checkpoint === 'bigint' && value.checkpoint >= 0n && value.checkpoint <= SOUL_ACCESS_MAX, 'CHECKPOINT_INVALID')
      const checkpoint = String(value.checkpoint)
      if (e.status.$kind === 'Failure') return { status: 'FAILED', checkpoint }
      const proof = await proveSoulAccessHistory({ record: r, effects, client, signal })
      signal.throwIfAborted(); return { status: 'SUCCEEDED', checkpoint, ...proof }
    },
  }
}
