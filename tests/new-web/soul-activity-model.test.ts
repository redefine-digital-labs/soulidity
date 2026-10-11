import { expect, it } from 'vitest'
import { toBase58, toBase64 } from '@mysten/sui/utils'
import { SOUL_ACTIVITY_FAMILIES, SoulActivityEventBcs, composeSoulActivity, soulActivityEventType, soulActivityGrantsCsv,
  type SoulActivityFamily, type SoulActivityCoverage } from '../../web/lib/soulidity/soul-activity-model'
import type { ActivityTransactionEvidence } from '../../web/lib/soulidity/activity-transaction-evidence'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const digest = (n: number) => toBase58(new Uint8Array(32).fill(n))
const pkg = id(1), caller = id(2), owner = id(3), grantee = id(4), other = id(5), soul = id(6), grant = id(7)
const deployment = { originalPackageId: pkg, callablePackageId: caller, callableDigest: digest(99), chainIdentifier: '01010101' }
const complete = Object.fromEntries(SOUL_ACTIVITY_FAMILIES.map(f => [f, 'COMPLETE'])) as unknown as SoulActivityCoverage
type Input = { family: SoulActivityFamily; payload: any }
const created = (): Input => ({ family: 'SoulCreated', payload: { soul_id: soul, state_id: id(8), content_id: id(9), creator: owner, owner, provenance_kind: 3 } })
const issued = (grantId = grant, expires: string | null = null, issuer = owner, scope = '15'): Input => ({ family: 'SoulGrantIssued', payload: {
  grant_id: grantId, soul_id: soul, issued_by: issuer, grantee, scope_mask: scope, expires_at_ms: expires } })
const revoked = (grantId = grant): Input => ({ family: 'SoulGrantRevoked', payload: { grant_id: grantId, soul_id: soul, revoked_by: owner, grantee } })
const superseded = (old = grant, next = id(10)): Input => ({ family: 'SoulGrantSuperseded', payload: {
  old_grant_id: old, new_grant_id: next, soul_id: soul, grantee, superseded_by: owner } })
const rotated = (epoch = '1', previous = owner, next = other): Input => ({ family: 'SoulOwnershipRotated', payload: {
  soul_id: soul, previous_owner: previous, new_owner: next, ownership_epoch: epoch } })
const expired = (): Input => ({ family: 'SoulGrantExpired', payload: { grant_id: grant, soul_id: soul, grantee } })
const destroyed = (): Input => ({ family: 'SoulGrantDestroyed', payload: { grant_id: grant, soul_id: soul, grantee, destroyed_by: grantee } })
const bought = (price = '1', listing = id(20)): Input => ({ family: 'SoulPurchased', payload: {
  listing_id: listing, soul_id: soul, seller: other, buyer: owner, price, platform_fee: '1', creator_royalty: '1', collection_royalty: '1' } })
const native = (price = '10001'): Input => ({ family: 'AnimacraftV8SoulPurchased', payload: {
  listing_id: id(21), soul_id: soul, provenance_id: id(22), seller: other, buyer: owner, maker_source_recipient: id(23), price,
  seller_payout: price === '1' ? '1' : '9351', protocol_fee: price === '1' ? '0' : '250',
  soul_creator_royalty_bps: 100, soul_creator_royalty: price === '1' ? '0' : '100',
  maker_source_royalty_bps: 300, maker_source_royalty: price === '1' ? '0' : '300' } })

/** Pure reducer fixtures encode real payload BCS. Header/ledger verification is
 * deliberately tested separately by the actual evidence-reader suite. */
type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T
function tx(n: number, inputs: Input[], sender = owner, checkpoint = n, transactionIndex = 0): Mutable<ActivityTransactionEvidence> {
  return { deployment: { ...deployment },
    transactionDigest: digest(n), sender, checkpoint: String(checkpoint), checkpointTimestampMs: String(checkpoint * 10), epoch: '0', transactionIndex,
    transactionBytes: '', effectsBytes: '', trust: 'TRUSTED_LEDGER_CANONICAL_EVIDENCE', notAuthorization: true,
    eventAuthority: 'TYPE_ORIGIN_VERIFIED_HISTORY', executionPackageVersion: 'NOT_ATTESTED',
    events: inputs.map((value, eventSequence) => ({ eventSequence, packageId: caller, transactionModule: 'market', sender,
      type: soulActivityEventType(pkg, value.family), contentsBytes: toBase64(SoulActivityEventBcs[value.family].serialize(value.payload as never).toBytes()) })),
  }
}
function read(transactions: ActivityTransactionEvidence[], coverage = complete, viewerAddress = owner, time = '1000') {
  return composeSoulActivity({ viewerAddress, deployment, transactions, coverage, asOf: { checkpoint: '100', timestampMs: time,
    chainIdentifier: deployment.chainIdentifier, trust: 'TRUSTED_LEDGER_CANONICAL_EVIDENCE', notAuthorization: true } })
}
function buyHistory(inputs: Input[]) {
  const creations = inputs.map((value, index) => ({ family: 'SoulCreated' as const, payload: {
    ...created().payload, soul_id: value.payload.soul_id, state_id: id(100 + index), content_id: id(200 + index), owner: other } }))
  return [tx(1, creations, other), tx(2, inputs.flatMap(value => [
    { family: 'SoulOwnershipRotated' as const, payload: { ...rotated('1', other, owner).payload, soul_id: value.payload.soul_id } }, value,
  ]))]
}

it('replays epoch0 issuance and preserves exact public identities without private member IDs', () => {
  const result = read([tx(1, [created()]), tx(2, [issued()])])
  expect(result.grants[0]).toMatchObject({ onChainId: grant, status: 'active', ownershipEpochSnapshot: '0', scopes: ['seal', 'memory', 'skills', 'assets'],
    issuedByAddress: owner, granteeAddress: grantee, observedCheckpoint: '100', createdAtMs: '20' })
  expect(result).toMatchObject({ status: 'COMPLETE', completenessAuthority: 'BOUNDED_INDEX_COVERAGE', notAuthorization: true })
  expect(Object.isFrozen(result.grants[0].scopes)).toBe(true)
  expect(result.grants[0]).not.toHaveProperty('granteeMemberId')
})
it('keeps received grants but does not merge an unrelated viewer wallet', () => {
  const transactions = [tx(1, [created()]), tx(2, [issued()])]
  expect(read(transactions, complete, grantee).grants).toHaveLength(1)
  expect(read(transactions, complete, other).grants).toHaveLength(0)
})
it('preserves every same-PTB supersession and its direct replacement, not only the latest event', () => {
  const result = read([tx(1, [created()]), tx(2, [issued(), superseded(), issued(id(10), null, owner, '7'),
    superseded(id(10), id(11)), issued(id(11), null, owner, '7')])])
  expect(result.grants.map(g => [g.onChainId, g.status, g.replacedByGrantOnChainId])).toEqual([
    [id(11), 'active', null], [id(10), 'superseded', id(11)], [grant, 'superseded', id(10)]])
  expect(result.grants[1].scopeMask).toBe(result.grants[0].scopeMask)
})
it('records issued/revoked/destroyed in the same PTB without requiring a final Grant object', () => {
  const end = destroyed(); end.payload.destroyed_by = owner
  const result = read([tx(1, [created()]), tx(2, [issued(), revoked(), end])])
  expect(result.grants[0]).toMatchObject({ status: 'revoked', endedEventSequence: 1, destroyedAtMs: '20' })
})
it('uses the epoch at the issued event, not the transaction final epoch, through away-and-back ownership', () => {
  const result = read([tx(1, [created()]), tx(2, [issued(), rotated(), rotated('2', other, owner), issued(id(10))])])
  expect(result.grants.map(g => [g.onChainId, g.status, g.ownershipEpochSnapshot])).toEqual([
    [id(10), 'active', '2'], [grant, 'invalidated', '0']])
})
it('does not replace invalidation with a later expired cleanup event', () => {
  const result = read([tx(1, [created()]), tx(2, [issued(grant, '25')]), tx(3, [rotated()]), tx(8, [expired()])])
  expect(result.grants[0]).toMatchObject({ status: 'invalidated', endedAtMs: '30', cleanupAtMs: '80' })
})
it('does not replace an explicit earlier expiry with a later rotation', () => {
  const result = read([tx(1, [created()]), tx(2, [issued(grant, '25')]), tx(3, [expired()]), tx(8, [rotated()])])
  expect(result.grants[0]).toMatchObject({ status: 'expired', endedAtMs: '25', cleanupAtMs: '30' })
})
it('keeps explicit revoke even when its checkpoint timestamp is after expiry: it is not the execution Clock', () => {
  const result = read([tx(1, [created()]), tx(2, [issued(grant, '25')]), tx(3, [revoked()])])
  expect(result.grants[0]).toMatchObject({ status: 'revoked', endedAtMs: '30' })
})
it('derives expiry only at verified observation time and never from Date.now', () => {
  const transactions = [tx(1, [created()]), tx(2, [issued(grant, '1000')])]
  expect(read(transactions, complete, owner, '999').grants[0].status).toBe('active')
  expect(read(transactions, complete, owner, '1000').grants[0]).toMatchObject({ status: 'expired', endedAtMs: '1000', endedTransactionDigest: null })
})
it('expired cleanup permits new issuance without inventing supersession', () => {
  const result = read([tx(1, [created()]), tx(2, [issued(grant, '25')]), tx(3, [expired(), issued(id(10))])])
  expect(result.grants.map(g => g.status)).toEqual(['active', 'expired'])
  expect(result.grants[1].replacedByGrantOnChainId).toBeNull()
})
it('orders same checkpoint transactions by index and each PTB by event sequence', () => {
  const result = read([tx(3, [revoked()], owner, 2, 2), tx(2, [issued()], owner, 2, 1), tx(1, [created()], owner, 2, 0)])
  expect(result.grants[0].status).toBe('revoked')
})
it.each(['UNSCANNED', 'PARTIAL', 'LIMIT_REACHED'] as const)('does not infer active or natural-expired from %s lifecycle coverage', status => {
  const coverage = { ...complete, SoulGrantRevoked: status }
  const result = read([tx(1, [created()]), tx(2, [issued(grant, '25')])], coverage)
  expect(result.grants[0]).toMatchObject({ status: null, statusEvidence: 'UNAVAILABLE' })
  expect(result.status).toBe(status === 'LIMIT_REACHED' ? 'LIMIT_REACHED' : 'PARTIAL')
})
it('allows a verified explicit revoke while missing unrelated lifecycle pages but does not invent its epoch', () => {
  const coverage = { ...complete, SoulCreated: 'PARTIAL' as const }
  const result = read([tx(2, [issued(), revoked()])], coverage)
  expect(result.grants[0]).toMatchObject({ status: 'revoked', statusEvidence: 'EXPLICIT_TERMINAL_EVENT', ownershipEpochSnapshot: null })
})
it('counts every same-PTB ordinary purchase and retains additive small-price ceil fees', () => {
  const second = bought('1', id(21)); second.payload.soul_id = id(30)
  const result = read(buyHistory([bought(), second]))
  expect(result.purchases).toHaveLength(2); expect(new Set(result.purchases.map(p => p.id)).size).toBe(2)
  expect(result.purchases[0]).toMatchObject({ model: 'BASE_PLUS_FEES', paidAtomic: '1', totalAtomic: '4', sellerPayoutAtomic: null, soulName: null })
  expect(read(buyHistory([bought()]), complete, other).purchases).toHaveLength(0)
})
it.each(['1', '10001'])('keeps native gross price %s, verifies each floor deduction and never adds it again', price => {
  const result = read(buyHistory([native(price)]))
  expect(result.purchases[0]).toMatchObject({ model: 'GROSS_INCLUSIVE', paidAtomic: price, totalAtomic: price,
    makerSourceRecipient: id(23), provenanceId: id(22) })
})
it('retains u64 amounts and out-of-calendar expiry exactly in view and CSV', () => {
  const max = '18446744073709551615', purchase = bought('9007199254740993')
  purchase.payload.soul_id = id(30)
  const result = read([tx(1, [created()]), tx(2, [issued(grant, max)]),
    ...buyHistory([purchase]).map((value, index) => ({ ...value, transactionDigest: digest(index + 3), checkpoint: String(index + 3), checkpointTimestampMs: String((index + 3) * 10) }))])
  expect(result.grants[0]).toMatchObject({ expiresAtMs: max, expiresAt: null })
  expect(result.purchases[0].totalAtomic).toBe('9007199254740996')
  expect(soulActivityGrantsCsv(result.grants)).toContain(`"${max}"`)
  expect(soulActivityGrantsCsv(result.grants)).not.toContain('MemberId')
})
it.each(['missing-created', 'epoch-gap', 'wrong-issuer', 'missing-replacement', 'duplicate-issued', 'double-termination',
  'missing-issued', 'destroyed-active', 'expiry-without-expiry', 'wrong-grantee', 'wrong-revoker', 'wrong-destroyer',
  'wrong-buyer', 'wrong-native-quote', 'zero-scope', 'unknown-scope', 'ordinary-overflow', 'trailing-bcs', 'bad-position',
  'duplicate-tx', 'duplicate-index', 'wrong-package', 'future-checkpoint', 'wrong-chain', 'wrong-callable', 'wrong-digest',
  'missing-event-authority', 'expired-after-revoke', 'duplicate-expired', 'expired-after-destroy', 'fee-over-price',
  'missing-purchase-rotation', 'fee-ceil-combination', 'revoked-after-destroy', 'superseded-after-destroy', 'same-checkpoint-time'] as const)('rejects contradictory evidence: %s', problem => {
  let transactions = [tx(1, [created()]), tx(2, [issued()])]
  if (problem === 'missing-created') transactions.shift()
  if (problem === 'epoch-gap') transactions.push(tx(3, [rotated('2')]))
  if (problem === 'wrong-issuer') transactions[1] = tx(2, [issued(grant, null, other)], other)
  if (problem === 'missing-replacement') transactions.push(tx(3, [superseded()]))
  if (problem === 'duplicate-issued') transactions.push(tx(3, [issued()]))
  if (problem === 'double-termination') transactions.push(tx(3, [revoked(), revoked()]))
  if (problem === 'missing-issued') transactions = [transactions[0], tx(3, [revoked()])]
  if (problem === 'destroyed-active') transactions.push(tx(3, [destroyed()], grantee))
  if (problem === 'expiry-without-expiry') transactions.push(tx(3, [expired()]))
  if (problem === 'wrong-grantee') { const value = revoked(); value.payload.grantee = other; transactions.push(tx(3, [value])) }
  if (problem === 'wrong-revoker') { const value = revoked(); value.payload.revoked_by = other; transactions.push(tx(3, [value])) }
  if (problem === 'wrong-destroyer') transactions.push(tx(3, [destroyed()]))
  if (problem === 'wrong-buyer') { const value = bought(); value.payload.buyer = other; transactions = buyHistory([value]) }
  if (problem === 'wrong-native-quote') { const value = native(); value.payload.protocol_fee = '251'; transactions = buyHistory([value]) }
  if (problem === 'zero-scope') transactions[1] = tx(2, [issued(grant, null, owner, '0')])
  if (problem === 'unknown-scope') transactions[1] = tx(2, [issued(grant, null, owner, '16')])
  if (problem === 'ordinary-overflow') transactions = buyHistory([bought('18446744073709551615')])
  if (problem === 'trailing-bcs') transactions[1].events[0].contentsBytes += 'AA=='
  if (problem === 'bad-position') transactions[1].events[0].eventSequence = 3
  if (problem === 'duplicate-tx') transactions.push(structuredClone(transactions[1]))
  if (problem === 'duplicate-index') { transactions[1].checkpoint = '1'; transactions[1].checkpointTimestampMs = '10' }
  if (problem === 'wrong-package') transactions[1].deployment.originalPackageId = id(999)
  if (problem === 'future-checkpoint') transactions[1].checkpoint = '101'
  if (problem === 'wrong-chain') transactions[1].deployment.chainIdentifier = '02020202'
  if (problem === 'wrong-callable') transactions[1].deployment.callablePackageId = id(999)
  if (problem === 'wrong-digest') transactions[1].deployment.callableDigest = digest(98)
  if (problem === 'missing-event-authority') delete (transactions[1] as any).eventAuthority
  if (problem === 'expired-after-revoke') transactions = [tx(1, [created()]), tx(2, [issued(grant, '25'), revoked()]), tx(3, [expired()])]
  if (problem === 'duplicate-expired') transactions = [tx(1, [created()]), tx(2, [issued(grant, '25')]), tx(3, [expired(), expired()])]
  if (problem === 'expired-after-destroy') transactions = [tx(1, [created()]), tx(2, [issued(grant, '25')]), tx(3, [destroyed()], grantee), tx(4, [expired()])]
  if (problem === 'fee-over-price') { const value = bought(); value.payload.platform_fee = '100'; transactions = buyHistory([value]) }
  if (problem === 'missing-purchase-rotation') transactions = [tx(1, [created()]), tx(2, [bought()])]
  if (problem === 'fee-ceil-combination') { const value = bought('10'); value.payload.platform_fee = '10'; value.payload.creator_royalty = '10'; transactions = buyHistory([value]) }
  if (problem === 'revoked-after-destroy') transactions = [tx(1, [created()]), tx(2, [issued(grant, '25')]), tx(3, [destroyed()], grantee), tx(4, [revoked()])]
  if (problem === 'superseded-after-destroy') transactions = [tx(1, [created()]), tx(2, [issued(grant, '25')]), tx(3, [destroyed()], grantee), tx(4, [superseded(), issued(id(10))])]
  if (problem === 'same-checkpoint-time') transactions[1].checkpoint = '100'
  expect(() => read(transactions)).toThrow()
})
