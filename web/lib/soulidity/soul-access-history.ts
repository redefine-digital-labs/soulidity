import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase64, normalizeStructTag, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { profileReadStep, SoulStatePublicBcs, SoulDetailStateBcs as D, SoulPublicMarketConfigBcs } from '@soulidity/sdk'
import { historicalObjectOutput } from '../sui/historical-object'
import { SoulAccessCoinBcs, SOUL_ACCESS_CLOCK, soulAccessBcs, soulAccessDecode as decode,
  soulAccessCheck as check, soulAccessSame as same, soulAccessUint as uint, soulAccessDigest as digest,
  soulAccessIsGrant, soulAccessUsesMarket, soulAccessPurchaseExpiry,
  type SoulAccessRecord, type SoulAccessCodec } from './soul-access-plan'

type Effects = ReturnType<typeof bcs.TransactionEffects.parse>
type Owner = ReturnType<typeof bcs.Owner.parse>
const A = bcs.Address, N = bcs.u32()
const fieldCodec = (key: any, value: any) => bcs.struct('Field', { id: A, name: key, value })
const ownerIs = (owner: Owner, kind: 'AddressOwner' | 'ObjectOwner', address: string) => owner[kind] === address

/** Finalization is a closed, typed state transition over the signed packet's
 * actual historical inputs. It never asks a current wallet, descriptor, owner,
 * epoch or dynamic-field index to explain what an old transaction did. */
export async function proveSoulAccessHistory(params: {
  record: SoulAccessRecord; effects: Effects; client: SuiGrpcClient; signal: AbortSignal
}): Promise<{ stateVersion?: string; paidAccessVersion?: string; grantId?: string; expiresAtMs?: string | null }> {
  const { client, signal } = params, record = structuredClone(params.record), effects = structuredClone(params.effects)
  const p = record.plan, e = effects.V2
  check(e && e.status.$kind === 'Success' && e.transactionDigest === record.packet.digest, 'HISTORY_EFFECTS')
  uint(e.lamportVersion, true)
  check(new Set(e.changedObjects.map(([id]) => id)).size === e.changedObjects.length
    && new Set(e.unchangedConsensusObjects.map(([id]) => id)).size === e.unchangedConsensusObjects.length, 'HISTORY_DUPLICATE')
  const tx = Transaction.from(fromBase64(record.packet.bytes)).getData(), pkg = p.deployment.originalPackageId
  const allowed = new Set<string>(), reads = new Set<string>()
  const change = (objectId: string) => {
    const rows = e.changedObjects.filter(([id]) => id === objectId)
    check(rows.length === 1 && !e.unchangedConsensusObjects.some(([id]) => id === objectId), 'HISTORY_CHANGE_MISSING')
    allowed.add(objectId); return rows[0][1]
  }
  function shared(owner: Owner, objectId: string) {
    const ref = tx.inputs.find(row => row.Object?.SharedObject?.objectId === objectId)?.Object?.SharedObject
    check(ref && owner.Shared?.initialSharedVersion === ref.initialSharedVersion, 'HISTORY_SHARED_OWNER')
  }
  /** Full canonical Object bytes establish the typed digest for inputs as well
   * as outputs. Coins use Sui's compact Coin/GasCoin enum, not just Other. */
  async function object(objectId: string, type: string, mode: 'input' | 'readonly' | 'created' | 'mutated') {
    let version: bigint, expectedDigest: string, expectedOwner: Owner | null
    if (mode === 'input') {
      const input = change(objectId).inputState.Exist
      check(input, 'HISTORY_INPUT_MISSING'); version = BigInt(input[0][0]); expectedDigest = input[0][1]; expectedOwner = input[1]
    } else if (mode === 'readonly') {
      check(!e!.changedObjects.some(([id]) => id === objectId), 'HISTORY_READONLY_CHANGED')
      const rows = e!.unchangedConsensusObjects.filter(([id]) => id === objectId), root = rows[0]?.[1].ReadOnlyRoot
      check(rows.length === 1 && root, 'HISTORY_READONLY_MISSING')
      reads.add(objectId); version = BigInt(root[0]); expectedDigest = root[1]; expectedOwner = null
    } else {
      change(objectId); const ref = historicalObjectOutput(effects, objectId, mode)
      version = ref.version; expectedDigest = ref.digest; expectedOwner = ref.owner
    }
    uint(String(version), true); digest(expectedDigest)
    check(mode === 'created' || mode === 'mutated' ? version === BigInt(e!.lamportVersion)
      : version < BigInt(e!.lamportVersion), 'HISTORY_VERSION')
    const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId, version,
      readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents', 'previous_transaction', 'bcs'] },
    }, { abort: signal }))
    const row = structuredClone(response.object)
    check(row?.objectId === objectId && row.version === version && row.digest === expectedDigest
      && row.objectType === normalizeStructTag(type) && row.bcs?.value instanceof Uint8Array
      && row.bcs.value.length > 0 && row.bcs.value.length <= 66560 && row.contents?.value instanceof Uint8Array
      && row.contents.value.length > 0 && row.contents.value.length <= 65536, 'HISTORY_REFERENCE')
    const bytes = row.bcs.value, full = decode(bcs.Object, bytes), move = full.data.Move
    const domain = new TextEncoder().encode('Object::'), preimage = new Uint8Array(domain.length + bytes.length)
    preimage.set(domain); preimage.set(bytes, domain.length)
    check(toBase58(blake2b(preimage, { dkLen: 32 })) === expectedDigest, 'HISTORY_OBJECT_DIGEST')
    check(move, 'HISTORY_MOVE_REQUIRED')
    const actualType = move.type.Other ? TypeTagSerializer.tagToString({ struct: move.type.Other })
      : move.type.Coin ? `0x2::coin::Coin<${move.type.Coin}>`
        : move.type.$kind === 'GasCoin' ? '0x2::coin::Coin<0x2::sui::SUI>' : null
    check(actualType && normalizeStructTag(actualType) === normalizeStructTag(type) && move.version === String(version)
      && `0x${toHex(move.contents.subarray(0, 32))}` === objectId && toBase64(move.contents) === toBase64(row.contents.value)
      && full.previousTransaction === row.previousTransaction && (!expectedOwner || same(full.owner, expectedOwner))
      && (!['created', 'mutated'].includes(mode) || full.previousTransaction === record.packet.digest), 'HISTORY_OBJECT')
    const owner = full.owner, raw = row.owner
    check(owner.AddressOwner !== undefined ? raw?.kind === 1 && raw.address === owner.AddressOwner
      : owner.ObjectOwner !== undefined ? raw?.kind === 2 && raw.address === owner.ObjectOwner
        : owner.Shared !== undefined ? raw?.kind === 3 && raw.version === BigInt(owner.Shared.initialSharedVersion)
          : owner.$kind === 'Immutable' && raw?.kind === 4, 'HISTORY_OWNER')
    if (mode === 'readonly') shared(owner, objectId)
    return { bytes: move.contents, owner, version: String(version) }
  }
  async function root<C extends SoulAccessCodec>(objectId: string, type: string, codec: C, mode: 'input' | 'readonly' | 'mutated') {
    const row = await object(objectId, type, mode); shared(row.owner, objectId)
    return { ...row, value: decode(codec, row.bytes) }
  }
  function field(parent: string, keyType: string, keyCodec: any, key: any, valueType: string, codec: any) {
    const objectId = deriveDynamicFieldID(parent, keyType, keyCodec.serialize(key).toBytes())
    const type = `0x2::dynamic_field::Field<${keyType},${valueType}>`, fullCodec = fieldCodec(keyCodec, codec)
    return { objectId, async read(mode: 'input' | 'created' | 'mutated'): Promise<any> {
      const row = await object(objectId, type, mode), value = decode(fullCodec, row.bytes)
      check(ownerIs(row.owner, 'ObjectOwner', parent) && value.id === objectId && same(value.name, key), 'HISTORY_FIELD')
      return value.value
    }, async before(expected: string | null) {
      const c = change(objectId)
      if (expected === null) check(c.inputState.$kind === 'NotExist' && c.idOperation.$kind === 'Created', 'HISTORY_EXPECTED_ABSENT')
      else check(toBase64(codec.serialize(await this.read('input')).toBytes()) === expected, 'HISTORY_BEFORE')
    }, async deleted(expected: string) {
      await this.before(expected); const c = change(objectId)
      check(c.outputState.$kind === 'NotExist' && c.idOperation.$kind === 'Deleted', 'HISTORY_NOT_DELETED')
    }, async transition(before: string | null, after: any) {
      const expected = toBase64(codec.serialize(after).toBytes())
      // Sui minimizes unchanged child writes. The signed snapshot assertion
      // establishes the exact input; no effect plus equal before/after bytes
      // is a preservation proof, not a fabricated historical version/read row.
      if (!e!.changedObjects.some(([id]) => id === objectId)) {
        check(before !== null && before === expected && !e!.unchangedConsensusObjects.some(([id]) => id === objectId),
          'HISTORY_UNCHANGED_CHILD_MISMATCH')
        return structuredClone(after)
      }
      await this.before(before)
      const observed = await this.read(before === null ? 'created' : 'mutated')
      check(toBase64(codec.serialize(observed).toBytes()) === expected, 'HISTORY_CHILD_TRANSITION')
      return observed
    } }
  }
  const encode = (codec: any, value: any): string => toBase64(codec.serialize(value).toBytes())
  const oldState = soulAccessBcs(SoulStatePublicBcs, p.expected.stateBcs)
  const grant = soulAccessIsGrant(p.action)
  const state = await root(p.stateId, `${pkg}::soul::SoulState`, SoulStatePublicBcs, grant ? 'input' : 'readonly')
  check(state.value.id === p.stateId && state.value.version === '1' && state.value.soul_id === p.soulId
    && state.value.current_owner === p.currentOwner && state.value.ownership_epoch === p.ownershipEpoch
    && state.value.content_id === p.contentId && state.value.access_list_id === p.paidAccessListId
    && state.value.active_grants.id === oldState.active_grants.id && state.value.active_grant_ids.id === oldState.active_grant_ids.id,
  'HISTORY_AUTHORITY')
  let now: string | null = null
  if (grant || p.action === 'paid-purchase') {
    const clock = await root(SOUL_ACCESS_CLOCK, '0x2::clock::Clock', D.Clock, 'readonly')
    check(clock.value.id === SOUL_ACCESS_CLOCK && BigInt(clock.value.timestamp_ms) >= BigInt(p.capturedAtMs), 'HISTORY_CLOCK')
    now = clock.value.timestamp_ms
  }
  if (soulAccessUsesMarket(p.action)) {
    const market = await root(p.deployment.marketConfigId, `${pkg}::market::MarketConfigV2`, SoulPublicMarketConfigBcs, 'readonly')
    check(toBase64(market.bytes) === p.expected.marketConfigBcs, 'HISTORY_MARKET_CHANGED')
  }
  if (p.action === 'paid-configure' || p.action === 'paid-update') {
    const registry = await root(p.deployment.kindRegistryId, `${pkg}::kind_registry::KindRegistry`, D.Registry, 'readonly')
    check(registry.value.id === p.deployment.kindRegistryId && registry.value.version === '1', 'HISTORY_REGISTRY')
  }
  const result: { stateVersion?: string; paidAccessVersion?: string; grantId?: string; expiresAtMs?: string | null } = {}
  if (grant) {
    check(state.value.grant_capacity === oldState.grant_capacity && state.value.active_grant_count === oldState.active_grant_count,
      'HISTORY_GRANT_COUNTERS')
    const expectedState = structuredClone(state.value)
    const prior = p.expected.grantSlotBcs === null ? null : soulAccessBcs(D.GrantSlot, p.expected.grantSlotBcs)
    const live = Boolean(prior?.ownership_epoch_snapshot === p.ownershipEpoch && (prior.expires_at_ms === null || BigInt(prior.expires_at_ms) > BigInt(now!)))
    check(live === p.expected.grantLive, 'HISTORY_GRANT_LIVENESS')
    const slot = field(state.value.active_grants.id, 'address', A, p.granteeAddress, `${pkg}::soul::ActiveGrantSlot`, D.GrantSlot)
    if (prior) {
      check(!e.changedObjects.some(([id]) => id === prior.grant_id), 'HISTORY_OLD_GRANT_CHANGED')
      const reverse = field(state.value.active_grant_ids.id, '0x2::object::ID', A, prior.grant_id, 'address', A)
      await reverse.deleted(encode(A, p.granteeAddress))
    }
    const replacing = p.action !== 'grant-revoke'
    expectedState.active_grants.size = String(BigInt(state.value.active_grants.size) + (replacing ? prior ? 0n : 1n : -1n))
    expectedState.active_grant_ids.size = String(BigInt(state.value.active_grant_ids.size) + (replacing ? prior ? 0n : 1n : -1n))
    expectedState.active_grant_count = String(BigInt(state.value.active_grant_count)
      - (prior?.ownership_epoch_snapshot === p.ownershipEpoch ? 1n : 0n) + (replacing ? 1n : 0n))
    if (!replacing) await slot.deleted(p.expected.grantSlotBcs!)
    else {
      await slot.before(p.expected.grantSlotBcs)
      const next = await slot.read(prior ? 'mutated' : 'created')
      const expires = p.action === 'grant-issue' ? p.input.expiresAtMs : prior!.expires_at_ms
      check(expires === null || BigInt(expires) > BigInt(now!), 'HISTORY_GRANT_EXPIRY')
      check(same(next, { version: '1', grant_id: next.grant_id, grantee: p.granteeAddress, scope_mask: String(p.quote.scopeMask),
        expires_at_ms: expires, ownership_epoch_snapshot: p.ownershipEpoch }), 'HISTORY_GRANT_SLOT')
      const created = await object(next.grant_id, `${pkg}::grant::SoulGrant`, 'created'), newGrant = decode(D.Grant, created.bytes)
      check(ownerIs(created.owner, 'AddressOwner', p.granteeAddress!) && same(newGrant, { id: next.grant_id, version: '1',
        soul_id: p.soulId, grantee: p.granteeAddress, issued_by: p.author, ownership_epoch_snapshot: p.ownershipEpoch,
        scope_mask: String(p.quote.scopeMask), expires_at_ms: expires }), 'HISTORY_GRANT_OUTPUT')
      const reverse = field(state.value.active_grant_ids.id, '0x2::object::ID', A, next.grant_id, 'address', A)
      check(await reverse.read('created') === p.granteeAddress, 'HISTORY_GRANT_REVERSE')
      result.grantId = next.grant_id; result.expiresAtMs = expires
    }
    if (p.action === 'grant-issue') expectedState.grant_capacity = p.quote.capacity!
    const output = await root(p.stateId, `${pkg}::soul::SoulState`, SoulStatePublicBcs, 'mutated')
    check(same(output.value, expectedState), 'HISTORY_STATE_TRANSITION'); result.stateVersion = output.version
  } else {
    const paid = await root(p.paidAccessListId, `${pkg}::paid_access::SoulPaidAccessList`, D.Paid, 'input')
    const plannedPaid = soulAccessBcs(D.Paid, p.expected.paidBcs)
    check(paid.value.id === p.paidAccessListId && paid.value.version === '1' && paid.value.soul_id === p.soulId
      && paid.value.creator === state.value.creator && paid.value.kind_configs.id === plannedPaid.kind_configs.id
      && paid.value.entries.id === plannedPaid.entries.id, 'HISTORY_PAID_ROOT')
    const expectedPaid = structuredClone(paid.value)
    if (['paid-configure', 'paid-update', 'paid-delete'].includes(p.action)) {
      const config = field(paid.value.kind_configs.id, 'u32', N, p.kind, `${pkg}::paid_access::KindPaidConfig`, D.PaidConfig)
      if (p.action === 'paid-delete') { await config.deleted(p.expected.paidConfigBcs!); expectedPaid.kind_configs.size = String(BigInt(paid.value.kind_configs.size) - 1n) }
      else {
        await config.transition(p.expected.paidConfigBcs, { version: '1', price_atomic: p.input.priceAtomic, scope_mask: String(p.quote.scopeMask),
          duration_ms: p.input.durationMs, ownership_epoch_snapshot: p.ownershipEpoch })
        if (p.action === 'paid-configure') expectedPaid.kind_configs.size = String(BigInt(paid.value.kind_configs.size) + 1n)
      }
    } else {
      const oldTable = p.expected.buyerTableBcs === null ? null : soulAccessBcs(D.Table, p.expected.buyerTableBcs)
      const buyer = field(paid.value.entries.id, 'address', A, p.granteeAddress,
        `0x2::table::Table<u32,${pkg}::paid_access::KindPaidEntry>`, D.Table)
      if (p.action === 'paid-revoke') {
        check(oldTable, 'HISTORY_BUYER_REQUIRED')
        const entry = field(oldTable.id, 'u32', N, p.kind, `${pkg}::paid_access::KindPaidEntry`, D.PaidEntry)
        await entry.deleted(p.expected.paidEntryBcs!)
        if (oldTable.size === '1') {
          await buyer.deleted(p.expected.buyerTableBcs!); expectedPaid.entries.size = String(BigInt(paid.value.entries.size) - 1n)
          // destroy_empty deletes the existing nested UID. Sui records it as
          // unwrapped-then-deleted, without a standalone historical input.
          const c = change(oldTable.id)
          check(c.inputState.$kind === 'NotExist' && c.outputState.$kind === 'NotExist'
            && c.idOperation.$kind === 'Deleted', 'HISTORY_NESTED_TABLE_DELETION')
        } else {
          await buyer.before(p.expected.buyerTableBcs)
          check(same(await buyer.read('mutated'), { id: oldTable.id, size: String(BigInt(oldTable.size) - 1n) }), 'HISTORY_BUYER_TRANSITION')
        }
      } else {
        const table = oldTable ? await buyer.transition(p.expected.buyerTableBcs,
          { id: oldTable.id, size: String(BigInt(oldTable.size) + (p.expected.paidEntryBcs === null ? 1n : 0n)) })
          : await buyer.read('created')
        check(table.id !== buyer.objectId && table.id !== p.paidAccessListId
          && (!oldTable || table.id === oldTable.id) && table.size === String((oldTable ? BigInt(oldTable.size) : 0n)
            + (p.expected.paidEntryBcs === null ? 1n : 0n)), 'HISTORY_BUYER_TRANSITION')
        const entry = field(table.id, 'u32', N, p.kind, `${pkg}::paid_access::KindPaidEntry`, D.PaidEntry)
        const previous = p.expected.paidEntryBcs === null ? null : soulAccessBcs(D.PaidEntry, p.expected.paidEntryBcs)
        const expires = soulAccessPurchaseExpiry(p.quote.durationMs,
          previous?.ownership_epoch_snapshot === p.ownershipEpoch ? previous.expires_at_ms : null, now!)
        await entry.transition(p.expected.paidEntryBcs, { version: '1', scope_mask: String(p.quote.scopeMask),
          expires_at_ms: expires, ownership_epoch_snapshot: p.ownershipEpoch })
        if (!oldTable) expectedPaid.entries.size = String(BigInt(paid.value.entries.size) + 1n)
        result.expiresAtMs = expires
      }
    }
    const output = await root(p.paidAccessListId, `${pkg}::paid_access::SoulPaidAccessList`, D.Paid, 'mutated')
    check(same(output.value, expectedPaid), 'HISTORY_PAID_TRANSITION'); result.paidAccessVersion = output.version
  }

  // Exact owned USDC inputs, merge deletions, buyer change, and recipient/amount
  // multiset. Gas is a separate SUI lineage and cannot cover a missing payout.
  if (p.action === 'paid-purchase') {
    const type = `0x2::coin::Coin<${p.deployment.paymentCoinType}>`
    for (const [index, coin] of p.input.paymentCoins.entries()) {
      const c = change(coin.objectId), ref = c.inputState.Exist
      check(ref?.[0][0] === coin.version && ref[0][1] === coin.digest && ownerIs(ref[1], 'AddressOwner', p.author), 'HISTORY_PAYMENT_REFERENCE')
      const before = await object(coin.objectId, type, 'input')
      check(same(decode(SoulAccessCoinBcs, before.bytes), { id: coin.objectId, balance: coin.balance }), 'HISTORY_PAYMENT_INPUT')
      if (index === 0) {
        const output = await object(coin.objectId, type, 'mutated'), balance = p.input.paymentCoins.reduce((n, row) => n + BigInt(row.balance), 0n) - BigInt(p.quote.totalAtomic)
        check(ownerIs(output.owner, 'AddressOwner', p.author)
          && same(decode(SoulAccessCoinBcs, output.bytes), { id: coin.objectId, balance: String(balance) }), 'HISTORY_PAYMENT_CHANGE')
      } else check(c.outputState.$kind === 'NotExist' && c.idOperation.$kind === 'Deleted', 'HISTORY_PAYMENT_MERGE')
    }
    const wanted = [{ owner: p.currentOwner, amount: p.quote.priceAtomic },
      ...(p.quote.feeAtomic === '0' ? [] : [{ owner: p.quote.feeRecipient!, amount: p.quote.feeAtomic }])]
    const candidates = e.changedObjects.filter(([id, c]) => !allowed.has(id) && !tx.gasData.payment!.some(row => row.objectId === id)
      && c.idOperation.$kind === 'Created' && c.outputState.ObjectWrite?.[1].AddressOwner !== undefined)
    check(candidates.length === wanted.length, 'HISTORY_PAYOUT_COUNT')
    for (const [id] of candidates) {
      const output = await object(id, type, 'created'), coin = decode(SoulAccessCoinBcs, output.bytes)
      const index = wanted.findIndex(row => row.owner === output.owner.AddressOwner && row.amount === coin.balance)
      check(coin.id === id && index >= 0, 'HISTORY_PAYOUT'); wanted.splice(index, 1)
    }
    check(wanted.length === 0, 'HISTORY_PAYOUT_MISSING')
  }
  const gas = tx.gasData.payment!
  check(e.gasObjectIndex !== null && e.changedObjects[e.gasObjectIndex]?.[0] === gas[0].objectId, 'HISTORY_GAS_INDEX')
  for (const [index, coin] of gas.entries()) {
    const c = change(coin.objectId), input = c.inputState.Exist
    check(input?.[0][0] === coin.version && input[0][1] === coin.digest && ownerIs(input[1], 'AddressOwner', p.author), 'HISTORY_GAS_REFERENCE')
    if (index === 0) check(c.idOperation.$kind === 'None' && c.outputState.ObjectWrite
      && ownerIs(c.outputState.ObjectWrite[1], 'AddressOwner', p.author), 'HISTORY_GAS_OUTPUT')
    else check(c.idOperation.$kind === 'Deleted' && c.outputState.$kind === 'NotExist', 'HISTORY_GAS_MERGE')
  }
  check(e.changedObjects.every(([id]) => allowed.has(id)) && e.unchangedConsensusObjects.every(([id]) => reads.has(id)), 'HISTORY_UNEXPECTED_EFFECT')
  const expectedReads = tx.inputs.flatMap(row => row.Object?.SharedObject && !row.Object.SharedObject.mutable ? [row.Object.SharedObject.objectId] : [])
  check(expectedReads.length === reads.size && expectedReads.every(id => reads.has(id)), 'HISTORY_READ_SET')
  return result
}
