import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { addAssertGrantMutationSnapshotCalls, addAssertPaidMutationSnapshotCalls, addAssertPaidMarketSnapshotCalls,
  addAssertGrantCapacityCalls, addAssertPreservesGrantScopesCalls } from '../../packages/soulidity-sdk/src/tx/access-snapshot'
import { addIssueGrantCalls, addSetGrantCapacityCalls, buildRevokeGrantTx, buildRevokeGrantScopeTx,
  buildBatchIssueGrantsTx } from '../../packages/soulidity-sdk/src/tx/grant'
import { buildConfigurePaidAccessKindTx, buildUpdatePaidAccessKindTx, buildDeletePaidAccessKindTx,
  buildPurchasePaidAccessTx, buildAddPaidAccessTx, buildRevokePaidAccessTx, buildCleanupStalePaidAccessTx } from '../../packages/soulidity-sdk/src/tx/paid-access'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const deployment = { packageId: id(10), marketConfigId: id(11) }, U = bcs.u64(), A = bcs.Address
const Slot = bcs.struct('Slot', { version: U, grant_id: A, grantee: A, scope_mask: U, expires_at_ms: bcs.option(U), ownership_epoch_snapshot: U })
const Config = bcs.struct('Config', { version: U, price_atomic: U, scope_mask: U, duration_ms: bcs.option(U), ownership_epoch_snapshot: U })
const Entry = bcs.struct('Entry', { version: U, scope_mask: U, expires_at_ms: bcs.option(U), ownership_epoch_snapshot: U })
const Table = bcs.struct('Table', { id: A, size: U })
const Market = bcs.struct('Market', { id: A, version: U, legacy_config_id: A, fee_recipient: A, platform_fee_bps: bcs.u16(), primary_enabled: bcs.bool(), secondary_enabled: bcs.bool() })
const slotBcs = Slot.serialize({ version: 1, grant_id: id(20), grantee: id(5), scope_mask: 3, expires_at_ms: '18446744073709551615', ownership_epoch_snapshot: 0 }).toBase64()
const configBcs = Config.serialize({ version: 1, price_atomic: '9007199254740993', scope_mask: 8, duration_ms: '18446744073709551615', ownership_epoch_snapshot: 0 }).toBase64()
const entryBcs = Entry.serialize({ version: 1, scope_mask: 8, expires_at_ms: 7, ownership_epoch_snapshot: 0 }).toBase64()
const buyerTableBcs = Table.serialize({ id: id(30), size: 1 }).toBase64()
const marketConfigBcs = Market.serialize({ id: id(11), version: 1, legacy_config_id: id(0), fee_recipient: id(9), platform_fee_bps: 250, primary_enabled: true, secondary_enabled: false }).toBase64()
const roots = { stateObjectId: id(1), soulObjectId: id(2), paidAccessListObjectId: id(3), kindRegistryObjectId: id(4), granteeAddress: id(5), kind: 3 }
const grantSnapshot = { ownershipEpoch: '18446744073709551615', capacity: '3', activeGrantCount: '1', slotBcs, live: false }
const paidSnapshot = { ownershipEpoch: '18446744073709551615', configBcs, buyerTableBcs, entryBcs }
const paidParams = { ...roots, priceAtomic: '9007199254740993', scopeMask: 8, durationMs: '18446744073709551615', expiresAtMs: '1' }
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
function pure(tx: Transaction, command: number, argument: number) {
  const data = tx.getData(), ref = data.commands[command].MoveCall!.arguments[argument]
  if (ref.$kind !== 'Input' || data.inputs[ref.Input].$kind !== 'Pure') throw new Error('Expected pure input')
  return fromBase64(data.inputs[ref.Input].Pure!.bytes)
}
function resolvedTx() {
  const tx = new Transaction()
  for (const n of [1, 2, 3, 4, 5, 11, 40, 41]) tx.objectRef({ objectId: id(n), version: '1', digest: '11111111111111111111111111111111' })
  tx.sharedObjectRef({ objectId: id(6), initialSharedVersion: '1', mutable: false })
  return tx
}
it('grant guard preserves exact u64, physical stale slot bytes and live classification in real SDK bytes', async () => {
  const tx = resolvedTx()
  addAssertGrantMutationSnapshotCalls(tx, { ...roots, snapshot: grantSnapshot }, deployment)
  expect(bcs.Address.parse(pure(tx, 0, 1))).toBe(roots.soulObjectId)
  expect(U.parse(pure(tx, 0, 3))).toBe('18446744073709551615')
  expect(U.parse(pure(tx, 0, 4))).toBe('3')
  expect(U.parse(pure(tx, 0, 5))).toBe('1')
  expect(bcs.option(bcs.vector(bcs.u8())).parse(pure(tx, 0, 6))).toEqual(Array.from(fromBase64(slotBcs)))
  expect(bcs.bool().parse(pure(tx, 0, 7))).toBe(false)
  const raw = await tx.build({ onlyTransactionKind: true }), round = Transaction.fromKind(raw)
  expect(toBase64(await round.build({ onlyTransactionKind: true }))).toBe(toBase64(raw))
})
it('paid guard binds exact config, physical buyer Table and entry including expired or stale rows', async () => {
  const tx = resolvedTx()
  addAssertPaidMutationSnapshotCalls(tx, { ...roots, snapshot: paidSnapshot }, deployment)
  expect(bcs.option(A).parse(pure(tx, 0, 4))).toBe(roots.granteeAddress)
  expect(U.parse(pure(tx, 0, 5))).toBe('18446744073709551615')
  for (const [arg, raw] of [[6, configBcs], [7, buyerTableBcs], [8, entryBcs]] as const) {
    expect(bcs.option(bcs.vector(bcs.u8())).parse(pure(tx, 0, arg))).toEqual(Array.from(fromBase64(raw)))
  }
  const raw = await tx.build({ onlyTransactionKind: true })
  expect(toBase64(await Transaction.fromKind(raw).build({ onlyTransactionKind: true }))).toBe(toBase64(raw))
})
it('absent grant and config-only paid use explicit canonical None options', () => {
  const tx = new Transaction()
  addAssertGrantMutationSnapshotCalls(tx, { ...roots, snapshot: { ...grantSnapshot, slotBcs: null, live: false } }, deployment)
  addAssertPaidMutationSnapshotCalls(tx, { ...roots, granteeAddress: null,
    snapshot: { ownershipEpoch: '0', configBcs: null, buyerTableBcs: null, entryBcs: null } }, deployment)
  expect(bcs.option(bcs.vector(bcs.u8())).parse(pure(tx, 0, 6))).toBe(null)
  expect(bcs.option(A).parse(pure(tx, 1, 4))).toBe(null)
  for (const arg of [6, 7, 8]) expect(bcs.option(bcs.vector(bcs.u8())).parse(pure(tx, 1, arg))).toBe(null)
})
it('market guard signs all canonical fee, recipient and gate bytes', () => {
  const tx = new Transaction()
  addAssertPaidMarketSnapshotCalls(tx, { marketConfigObjectId: id(11), marketConfigBcs }, deployment)
  expect(bcs.vector(bcs.u8()).parse(pure(tx, 0, 1))).toEqual(Array.from(fromBase64(marketConfigBcs)))
})
it('append capacity and scope guards compose before grant mutations', () => {
  const tx = new Transaction()
  addAssertGrantCapacityCalls(tx, { ...roots, capacity: '0' }, deployment)
  addAssertPreservesGrantScopesCalls(tx, { ...roots, scopeMask: 15 }, deployment)
  addSetGrantCapacityCalls(tx, { ...roots, capacity: '3' }, deployment)
  addIssueGrantCalls(tx, { ...roots, scopeMask: 15, expiresAtMs: '18446744073709551615' }, deployment)
  expect(tx.getData().commands.map(c => c.MoveCall!.function)).toEqual(['assert_capacity', 'assert_preserves_active_scopes', 'set_grant_capacity', 'issue_to_grantee'])
  expect(U.parse(pure(tx, 0, 1))).toBe('0')
  expect(U.parse(pure(tx, 1, 2))).toBe('15')
})
const badU64 = [undefined, null, true, {}, [], '', '01', '+1', ' 1', '1 ', '-1', '1e2', '1.0', '0x1', -1, -1n,
  0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '18446744073709551616', 18446744073709551616n]
it('all snapshot scalar and root failures leave caller PTB unchanged', () => {
  const check = (run: (tx: Transaction) => void) => {
    const tx = new Transaction(), before = tx.getData()
    expect(() => run(tx)).toThrow(); expect(tx.getData()).toEqual(before)
  }
  for (const value of badU64) {
    for (const key of ['ownershipEpoch', 'capacity', 'activeGrantCount']) check(tx => addAssertGrantMutationSnapshotCalls(tx, { ...roots, snapshot: { ...grantSnapshot, [key]: value } as never }, deployment))
    check(tx => addAssertPaidMutationSnapshotCalls(tx, { ...roots, snapshot: { ...paidSnapshot, ownershipEpoch: value as never } }, deployment))
    check(tx => addAssertGrantCapacityCalls(tx, { ...roots, capacity: value as never }, deployment))
  }
  for (const value of [0, 16, -1, 1.5, NaN, 2 ** 32 + 1]) check(tx => addAssertPreservesGrantScopesCalls(tx, { ...roots, scopeMask: value }, deployment))
  for (const value of [false, {}, undefined, '']) check(tx => addAssertGrantMutationSnapshotCalls(tx, { ...roots, snapshot: value as never }, deployment))
  for (const value of ['false', 1, null, undefined]) check(tx => addAssertGrantMutationSnapshotCalls(tx, { ...roots, snapshot: { ...grantSnapshot, live: value as never } }, deployment))
  for (const key of ['stateObjectId', 'soulObjectId', 'granteeAddress']) check(tx => addAssertGrantMutationSnapshotCalls(tx, { ...roots, [key]: 'bad', snapshot: grantSnapshot }, deployment))
  for (const key of ['paidAccessListObjectId', 'stateObjectId', 'soulObjectId', 'granteeAddress']) check(tx => addAssertPaidMutationSnapshotCalls(tx, { ...roots, [key]: 'bad', snapshot: paidSnapshot }, deployment))
  check(tx => addAssertGrantMutationSnapshotCalls(tx, { ...roots, snapshot: grantSnapshot }, { packageId: 'bad' }))
  check(tx => addAssertPaidMutationSnapshotCalls(tx, { ...roots, snapshot: paidSnapshot }, { packageId: 'bad' }))
  check(tx => addAssertPaidMarketSnapshotCalls(tx, { marketConfigObjectId: 'bad', marketConfigBcs }, deployment))
})
it('BCS snapshots reject trailing, truncated, malformed and structurally unrelated bytes before changing PTB', () => {
  for (const value of [undefined, '', '%%', slotBcs.slice(1), toBase64(new Uint8Array([...fromBase64(slotBcs), 0])), entryBcs]) {
    const tx = new Transaction(), before = tx.getData()
    expect(() => addAssertGrantMutationSnapshotCalls(tx, { ...roots, snapshot: { ...grantSnapshot, slotBcs: value as never } }, deployment)).toThrow()
    expect(tx.getData()).toEqual(before)
  }
  for (const field of ['configBcs', 'buyerTableBcs', 'entryBcs'] as const) {
    for (const value of [undefined, '', '%%', toBase64(new Uint8Array([...fromBase64(paidSnapshot[field]), 0]))]) {
      const tx = new Transaction(), before = tx.getData()
      expect(() => addAssertPaidMutationSnapshotCalls(tx, { ...roots, snapshot: { ...paidSnapshot, [field]: value as never } }, deployment)).toThrow()
      expect(tx.getData()).toEqual(before)
    }
  }
  for (const value of [undefined, null, '', '%%', configBcs, toBase64(new Uint8Array([...fromBase64(marketConfigBcs), 0]))]) {
    const tx = new Transaction(), before = tx.getData()
    expect(() => addAssertPaidMarketSnapshotCalls(tx, { marketConfigObjectId: id(11), marketConfigBcs: value as never }, deployment)).toThrow()
    expect(tx.getData()).toEqual(before)
  }
})
it('snapshot shapes cannot hide a live absent slot, absent buyer table, or config-only buyer fields', () => {
  expect(() => addAssertGrantMutationSnapshotCalls(new Transaction(), { ...roots, snapshot: { ...grantSnapshot, slotBcs: null, live: true } }, deployment)).toThrow()
  expect(() => addAssertGrantMutationSnapshotCalls(new Transaction(), { ...roots, snapshot: { ...grantSnapshot, extra: 1 } as never }, deployment)).toThrow()
  expect(() => addAssertPaidMutationSnapshotCalls(new Transaction(), { ...roots, snapshot: { ...paidSnapshot, buyerTableBcs: null } }, deployment)).toThrow()
  expect(() => addAssertPaidMutationSnapshotCalls(new Transaction(), { ...roots, granteeAddress: null, snapshot: paidSnapshot }, deployment)).toThrow()
})
it('grant historical expiry reconstruction never reads wall clock and accepts full u64', () => {
  vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Wall clock must not be used') })
  for (const expiresAtMs of ['1', '18446744073709551615', 1n, 1, null, undefined]) {
    const tx = new Transaction()
    addIssueGrantCalls(tx, { ...roots, scopeMask: 1, expiresAtMs }, deployment)
    expect(bcs.option(U).parse(pure(tx, 0, 3))).toBe(expiresAtMs == null ? null : String(expiresAtMs))
  }
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', id(10))
  expect(buildBatchIssueGrantsTx({ items: [{ ...roots, scopeMask: 1, expiresAtMs: '1', setCapacityTo: 0 }] }).getData().commands).toHaveLength(2)
})
it.each([buildRevokeGrantTx, buildRevokeGrantScopeTx])('%s accepts guard-prefixed existing transaction and captured package', build => {
  const tx = new Transaction()
  addAssertGrantMutationSnapshotCalls(tx, { ...roots, snapshot: grantSnapshot }, deployment)
  expect(build({ ...roots, revokedScopeMask: 1 }, deployment, tx)).toBe(tx)
  expect(tx.getData().commands.map(c => c.MoveCall!.package)).toEqual([id(10), id(10)])
})
it.each([buildConfigurePaidAccessKindTx, buildUpdatePaidAccessKindTx, buildDeletePaidAccessKindTx, buildAddPaidAccessTx, buildRevokePaidAccessTx])('%s composes after guards without global payment configuration', build => {
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', id(99))
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE', '')
  const tx = new Transaction()
  addAssertPaidMutationSnapshotCalls(tx, { ...roots, snapshot: paidSnapshot }, deployment)
  expect(build(paidParams, deployment, tx)).toBe(tx)
  expect(tx.getData().commands).toHaveLength(2)
  expect(tx.getData().commands[1].MoveCall!.package).toBe(id(10))
})
it('configure serializes precise price/duration and manual grant serializes old expiry exactly', () => {
  const config = buildConfigurePaidAccessKindTx(paidParams, deployment)
  expect(U.parse(pure(config, 0, 5))).toBe('9007199254740993')
  expect(bcs.option(U).parse(pure(config, 0, 7))).toBe('18446744073709551615')
  expect(bcs.option(U).parse(pure(buildAddPaidAccessTx(paidParams, deployment), 0, 6))).toBe('1')
})
it('purchase composes merge/split after both guards using shifted SDK NestedResult and roundtrips bytes', async () => {
  const tx = resolvedTx()
  addAssertPaidMutationSnapshotCalls(tx, { ...roots, snapshot: paidSnapshot }, deployment)
  addAssertPaidMarketSnapshotCalls(tx, { marketConfigObjectId: id(11), marketConfigBcs }, deployment)
  expect(buildPurchasePaidAccessTx({ ...roots, paymentCoinObjectIds: [id(40), id(41)], totalAtomic: '9007199254740993' }, deployment, tx)).toBe(tx)
  expect(tx.getData().commands.map(c => c.$kind)).toEqual(['MoveCall', 'MoveCall', 'MergeCoins', 'SplitCoins', 'MoveCall'])
  expect(tx.getData().commands[4].MoveCall!.arguments[4]).toMatchObject({ NestedResult: [3, 0] })
  const raw = await tx.build({ onlyTransactionKind: true })
  expect(toBase64(await Transaction.fromKind(raw).build({ onlyTransactionKind: true }))).toBe(toBase64(raw))
})
it('direct paid mutations and cleanup need no market or payment env', () => {
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', id(10))
  for (const key of ['NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID', 'NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID', 'NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE']) vi.stubEnv(key, '')
  expect(buildAddPaidAccessTx(paidParams).getData().commands).toHaveLength(1)
  expect(buildRevokePaidAccessTx(paidParams).getData().commands).toHaveLength(1)
  expect(buildCleanupStalePaidAccessTx({ ...roots, addrs: [id(5)], kinds: [3] }).getData().commands).toHaveLength(1)
})
it('all paid late-argument validation errors reject before altering caller PTB', () => {
  const check = (build: (p: never, d: typeof deployment, tx: Transaction) => Transaction, params: unknown) => {
    const tx = new Transaction(), before = tx.getData()
    expect(() => build(params as never, deployment, tx)).toThrow(); expect(tx.getData()).toEqual(before)
  }
  for (const bad of badU64) {
    check(buildConfigurePaidAccessKindTx, { ...paidParams, priceAtomic: bad })
    check(buildUpdatePaidAccessKindTx, { ...paidParams, priceAtomic: bad })
    if (bad == null) continue
    check(buildConfigurePaidAccessKindTx, { ...paidParams, durationMs: bad })
    check(buildAddPaidAccessTx, { ...paidParams, expiresAtMs: bad })
    check(buildPurchasePaidAccessTx, { ...roots, paymentCoinObjectIds: [id(40), id(41)], totalAtomic: bad })
  }
  for (const bad of [-1, 0x100000000, 1.5, NaN]) {
    for (const build of [buildConfigurePaidAccessKindTx, buildUpdatePaidAccessKindTx, buildDeletePaidAccessKindTx, buildAddPaidAccessTx, buildRevokePaidAccessTx]) check(build, { ...paidParams, kind: bad })
    check(buildPurchasePaidAccessTx, { ...roots, paymentCoinObjectIds: [id(40), id(41)], totalAtomic: '1', kind: bad })
  }
  for (const params of [{ paymentCoinObjectIds: [id(40), 'bad'] }, { paymentCoinObjectIds: [id(40), id(40)] },
    { paymentCoinId: id(40), paymentCoinObjectIds: [id(41)] }, {}, { paymentCoinId: 'bad' }]) check(buildPurchasePaidAccessTx, { ...roots, ...params })
  check(buildCleanupStalePaidAccessTx, { ...roots, addrs: [id(5)], kinds: [] })
  check(buildCleanupStalePaidAccessTx, { ...roots, addrs: [id(5), 'bad'], kinds: [3, 4] })
  check(buildCleanupStalePaidAccessTx, { ...roots, addrs: [id(5)], kinds: [-1] })
})
