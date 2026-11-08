import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase64, toBase64 } from '@mysten/sui/utils'
import { assertKioskItemField, deriveKioskItemFieldId, KIOSK_ITEM_FIELD_TYPE, SoulPublicKioskBcs } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readHistoricalChildThroughParent } from '../../sui/historical-parent-lineage'
import { CanonicalOwnedAccountBcs } from '../canonical-native-workbench'
import { parseEquipmentManagementRecord } from './equipment-record'
import { readEquipmentHistoricalRootApplication } from './equipment-historical-root-application'
import { captureAccountOriginalReadClientV155 } from './account-original-readers-v155'
import { createManagementKioskListingHistorySession } from './application-listing-history-session'

type ListingSession = Awaited<ReturnType<typeof createManagementKioskListingHistorySession>>
type ListingProof = Extract<Awaited<ReturnType<ListingSession['advance']>>, { status: 'PROVEN' }>['proof']
const LockKey = bcs.struct('Lock', { id: bcs.Address })
const LockField = bcs.struct('Field', { id: bcs.Address, name: LockKey, value: bcs.bool() })
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`MANAGEMENT_EQUIPMENT_CUSTODY_V155_${code}`) }
/** Original checkpoint custody only. This never reads current authority or
 * upgrades partial historical evidence to a successful business receipt.
 * Supplied origins must match authenticated raw object types; original source
 * qualification, slot/source inventories and every other effect remain owed. */
export async function readEquipmentHistoricalCustodyV155(input: Parameters<typeof readEquipmentHistoricalRootApplication>[0] & {
  custodyTypeOrigin: string; maxParentHops?: number
}) {
  const record = parseEquipmentManagementRecord(input.record), p = record.plan
  const custodyTypeOrigin = input.custodyTypeOrigin, standardTypeOrigin = input.standardTypeOrigin, maxParentHops = input.maxParentHops
  check(typeof custodyTypeOrigin === 'string' && /^0x[0-9a-f]{64}$/.test(custodyTypeOrigin) && !/^0x0+$/.test(custodyTypeOrigin), 'CUSTODY_ORIGIN')
  check(maxParentHops === undefined || Number.isSafeInteger(maxParentHops) && maxParentHops > 0 && maxParentHops <= 256, 'HISTORY_BOUND')
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(120000)]), client = captureAccountOriginalReadClientV155(input.client, input.signal)
  signal.throwIfAborted()
  const evidence = await readEquipmentHistoricalRootApplication({ client, record, signal, standardTypeOrigin })
  signal.throwIfAborted()
  if (!evidence.rootApplication) return { ...evidence, custody: null }
  const execution = evidence.execution
  check(execution.status === 'FINALIZED_EXECUTION', 'FINALITY')
  const data = Transaction.from(fromBase64(record.packet.bytes)).getData()
  const accountRefs = data.inputs.flatMap(row => row.Object?.ImmOrOwnedObject?.objectId === p.accountId ? [row.Object.ImmOrOwnedObject] : [])
  const kioskRefs = data.inputs.flatMap(row => row.Object?.SharedObject?.objectId === p.kioskId ? [row.Object.SharedObject] : [])
  check(accountRefs.length === 1 && kioskRefs.length === 1 && kioskRefs[0].mutable, 'PACKET_ROLES')
  const read = (objectId: string, type: string, mode: 'input' | 'mutated') => readHistoricalMoveObject({ client,
    effects: execution.effects, transactionDigest: record.packet.digest, objectId, type, mode, signal, maxBytes: 256 * 1024 })
  const accountBefore = await read(p.accountId, `${custodyTypeOrigin}::account::Account`, 'input')
  const accountAfter = await read(p.accountId, `${custodyTypeOrigin}::account::Account`, 'mutated')
  check(String(accountBefore.reference.version) === accountRefs[0].version && accountBefore.reference.digest === accountRefs[0].digest
    && accountBefore.object.owner.AddressOwner === p.author && accountAfter.object.owner.AddressOwner === p.author
    && toBase64(accountBefore.bytes) === toBase64(accountAfter.bytes), 'ACCOUNT_REFERENCE')
  const account = CanonicalOwnedAccountBcs.parse(accountBefore.bytes), authority = account.authority
  check(CanonicalOwnedAccountBcs.serialize(account).toBase64() === toBase64(accountBefore.bytes)
    && account.id === p.accountId && account.kiosk === p.kioskId && account.owner === p.author
    && authority && authority.kiosk === p.kioskId && authority.owner === p.author && authority.cap.for === p.kioskId
    && [0, 32].includes(authority.closed_digest.length) && !/^0x0+$/.test(authority.cap.id)
    && new Set([p.accountId, p.kioskId, p.soulId, authority.cap.id]).size === 4, 'ACCOUNT_PAIR')
  const kioskBefore = await read(p.kioskId, '0x2::kiosk::Kiosk', 'input'), kioskAfter = await read(p.kioskId, '0x2::kiosk::Kiosk', 'mutated')
  check(kioskBefore.object.owner.Shared?.initialSharedVersion === kioskRefs[0].initialSharedVersion
    && kioskAfter.object.owner.Shared?.initialSharedVersion === kioskRefs[0].initialSharedVersion
    && toBase64(kioskBefore.bytes) === toBase64(kioskAfter.bytes), 'KIOSK_REFERENCE')
  const kiosk = SoulPublicKioskBcs.parse(kioskBefore.bytes)
  check(SoulPublicKioskBcs.serialize(kiosk).toBase64() === toBase64(kioskBefore.bytes) && kiosk.id === p.kioskId
    && kiosk.owner === p.author && kiosk.item_count > 0 && !kiosk.allow_extensions, 'KIOSK_PAIR')
  const itemId = deriveKioskItemFieldId(p.kioskId, p.soulId), lockType = '0x2::kiosk::Lock'
  const lockId = deriveDynamicFieldID(p.kioskId, lockType, LockKey.serialize({ id: p.soulId }).toBytes())
  const child = (mode: 'input' | 'written', childId: string, childType: string) => readHistoricalChildThroughParent({ client,
    anchorEffects: execution.effects, anchorTransactionDigest: record.packet.digest, anchorCheckpoint: execution.checkpoint,
    anchorMode: mode, rootId: p.kioskId, rootType: '0x2::kiosk::Kiosk', parentUid: p.kioskId, childId, childType,
    chainIdentifier: p.target.chainIdentifier, genesisDigest: MAINNET_GENESIS_DIGEST, signal, maxHops: maxParentHops,
    assertContainsParent(bytes, uid) {
      const parent = SoulPublicKioskBcs.parse(bytes)
      check(SoulPublicKioskBcs.serialize(parent).toBase64() === toBase64(bytes) && parent.id === p.kioskId && parent.id === uid, 'PARENT')
    } })
  // Await each owned proof; no abandoned parallel work may outlive a failure.
  const itemBefore = await child('input', itemId, KIOSK_ITEM_FIELD_TYPE), itemAfter = await child('written', itemId, KIOSK_ITEM_FIELD_TYPE)
  const lockBefore = await child('input', lockId, `0x2::dynamic_field::Field<${lockType},bool>`)
  const lockAfter = await child('written', lockId, `0x2::dynamic_field::Field<${lockType},bool>`)
  for (const item of [itemBefore, itemAfter]) check(assertKioskItemField(item.bytes, p.kioskId, p.soulId) === itemId, 'ITEM_FIELD')
  for (const lock of [lockBefore, lockAfter]) {
    const field = LockField.parse(lock.bytes)
    check(LockField.serialize(field).toBase64() === toBase64(lock.bytes) && field.id === lockId && field.name.id === p.soulId && field.value, 'LOCK_FIELD')
  }
  check(toBase64(itemBefore.bytes) === toBase64(itemAfter.bytes) && toBase64(lockBefore.bytes) === toBase64(lockAfter.bytes), 'NATIVE_FIELD_CHANGED')
  signal.throwIfAborted()
  return { ...evidence, custody: { status: 'ORIGINAL_EQUIPMENT_CUSTODY_RELATIONS_VERIFIED' as const,
    transactionDigest: record.packet.digest, checkpoint: execution.checkpoint, account, kiosk,
    accountInputReference: accountBefore.reference, accountOutputReference: accountAfter.reference,
    kioskInputReference: kioskBefore.reference, kioskOutputReference: kioskAfter.reference,
    nativeFields: { itemBefore, itemAfter, lockBefore, lockAfter }, historicalAccountKioskPairVerified: true as const,
    nativeItemAndLockVerified: true as const, requiresListingAbsenceProof: true as const,
    requiresQualifiedOriginalSource: true as const, requiresAllEquipmentInventoryAndSemanticProof: true as const,
    requiresGasAndAllEffectsConservation: true as const, completeBusinessOutputVerified: false as const }, completeBusinessOutputVerified: false as const }
}

/** Listing absence must come from an authenticated NotExist output or complete
 * Kiosk ancestry to creation on BOTH original snapshots. A missing RPC row or
 * incomplete bounded walk cannot establish absence. No Forms schema adapter. */
export async function readEquipmentHistoricalUnlistedCustodyV155(input: Parameters<typeof readEquipmentHistoricalCustodyV155>[0]) {
  const record = parseEquipmentManagementRecord(input.record), client = captureAccountOriginalReadClientV155(input.client, input.signal)
  const standardTypeOrigin = input.standardTypeOrigin, custodyTypeOrigin = input.custodyTypeOrigin, maxHops = input.maxParentHops ?? 64
  check(Number.isSafeInteger(maxHops) && maxHops >= 1 && maxHops <= 256, 'HISTORY_BOUND')
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(120000)])
  const evidence = await readEquipmentHistoricalCustodyV155({ client, record, standardTypeOrigin, custodyTypeOrigin, maxParentHops: maxHops, signal })
  if (!evidence.custody) return evidence
  const execution = evidence.execution
  check(execution.status === 'FINALIZED_EXECUTION', 'FINALITY')
  const listingAbsence: ListingProof[] = []
  for (const [mode, exclusive] of [['input', false], ['input', true], ['written', false], ['written', true]] as const) {
    signal.throwIfAborted()
    const session = await createManagementKioskListingHistorySession({ client, signal, mode, exclusive,
      kioskId: record.plan.kioskId, soulId: record.plan.soulId, chainIdentifier: record.plan.target.chainIdentifier,
      anchor: { effects: execution.effects, transactionDigest: record.packet.digest, checkpoint: execution.checkpoint } })
    try {
      const result = await session.advance({ maxHops })
      check(result.status === 'PROVEN', 'LISTING_HISTORY_INCOMPLETE')
      listingAbsence.push(result.proof)
    } finally { session.dispose() }
  }
  signal.throwIfAborted()
  return { ...evidence, custody: { ...evidence.custody, status: 'ORIGINAL_UNLISTED_EQUIPMENT_CUSTODY_VERIFIED' as const,
    listingAbsence, originalListingsAbsent: true as const, requiresListingAbsenceProof: false as const,
    completeBusinessOutputVerified: false as const }, completeBusinessOutputVerified: false as const }
}
