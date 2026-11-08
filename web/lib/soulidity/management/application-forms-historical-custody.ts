import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { SoulPublicKioskBcs } from '@soulidity/sdk'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { CanonicalOwnedAccountBcs } from '../canonical-native-workbench'
import { parseFormsManagementRecord } from './application-forms-record'
import { readFormsHistoricalRoot } from './application-forms-historical-root'

function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_FORMS_CUSTODY_${code}`) }
/** Original effects-version Account/Kiosk pair. Still requires the exact native
 * Item/lock fields, code qualification and complete application/business outputs.
 * An author's current wallet, creator identity or current Account is not used. */
export async function readFormsHistoricalCustody(input: Parameters<typeof readFormsHistoricalRoot>[0] & { custodyTypeOrigin: string }) {
  const record = parseFormsManagementRecord(input.record), p = record.plan, custody = input.custodyTypeOrigin
  check(/^0x[0-9a-f]{64}$/.test(custody) && !/^0x0+$/.test(custody), 'ORIGIN')
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(45000)])
  const root = await readFormsHistoricalRoot({ ...input, record, signal })
  if (root.status !== 'HISTORICAL_ROOT_JOURNAL_EVIDENCE') return root
  const data = Transaction.from(fromBase64(record.packet.bytes)).getData()
  const accountRefs = data.inputs.flatMap(row => row.Object?.ImmOrOwnedObject?.objectId === p.accountId ? [row.Object.ImmOrOwnedObject] : [])
  const kioskRefs = data.inputs.flatMap(row => row.Object?.SharedObject?.objectId === p.kioskId ? [row.Object.SharedObject] : [])
  check(accountRefs.length === 1 && kioskRefs.length === 1 && kioskRefs[0].mutable, 'PACKET_ROLES')
  const read = (objectId: string, type: string, mode: 'input' | 'mutated') => readHistoricalMoveObject({ client: input.client,
    effects: root.effects, transactionDigest: root.transactionDigest, objectId, type, mode, signal, maxBytes: 256 * 1024 })
  const accountBefore = await read(p.accountId, `${custody}::account::Account`, 'input')
  const accountAfter = await read(p.accountId, `${custody}::account::Account`, 'mutated')
  check(String(accountBefore.reference.version) === accountRefs[0].version && accountBefore.reference.digest === accountRefs[0].digest
    && accountBefore.object.owner.AddressOwner === p.author && accountAfter.object.owner.AddressOwner === p.author
    && toBase64(accountBefore.bytes) === toBase64(accountAfter.bytes), 'ACCOUNT_REFERENCE')
  const account = CanonicalOwnedAccountBcs.parse(accountBefore.bytes), authority = account.authority
  check(CanonicalOwnedAccountBcs.serialize(account).toBase64() === toBase64(accountBefore.bytes)
    && account.id === p.accountId && account.kiosk === p.kioskId && account.owner === p.author
    && authority && authority.kiosk === p.kioskId && authority.owner === p.author && authority.cap.for === p.kioskId
    && [0, 32].includes(authority.closed_digest.length)
    && !/^0x0+$/.test(authority.cap.id) && new Set([p.accountId, p.kioskId, p.soulId, authority.cap.id]).size === 4, 'ACCOUNT_PAIR')
  const kioskBefore = await read(p.kioskId, '0x2::kiosk::Kiosk', 'input'), kioskAfter = await read(p.kioskId, '0x2::kiosk::Kiosk', 'mutated')
  check(kioskBefore.object.owner.Shared?.initialSharedVersion === kioskRefs[0].initialSharedVersion
    && kioskAfter.object.owner.Shared?.initialSharedVersion === kioskRefs[0].initialSharedVersion
    && toBase64(kioskBefore.bytes) === toBase64(kioskAfter.bytes), 'KIOSK_REFERENCE')
  const kiosk = SoulPublicKioskBcs.parse(kioskBefore.bytes)
  check(SoulPublicKioskBcs.serialize(kiosk).toBase64() === toBase64(kioskBefore.bytes) && kiosk.id === p.kioskId
    && kiosk.owner === p.author && kiosk.item_count > 0 && !kiosk.allow_extensions, 'KIOSK_PAIR')
  signal.throwIfAborted()
  return { ...root, status: 'HISTORICAL_CUSTODY_PAIR_EVIDENCE' as const, account, kiosk,
    accountReference: accountAfter.reference, kioskReference: kioskAfter.reference,
    historicalCustodyPairVerified: true as const, requiresNativeKioskItemAndLockProof: true as const,
    completeBusinessOutputVerified: false as const }
}
