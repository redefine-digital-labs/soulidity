import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64 } from '@mysten/sui/utils'
import { addAppendContentVersionAsOwnerCalls, addAppendContentVersionAsGrantedAgentCalls,
  buildDeleteContentVersionAsOwnerTx, buildDeleteContentVersionAsGrantedAgentTx, buildPurgeContentVersionAsOwnerTx } from '../../packages/soulidity-sdk/src/tx/content'
import { addIssueGrantCalls, addSetGrantCapacityCalls, buildBatchIssueGrantsTx, buildBatchRevokeGrantsTx,
  buildRevokeGrantTx, buildRevokeGrantScopeTx, buildDestroyInvalidatedGrantTx, buildCleanupInactiveGrantsTx } from '../../packages/soulidity-sdk/src/tx/grant'
import { buildAddPaidAccessTx, buildRevokePaidAccessTx, buildCleanupStalePaidAccessTx,
  buildConfigurePaidAccessKindTx } from '../../packages/soulidity-sdk/src/tx/paid-access'
import { buildUpdatePrivateNamedLoadoutTx, buildSavePrivateNamedLoadoutTx,
  buildPrivateNamedLoadoutSealApproval, derivePrivateNamedLoadoutSealId } from '../../packages/soulidity-sdk/src/private-named-loadout'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const deployment = { packageId: id(10), marketConfigId: id(11), protocolGateId: id(12) }
const content = { contentObjectId: id(1), stateObjectId: id(2), kindRegistryObjectId: id(3), soulGrantObjectId: id(4),
  kind: 3, name: 'sprite', slotReadModeMask: 3, downloadPolicy: 'owner_only' as const, contentBlobObjectId: id(5),
  expectedVersionIndex: '9007199254740993', encryptedEnvelope: new Uint8Array([1, 2, 3]), versionIndex: '9007199254740993',
  expectedOwnershipEpoch: '0', expectedActive: null }
const grant = { stateObjectId: id(2), grantObjectId: id(4), granteeAddress: id(5), scopeMask: 3, capacity: 4, revokedScopeMask: 1 }
const paid = { ...grant, paidAccessListObjectId: id(1), kindRegistryObjectId: id(3), kind: 3, expiresAtMs: '9007199254740993' }
const named = { deployment: { originalPackageId: id(10), callablePackageId: id(10), chainIdentifier: '01010101', protocolGateId: id(12) },
  scope: { soulId: id(1), stateId: id(2), owner: id(3), ownershipEpoch: '9007199254740993' }, expectedRevision: '1',
  requestId: '01'.repeat(32), ciphertext: { blobObjectId: id(5), blobId: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc', sha256: '02'.repeat(32), byteLength: '4' },
  protocolId: id(7), capture: { equipmentId: id(8), revision: '1', commitment: '03'.repeat(32) } }
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', id(10))
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID', id(11))
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID', id(3))
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_PROTOCOL_GATE_ID', id(12))
})
afterEach(() => vi.unstubAllEnvs())
function object(tx: Transaction, command: number, argument: number) {
  const data = tx.getData(), ref = data.commands[command].MoveCall!.arguments[argument]
  if (ref.$kind !== 'Input') throw new Error('Expected object input')
  return data.inputs[ref.Input].UnresolvedObject?.objectId
}
function check(tx: Transaction, name: string, objects: string[], count: number, command = 0) {
  const call = tx.getData().commands[command].MoveCall!
  expect(call.function).toBe(name)
  expect(call.arguments).toHaveLength(count)
  expect(objects.map((_, i) => object(tx, command, i))).toEqual(objects)
}
it.each([
  ['owner', addAppendContentVersionAsOwnerCalls, 'append_version_as_owner', [id(12), id(1), id(2), id(3)], 12],
  ['agent', addAppendContentVersionAsGrantedAgentCalls, 'append_version_as_granted_agent', [id(12), id(1), id(2), id(3), id(4)], 13],
] as const)('append %s passes gate first and preserves the remaining ABI', (_label, add, name, objects, count) => {
  const tx = new Transaction(); add(tx, content, deployment); check(tx, name, [...objects], count)
})
it.each([
  [buildDeleteContentVersionAsOwnerTx, 'delete_version_as_owner', [id(12), id(1), id(2), id(3)], 7],
  [buildDeleteContentVersionAsGrantedAgentTx, 'delete_version_as_granted_agent', [id(12), id(1), id(2), id(3), id(4)], 9],
  [buildPurgeContentVersionAsOwnerTx, 'purge_deleted_version_as_owner', [id(12), id(1), id(2), id(3)], 7],
] as const)('%s preserves read-only guards and prefixes only the mutation with gate', (build, name, objects, count) => {
  const tx = build(content, deployment)
  expect(tx.getData().commands.slice(0, 2).map(c => c.MoveCall!.function)).toEqual(['assert_mutation_scope', 'assert_active_binding'])
  check(tx, name, [...objects], count, 2)
})
it.each([
  [addIssueGrantCalls, 'issue_to_grantee', 6],
  [addSetGrantCapacityCalls, 'set_grant_capacity', 4],
] as const)('%s passes gate before state in composable builders', (add, name, count) => {
  const tx = new Transaction(); add(tx, grant, deployment); check(tx, name, [id(12), id(2)], count)
})
it('batch issue prefixes gate on both capacity and every issue', () => {
  const tx = buildBatchIssueGrantsTx({ items: [{ ...grant, setCapacityTo: 4 }, grant] })
  check(tx, 'set_grant_capacity', [id(12), id(2)], 4, 0)
  check(tx, 'issue_to_grantee', [id(12), id(2)], 6, 1)
  check(tx, 'issue_to_grantee', [id(12), id(2)], 6, 2)
})
it('batch revoke prefixes gate on each state', () => {
  const tx = buildBatchRevokeGrantsTx({ items: [grant, { ...grant, stateObjectId: id(3) }] })
  check(tx, 'revoke', [id(12), id(2)], 4, 0); check(tx, 'revoke', [id(12), id(3)], 4, 1)
})
it.each([
  [buildRevokeGrantTx, 'revoke', 4], [buildRevokeGrantScopeTx, 'revoke_scope_to_grantee', 5],
] as const)('%s prefixes gate on direct revoke', (build, name, count) => check(build(grant, deployment), name, [id(12), id(2)], count))
it('destroy preserves grant before state after gate', () => check(buildDestroyInvalidatedGrantTx(grant), 'destroy_invalidated_grant', [id(12), id(4), id(2)], 4))
it('cleanup prefixes gate before state and grantee list', () => check(buildCleanupInactiveGrantsTx({ ...grant, granteeAddresses: [id(5)] }), 'cleanup_inactive_grants', [id(12), id(2)], 4))
it.each([
  [buildAddPaidAccessTx, 'add_access', [id(12), id(1), id(2), id(3)], 9],
  [buildRevokePaidAccessTx, 'revoke_access', [id(12), id(1), id(2)], 5],
] as const)('%s prefixes gate in direct paid-access mutation', (build, name, objects, count) => check(build(paid, deployment), name, [...objects], count))
it('paid cleanup prefixes gate before list and state', () => check(buildCleanupStalePaidAccessTx({ ...paid, addrs: [id(5)], kinds: [3] }, deployment), 'cleanup_stale_entries', [id(12), id(1), id(2)], 5))
it('paid configuration keeps the public market V2 wrapper ABI', () => {
  const tx = buildConfigurePaidAccessKindTx({ ...paid, priceAtomic: '1', durationMs: null }, deployment)
  check(tx, 'configure_paid_access_kind_v2', [id(11), id(3), id(1), id(2)], 8)
})
it('named-loadout update prefixes gate before state', () => check(buildUpdatePrivateNamedLoadoutTx(named), 'update', [id(12), id(2)], 9))
it('named-loadout save prefixes gate before state/equipment/protocol', () => check(buildSavePrivateNamedLoadoutTx(named), 'save', [id(12), id(2), id(8), id(7)], 13))
it('named-loadout Seal keeps document first, gate second, state third', async () => {
  const tx = await buildPrivateNamedLoadoutSealApproval(named), data = tx.getData(), call = data.commands[0].MoveCall!
  expect(call.arguments).toHaveLength(4)
  const document = call.arguments[0]; if (document.$kind !== 'Input') throw new Error('Expected document input')
  expect(bcs.vector(bcs.u8()).parse(fromBase64(data.inputs[document.Input].Pure!.bytes))).toEqual(Array.from(await derivePrivateNamedLoadoutSealId(named.scope)))
  expect(object(tx, 0, 1)).toBe(id(12)); expect(object(tx, 0, 2)).toBe(id(2))
})
it.each(['content', 'grant', 'paid'] as const)('%s fails clearly without a gate before changing a caller PTB', kind => {
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_PROTOCOL_GATE_ID', '')
  const tx = new Transaction(), before = tx.getData(), missing = { ...deployment, protocolGateId: '' }
  const run = () => kind === 'content' ? addAppendContentVersionAsOwnerCalls(tx, content, missing)
    : kind === 'grant' ? addIssueGrantCalls(tx, grant, missing) : buildAddPaidAccessTx(paid, missing, tx)
  expect(run).toThrow(/PROTOCOL_GATE_ID|protocolGateId/)
  expect(tx.getData()).toEqual(before)
})
it('named-loadout rejects missing protocolGateId with a clear gate error', () => {
  expect(() => buildUpdatePrivateNamedLoadoutTx({ ...named, deployment: { ...named.deployment, protocolGateId: '' } })).toThrow(/PROTOCOL_GATE|protocolGateId/)
})
