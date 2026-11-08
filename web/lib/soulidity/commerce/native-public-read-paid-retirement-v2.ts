import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { MAINNET_GENESIS_DIGEST } from '../../animacraft/mainnet-chain'
import { validateEpochCheckpoint, type EpochCheckpoint } from '../../sui/epoch-checkpoint'
import { readEpochExpiry } from '../../sui/epoch-expiry'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { publicMutationCanonical as canonical, type PublicMutationPacket } from '../../sui/public-mutation-journal'
import { NativeInitialPaidBcs } from '../native-initial-children'
import { NativePublicReadHostV2Bcs } from '../native-public-read-record-v2'
import type { CanonicalNativeWorkbenchTarget } from '../canonical-native-workbench'
import { commerceCheck as check, commerceId, decodeCommerce, readCommerceObject, type EconomicsTarget } from './economics-read'
import { validateExplicitGasConflict, verifyExplicitGasConflict, type ExplicitGasConflict } from './explicit-gas-conflict'
import { assertRetirementReceiptAbsent, MAX_INCOME_RETIREMENT_RECEIPTS } from './income-retirement-receipt-table'
import { NativePaidAttemptFieldBcs, NativePaidAttemptKeyBcs } from './native-paid-content-receipt'
import type { NativePublicReadPaidPreparedOriginalV2 } from './native-public-read-paid-preflight-v2'

export interface NativePaidRetirementSourceV2 {
  target: CanonicalNativeWorkbenchTarget
  economics: EconomicsTarget
  auditSha256: string
}

/** Root admission attests that this exact effective deployment always appends
 * a receipt on payment and cannot replace its Host ledger or remove attempts.
 * Installations come from reviewed source, never the packet or public config. */
export const ROOT_NATIVE_PAID_RETIREMENT_SOURCES_V2: readonly NativePaidRetirementSourceV2[] = Object.freeze([])

type Reference = { objectId: string; version: string; digest: string }
type RetirementBasis = { checkpoint: EpochCheckpoint; auditSha256: string }
type ReceiptTableEvidence = RetirementBasis & {
  host: Reference
  pointer: Reference
  ledger: Reference
  tableId: string
  tableSize: string
  receiptFieldId: string
}
export type NativePaidRetirementEvidenceV2 = ReceiptTableEvidence | (RetirementBasis & { conflict: ExplicitGasConflict })
const prefix = 'PAID_V2_RETIREMENT'
const Link = bcs.struct('Field', { id: bcs.Address,
  name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: bcs.Address })
const hash = (s: unknown) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)
const uint = (s: unknown) => typeof s === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(s) && BigInt(s) <= (1n << 64n) - 1n
const exact = (row: object | undefined, fields: string[]) => row && Object.keys(row).sort().join() === fields.sort().join()

export function validateNativePaidRetirementEvidenceV2<T extends NativePaidRetirementEvidenceV2>(value: T, packet: PublicMutationPacket): T {
  check(value && exact(value.checkpoint, ['bytes', 'digest', 'epoch', 'sequenceNumber']) && hash(value.auditSha256), 'PAID_V2_RETIREMENT_EVIDENCE')
  validateEpochCheckpoint(value.checkpoint, packet.expirationEpoch)
  if ('conflict' in value) {
    check(exact(value, ['checkpoint', 'auditSha256', 'conflict']), 'PAID_V2_RETIREMENT_EVIDENCE')
    validateExplicitGasConflict(value.conflict, packet, value.checkpoint, prefix)
    return value
  }
  check(exact(value, ['checkpoint', 'auditSha256', 'host', 'pointer', 'ledger', 'tableId', 'tableSize', 'receiptFieldId'])
    && commerceId(value.tableId) && commerceId(value.receiptFieldId) && uint(value.tableSize)
    && BigInt(value.tableSize) <= MAX_INCOME_RETIREMENT_RECEIPTS, 'PAID_V2_RETIREMENT_EVIDENCE')
  const ids = [value.tableId, value.receiptFieldId]
  for (const row of [value.host, value.pointer, value.ledger]) {
    check(exact(row, ['objectId', 'version', 'digest']) && commerceId(row.objectId)
      && uint(row.version) && BigInt(row.version) > 0n && typeof row.digest === 'string' && row.digest.length <= 44,
    'PAID_V2_RETIREMENT_REFERENCE')
    const digest = fromBase58(row.digest)
    check(digest.length === 32 && toBase58(digest) === row.digest, 'PAID_V2_RETIREMENT_REFERENCE_DIGEST')
    ids.push(row.objectId)
  }
  check(new Set(ids).size === ids.length, 'PAID_V2_RETIREMENT_ALIASES')
  return value
}

export async function verifyNativePaidRetirementV2<T extends { status: string }>(input: {
  original: NativePublicReadPaidPreparedOriginalV2
  client: SuiGrpcClient
  signal: AbortSignal
  sources: readonly NativePaidRetirementSourceV2[]
  saved?: NativePaidRetirementEvidenceV2
  conflictDigest?: string
  queryOriginal: () => Promise<T>
}) {
  const { client, signal, queryOriginal } = input, original = structuredClone(input.original)
  const { intent, context, packet } = original
  const { native, content, foundation, soulId, ledgerId } = context.originalReceiptContext
  const matches = input.sources.filter(row => canonical(row.target) === canonical(context.target)
    && canonical(row.economics) === canonical(context.economics))
  check(matches.length === 1 && hash(matches[0].auditSha256), 'PAID_V2_RETIREMENT_SOURCE_NOT_INSTALLED')
  const auditSha256 = matches[0].auditSha256
  const saved = input.saved && validateNativePaidRetirementEvidenceV2(structuredClone(input.saved), packet)
  check(input.conflictDigest === undefined || !saved, 'PAID_V2_RETIREMENT_CONFLICT_OVERRIDE')
  check(!saved || saved.auditSha256 === auditSha256, 'PAID_V2_RETIREMENT_STORED_SCOPE')
  const checkpoint = await readEpochExpiry(client, packet.expirationEpoch, signal, MAINNET_GENESIS_DIGEST, saved?.checkpoint, prefix)
  const [nativePackage, contentPackage, foundationPackage] = await Promise.all(
    [native, content, foundation].map(pin => readPinnedMovePackage(client, pin, signal)))
  for (const [from, to] of [[nativePackage, contentPackage], [nativePackage, foundationPackage], [contentPackage, foundationPackage]]) {
    const dependency = from.linkage.get(to.pin.originalPackageId)
    check(dependency?.upgradedId === to.pin.callablePackageId && dependency.upgradedVersion === String(to.version), 'PAID_V2_RETIREMENT_LINKAGE')
  }
  const savedConflict = saved && 'conflict' in saved ? saved.conflict : undefined
  const candidate = savedConflict?.digest ?? input.conflictDigest
  if (candidate !== undefined) {
    const conflict = await verifyExplicitGasConflict({ client, signal, packet, checkpoint, author: intent.buyer,
      digest: candidate, saved: savedConflict, prefix })
    const observed = await queryOriginal()
    check(observed.status === 'MISSING', 'PAID_V2_RETIREMENT_ORIGINAL_FOUND')
    signal.throwIfAborted()
    return { evidence: { checkpoint, auditSha256, conflict }, observed }
  }
  function type(pkg: typeof nativePackage, module: string, name: string) {
    const origin = pkg.origins.get(module + '::' + name)
    check(origin, 'PAID_V2_RETIREMENT_TYPE_ORIGIN')
    return origin + '::' + module + '::' + name
  }
  const hostType = type(nativePackage, 'birth', 'PublicReadHostV2')
  const keyType = type(nativePackage, 'birth', 'PaidKey')
  const operatorType = type(nativePackage, 'birth', 'ContentOperator')
  const ledgerType = type(contentPackage, 'paid_access', 'Ledger')
  const requestType = type(contentPackage, 'paid_access', 'AttemptKey')
  const receiptType = type(contentPackage, 'paid_access', 'Receipt')
  const wrapper = '0x2::dynamic_object_field::Wrapper<' + keyType + '>'
  const ref = ({ objectId, version, digest }: Reference): Reference => ({ objectId, version, digest })
  async function readLedger() {
    const host = await readCommerceObject(client, intent.host.objectId, hostType, signal)
    const { state, id, root } = decodeCommerce(NativePublicReadHostV2Bcs, host.contents)
    check(id === host.objectId && root === soulId && host.owner.Shared?.initialSharedVersion === intent.host.initialSharedVersion
      && BigInt(host.version) >= BigInt(intent.host.initialSharedVersion)
      && state.root === soulId && state.schema === 1 && state.protocol === intent.config.objectId
      && state.registry === intent.registry.objectId && state.issuer.original === native.originalPackageId, 'PAID_V2_RETIREMENT_HOST_SCOPE')
    const pointerId = deriveDynamicFieldID(state.id, wrapper, moveEmptyStructBytes())
    const pointer = await readCommerceObject(client, pointerId, '0x2::dynamic_field::Field<' + wrapper + ',0x2::object::ID>', signal)
    const field = decodeCommerce(Link, pointer.contents)
    check(pointer.owner.ObjectOwner === state.id && field.id === pointerId && !field.name.name.dummy_field && field.value === ledgerId,
      'PAID_V2_RETIREMENT_LEDGER_POINTER')
    const ledger = await readCommerceObject(client, ledgerId, ledgerType, signal)
    const paid = decodeCommerce(NativeInitialPaidBcs, ledger.contents), table = paid.attempts
    check(ledger.owner.ObjectOwner === pointerId && paid.id === ledgerId && paid.root === soulId
      && paid.protocol === intent.config.objectId && paid.controller.root === soulId && paid.controller.parent === state.id
      && normalizeStructTag(paid.controller.operator.name) === operatorType && BigInt(table.size) <= BigInt(paid.revision), 'PAID_V2_RETIREMENT_LEDGER_SCOPE')
    const ids = [id, soulId, state.id, pointerId, ledgerId, table.id, paid.offers.id, paid.entries.id, intent.config.objectId, intent.registry.objectId]
    check(ids.every(commerceId) && new Set(ids).size === ids.length, 'PAID_V2_RETIREMENT_LEDGER_ALIASES')
    return { host: ref(host), pointer: ref(pointer), ledger: ref(ledger), table }
  }
  const { host, pointer, ledger, table } = await readLedger()
  const key = NativePaidAttemptKeyBcs.serialize({ buyer: intent.buyer, attempt: intent.attempt }).toBytes()
  const receiptFieldId = deriveDynamicFieldID(table.id, requestType, key)
  const evidence = validateNativePaidRetirementEvidenceV2({ checkpoint, auditSha256, host, pointer, ledger,
    tableId: table.id, tableSize: table.size, receiptFieldId }, packet)
  if (saved && !('conflict' in saved)) {
    check(saved.tableId === table.id && saved.receiptFieldId === receiptFieldId
      && BigInt(evidence.tableSize) >= BigInt(saved.tableSize)
      && (saved.ledger.version !== ledger.version || saved.tableSize === evidence.tableSize), 'PAID_V2_RETIREMENT_STORED_SCOPE')
    for (const [previous, current] of [[saved.host, host], [saved.pointer, pointer], [saved.ledger, ledger]]) {
      check(previous.objectId === current.objectId && BigInt(current.version) >= BigInt(previous.version)
        && (current.version !== previous.version || current.digest === previous.digest), 'PAID_V2_RETIREMENT_STORED_REFERENCE')
    }
  }
  await assertRetirementReceiptAbsent({ client, rootId: ledgerId, table, requestType, receiptType, receiptFieldId, signal,
    errorPrefix: 'PAID_V2_RETIREMENT', authenticateKey(contents, objectId) {
      const field = decodeCommerce(NativePaidAttemptFieldBcs, contents), { buyer, attempt } = field.name, receipt = field.value
      check(field.id === objectId && commerceId(buyer) && attempt.length === 32 && attempt.some(n => n !== 0)
        && receipt.quote.length === 32 && receipt.entry_hash.length === 32
        && BigInt(receipt.price) + BigInt(receipt.platform_fee) === BigInt(receipt.total), 'PAID_V2_RETIREMENT_RECEIPT_BINDING')
      return NativePaidAttemptKeyBcs.serialize(field.name).toBytes()
    } })
  const observed = await queryOriginal()
  check(observed.status === 'MISSING', 'PAID_V2_RETIREMENT_ORIGINAL_FOUND')
  check(canonical(await readLedger()) === canonical({ host, pointer, ledger, table }), 'PAID_V2_RETIREMENT_LEDGER_CHANGED')
  signal.throwIfAborted()
  return { evidence, observed }
}
