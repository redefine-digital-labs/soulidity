import { createManagementSharedHistorySession } from './application-shared-history-session'
import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase64 } from '@mysten/sui/utils'
import { assertKioskItemField, deriveKioskItemFieldId, KIOSK_ITEM_FIELD_TYPE, SoulPublicKioskBcs } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { readHistoricalChildThroughParent } from '../../sui/historical-parent-lineage'
import { parseFormsManagementRecord } from './application-forms-record'
import { readFormsHistoricalCustody } from './application-forms-historical-custody'

function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_NATIVE_${code}`) }
const LockKey = bcs.struct('Lock', { id: bcs.Address })
const LockField = bcs.struct('Field', { id: bcs.Address, name: LockKey, value: bcs.bool() })

/** Original native custody fields on both sides of the transaction. Follows
 * authenticated shared-parent input/output version lineage; never reads latest
 * dynamic fields or infers missing historical data from RPC absence. Listing
 * absence, code qualification and application/business outputs remain required. */
export async function readFormsHistoricalNativeFields(input: Parameters<typeof readFormsHistoricalCustody>[0] & { maxParentHops?: number }) {
  const record = parseFormsManagementRecord(input.record), p = record.plan
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const custody = await readFormsHistoricalCustody({ ...input, record, signal })
  if (custody.status !== 'HISTORICAL_CUSTODY_PAIR_EVIDENCE') return custody
  const itemId = deriveKioskItemFieldId(p.kioskId, p.soulId), lockType = '0x2::kiosk::Lock'
  const lockId = deriveDynamicFieldID(p.kioskId, lockType, LockKey.serialize({ id: p.soulId }).toBytes())
  const read = (mode: 'input' | 'written', childId: string, childType: string) => readHistoricalChildThroughParent({
    client: input.client, anchorEffects: custody.effects, anchorTransactionDigest: custody.transactionDigest, anchorCheckpoint: custody.checkpoint,
    anchorMode: mode, rootId: p.kioskId, rootType: '0x2::kiosk::Kiosk', parentUid: p.kioskId, childId, childType,
    chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST, signal, maxHops: input.maxParentHops,
    assertContainsParent: (bytes, uid) => {
      const kiosk = SoulPublicKioskBcs.parse(bytes)
      check(SoulPublicKioskBcs.serialize(kiosk).toBase64() === toBase64(bytes) && kiosk.id === p.kioskId && kiosk.id === uid, 'PARENT')
    },
  })
  const [itemBefore, itemAfter, lockBefore, lockAfter] = await Promise.all([
    read('input', itemId, KIOSK_ITEM_FIELD_TYPE), read('written', itemId, KIOSK_ITEM_FIELD_TYPE),
    read('input', lockId, `0x2::dynamic_field::Field<${lockType},bool>`), read('written', lockId, `0x2::dynamic_field::Field<${lockType},bool>`),
  ])
  for (const item of [itemBefore, itemAfter]) check(assertKioskItemField(item.bytes, p.kioskId, p.soulId) === itemId, 'ITEM_FIELD')
  for (const lock of [lockBefore, lockAfter]) {
    const field = LockField.parse(lock.bytes)
    check(LockField.serialize(field).toBase64() === toBase64(lock.bytes) && field.id === lockId && field.name.id === p.soulId && field.value, 'LOCK_FIELD')
  }
  check(toBase64(itemBefore.bytes) === toBase64(itemAfter.bytes) && toBase64(lockBefore.bytes) === toBase64(lockAfter.bytes), 'FIELD_CHANGED')
  signal.throwIfAborted()
  return { ...custody, status: 'HISTORICAL_NATIVE_CUSTODY_EVIDENCE' as const,
    nativeItemAndLockVerified: true as const, nativeFields: { itemBefore, itemAfter, lockBefore, lockAfter },
    requiresNativeKioskItemAndLockProof: false as const, requiresKioskAccountTreeProof: false as const,
    requiresListingAbsenceProof: true as const, completeBusinessOutputVerified: false as const }
}

/** Query-only private continuation for all four original Item/Lock proofs.
 * The original custody anchor is fixed for the lifetime of this session. */
export async function createFormsHistoricalNativeSession(input: Parameters<typeof readFormsHistoricalCustody>[0] & { maxTotalHops?: number }) {
  input = { ...input, record: structuredClone(input.record) }
  const record = parseFormsManagementRecord(input.record), p = record.plan
  const custody = await readFormsHistoricalCustody({ ...input, record })
  check(custody.status === 'HISTORICAL_CUSTODY_PAIR_EVIDENCE', 'SESSION_CUSTODY_UNAVAILABLE')
  const itemId = deriveKioskItemFieldId(p.kioskId, p.soulId), lockType = '0x2::kiosk::Lock'
  const lockId = deriveDynamicFieldID(p.kioskId, lockType, LockKey.serialize({ id: p.soulId }).toBytes())
  const sessions: Awaited<ReturnType<typeof createManagementSharedHistorySession>>[] = []
  let closed = false, busy = false
  const dispose = () => { closed = true; for (const session of sessions) session.dispose() }
  try {
    for (const [mode, childId, childType] of [
      ['input', itemId, KIOSK_ITEM_FIELD_TYPE], ['written', itemId, KIOSK_ITEM_FIELD_TYPE],
      ['input', lockId, `0x2::dynamic_field::Field<${lockType},bool>`], ['written', lockId, `0x2::dynamic_field::Field<${lockType},bool>`],
    ] as const) sessions.push(await createManagementSharedHistorySession({
      client: input.client, anchorEffects: custody.effects, anchorTransactionDigest: custody.transactionDigest, anchorCheckpoint: custody.checkpoint,
      anchorMode: mode, rootId: p.kioskId, rootType: '0x2::kiosk::Kiosk', parentUid: p.kioskId, childId, childType,
      chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST, signal: input.signal, maxTotalHops: input.maxTotalHops,
      assertContainsParent(bytes, uid) {
        const kiosk = SoulPublicKioskBcs.parse(bytes)
        check(SoulPublicKioskBcs.serialize(kiosk).toBase64() === toBase64(bytes) && kiosk.id === p.kioskId && kiosk.id === uid, 'PARENT')
      },
    }))
    input.signal.throwIfAborted()
  } catch (error) { dispose(); throw error }
  return {
    dispose,
    progress: () => ({ closed: closed || input.signal.aborted, fields: sessions.map(session => session.progress()), completeBusinessOutputVerified: false as const }),
    async advance(options: { maxHops?: number } = {}) {
      input.signal.throwIfAborted(); check(!closed && !busy, 'SESSION_CLOSED_OR_BUSY'); busy = true
      try {
        // Settle every concurrent field before permitting a retry or disposal.
        const settled = await Promise.allSettled(sessions.map(session => session.advance(options)))
        const failure = settled.find(row => row.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
        const results = settled.map(row => { if (row.status !== 'fulfilled') throw Error('APPLICATION_FORMS_NATIVE_SESSION_RESULT'); return row.value })
        input.signal.throwIfAborted(); check(!closed, 'SESSION_CLOSED_OR_BUSY')
        if (results.some(row => row.status !== 'PROVEN')) return { status: 'INCOMPLETE' as const, fields: sessions.map(session => session.progress()), completeBusinessOutputVerified: false as const }
        const proofs = results.map(row => { if (row.status !== 'PROVEN') throw Error('APPLICATION_FORMS_NATIVE_SESSION_RESULT'); return row.proof })
        const [itemBefore, itemAfter, lockBefore, lockAfter] = proofs
        for (const item of [itemBefore, itemAfter]) check(assertKioskItemField(item.bytes, p.kioskId, p.soulId) === itemId, 'ITEM_FIELD')
        for (const lock of [lockBefore, lockAfter]) {
          const field = LockField.parse(lock.bytes)
          check(LockField.serialize(field).toBase64() === toBase64(lock.bytes) && field.id === lockId && field.name.id === p.soulId && field.value, 'LOCK_FIELD')
        }
        check(toBase64(itemBefore.bytes) === toBase64(itemAfter.bytes) && toBase64(lockBefore.bytes) === toBase64(lockAfter.bytes), 'FIELD_CHANGED')
        return { ...structuredClone(custody), status: 'HISTORICAL_NATIVE_CUSTODY_EVIDENCE' as const,
          nativeItemAndLockVerified: true as const, nativeFields: { itemBefore, itemAfter, lockBefore, lockAfter },
          requiresNativeKioskItemAndLockProof: false as const, requiresKioskAccountTreeProof: false as const,
          requiresListingAbsenceProof: true as const, completeBusinessOutputVerified: false as const }
      } finally { busy = false }
    },
  }
}
