import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { publicMutationCanonical, type PublicMutationPacket } from '../../sui/public-mutation-journal'
import { NativeInitialPaidBcs } from '../native-initial-children'
import { EconomicsConfigBcs, recoverEconomicsHistoricalGates } from './economics-bcs'
import { commerceCheck, decodeCommerce } from './economics-read'
import { PaidContentOfferBcs, PaidContentEntryBcs, PaidContentBuyerKeyBcs, quoteNativePaidContent } from './paid-content-policy'
import type { NativePaidContentPurchase } from './native-paid-content-transaction'
import { assertNativePaidContentPacket, type NativePaidReviewedGas } from './native-paid-content-packet'
export const NativePaidAttemptKeyBcs = bcs.struct('AttemptKey', { buyer: bcs.Address, attempt: bcs.byteVector() })
export const NativePaidReceiptBcs = bcs.struct('Receipt', { kind: bcs.u32(), quote: bcs.byteVector(), entry_hash: bcs.byteVector(),
  price: bcs.u64(), total: bcs.u64(), platform_fee: bcs.u64(), fee_revision: bcs.u64(), platform_recipient: bcs.Address, beneficiary: bcs.Address })
export const NativePaidAttemptFieldBcs = bcs.struct('Field', { id: bcs.Address, name: NativePaidAttemptKeyBcs, value: NativePaidReceiptBcs })
export const NativePaidEntryFieldBcs = bcs.struct('Field', { id: bcs.Address, name: PaidContentBuyerKeyBcs, value: PaidContentEntryBcs })
const Clock = bcs.struct('Clock', { id: bcs.Address, timestamp_ms: bcs.u64() })

/** Original durable attempt/entry/ledger subproof after parent finality.
 * Saved offer is bound to original packet and Config by NativeQuote SHA256.
 * This does not prove original service/State module linkage, full effects,
 * payments/events or protected-content availability. Never current authority.
 */
export async function proveNativePaidContentReceipt(input: { client: SuiGrpcClient; intent: NativePaidContentPurchase;
  packet: Pick<PublicMutationPacket, 'bytes' | 'digest' | 'expirationEpoch'>; gas: NativePaidReviewedGas;
  effects: Parameters<typeof readHistoricalMoveObject>[0]['effects']; offer: ReturnType<typeof PaidContentOfferBcs.parse>;
  soulId: string; stateId: string; ledgerId: string; native: PinnedMovePackage; content: PinnedMovePackage; foundation: PinnedMovePackage; signal: AbortSignal }) {
  const p = structuredClone(input.intent), packet = structuredClone(input.packet), effects = structuredClone(input.effects), offer = structuredClone(input.offer)
  const { client, signal, soulId, stateId, ledgerId } = input, nativePin = structuredClone(input.native), contentPin = structuredClone(input.content), foundationPin = structuredClone(input.foundation)
  await assertNativePaidContentPacket(p, packet, input.gas)
  commerceCheck(effects.V2?.status.$kind === 'Success' && effects.V2.transactionDigest === packet.digest, 'PAID_RECEIPT_CONTEXT')
  const native = await readPinnedMovePackage(client, nativePin, signal), content = await readPinnedMovePackage(client, contentPin, signal), foundation = await readPinnedMovePackage(client, foundationPin, signal)
  commerceCheck(native.pin.callablePackageId === p.nativeCallablePackageId, 'PAID_RECEIPT_CALLABLE')
  for (const [from, pkg] of [[native, content], [content, foundation]] as const) { const link = from.linkage.get(pkg.pin.originalPackageId)
    commerceCheck(link?.upgradedId === pkg.pin.callablePackageId && link.upgradedVersion === String(pkg.version), 'PAID_RECEIPT_LINK') }
  const type = (origins: Map<string, string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin, 'PAID_RECEIPT_ORIGIN'); return `${origin}::${module}::${name}` }
  const read = (id: string, type: string, mode: 'input' | 'mutated' | 'created' | 'readonly') => readHistoricalMoveObject({ client, effects, transactionDigest: packet.digest, objectId: id, type, mode, signal })
  const ledgerType = type(content.origins, 'paid_access', 'Ledger'), beforeObject = await read(ledgerId, ledgerType, 'input'), afterObject = await read(ledgerId, ledgerType, 'mutated')
  const a = decodeCommerce(NativeInitialPaidBcs, beforeObject.bytes), z = decodeCommerce(NativeInitialPaidBcs, afterObject.bytes)
  const paidKey = `0x2::dynamic_object_field::Wrapper<${type(native.origins, 'birth', 'PaidKey')}>`, paidField = deriveDynamicFieldID(stateId, paidKey, moveEmptyStructBytes())
  commerceCheck(a.id === ledgerId && a.root === soulId && a.protocol === p.config.objectId && a.controller.root === soulId && a.controller.parent === stateId
    && normalizeStructTag(a.controller.operator.name) === type(native.origins, 'birth', 'ContentOperator')
    && beforeObject.object.owner.ObjectOwner === paidField && afterObject.object.owner.ObjectOwner === paidField, 'PAID_RECEIPT_LEDGER_BINDING')
  const cfgObject = await read(p.config.objectId, `${type(foundation.origins, 'economics', 'Config')}<${normalizeStructTag(p.coinType)}>`, 'input')
  const cfg = decodeCommerce(EconomicsConfigBcs, cfgObject.bytes)
  commerceCheck(cfgObject.object.owner.Shared?.initialSharedVersion === p.config.initialSharedVersion
    && cfg.id === a.protocol && cfg.income.root === cfg.id && cfg.revision === p.feeRevision && cfg.schema === 3
    && cfg.original_package === foundation.pin.originalPackageId && cfg.callable_package === foundation.pin.callablePackageId
    && normalizeStructTag(cfg.payment_coin.name) === normalizeStructTag(p.coinType), 'PAID_RECEIPT_CONFIG')
  const gates = recoverEconomicsHistoricalGates(cfg).gates
  commerceCheck(cfg.enabled && !cfg.paused && BigInt(cfg.minimum_release) <= 2n && gates.primary, 'PAID_RECEIPT_ORIGINAL_PRIMARY_POLICY')
  // Current frozen ABI calls PaidAuthority1/PaidRevision1. Defining Revision
  // identity can predate the callable package after a compatible upgrade.
  const role = cfg.roles.roles[5], authorityOrigin = content.origins.get('paid_access::PaidAuthority1'), revisionOrigin = content.origins.get('paid_access::PaidRevision1')
  commerceCheck(cfg.roles.roles.length === 6 && role?.pinned && authorityOrigin === content.pin.originalPackageId
    && revisionOrigin && role.original === authorityOrigin && role.callable === revisionOrigin
    && role.marker && normalizeStructTag(role.marker.name) === `${revisionOrigin}::paid_access::PaidRevision1`, 'PAID_RECEIPT_ORIGINAL_PAID_ROLE')
  const originalPolicy = { proof: 'original-config-primary-gates-and-paid-role-types-only' as const, gates, paidRole: role,
    requiresOriginalNativeBindingAndGateFieldProof: true as const, notCurrentPolicy: true as const }
  const quote = quoteNativePaidContent({ root: soulId, protocol: a.protocol, kind: p.kind, offer, feeRevision: cfg.revision, primaryBps: cfg.primary_bps, platformRecipient: cfg.recipient })
  commerceCheck(toHex(quote.hash) === toHex(p.quote.hash) && quote.total === p.quote.total, 'PAID_RECEIPT_QUOTE')
  const key = { kind: p.kind, buyer: p.buyer }, entryId = deriveDynamicFieldID(a.entries.id, type(content.origins, 'paid_access', 'BuyerKey'), PaidContentBuyerKeyBcs.serialize(key).toBytes())
  const created = effects.V2.changedObjects.find(([id]) => id === entryId)?.[1].idOperation.$kind === 'Created'
  const entryType = `0x2::dynamic_field::Field<${type(content.origins, 'paid_access', 'BuyerKey')},${type(content.origins, 'paid_access', 'Entry')}>`
  const output = await read(entryId, entryType, created ? 'created' : 'mutated'), entry = decodeCommerce(NativePaidEntryFieldBcs, output.bytes)
  commerceCheck(output.object.owner.ObjectOwner === a.entries.id && entry.id === entryId && entry.name.kind === p.kind && entry.name.buyer === p.buyer, 'PAID_RECEIPT_ENTRY_KEY')
  let old: ReturnType<typeof PaidContentEntryBcs.parse> | null = null
  if (!created) {
    const previous = await read(entryId, entryType, 'input'), field = decodeCommerce(NativePaidEntryFieldBcs, previous.bytes)
    commerceCheck(previous.object.owner.ObjectOwner === a.entries.id && field.id === entryId && publicMutationCanonical(field.name) === publicMutationCanonical(key)
      && p.entryHash !== null && toHex(sha256(PaidContentEntryBcs.serialize(field.value).toBytes())) === toHex(p.entryHash), 'PAID_RECEIPT_PREVIOUS_ENTRY')
    old = field.value
    commerceCheck(BigInt(old.revision) <= BigInt(a.revision), 'PAID_RECEIPT_PREVIOUS_REVISION')
  } else commerceCheck(p.entryHash === null, 'PAID_RECEIPT_NEW_ENTRY')
  const clockObject = await read(`0x${'6'.padStart(64, '0')}`, '0x2::clock::Clock', 'readonly'), clock = decodeCommerce(Clock, clockObject.bytes)
  commerceCheck(clockObject.object.owner.Shared?.initialSharedVersion === '1', 'PAID_RECEIPT_CLOCK')
  let base = BigInt(clock.timestamp_ms)
  if (old && old.issuer === offer.issuer && old.generation === offer.generation) {
    commerceCheck(old.expiry !== null, 'PAID_RECEIPT_PERMANENT_RENEWAL'); base = BigInt(old.expiry) > base ? BigInt(old.expiry) : base
  }
  const expiry = offer.duration === null ? null : String(base + BigInt(offer.duration))
  commerceCheck(offer.issuer !== p.buyer && BigInt(offer.scope) > 0n && (offer.duration === null || BigInt(offer.duration) > 0n)
    && BigInt(clock.timestamp_ms) <= BigInt(p.quoteExpiryMs) && (expiry === null || BigInt(expiry) <= (1n << 64n) - 1n)
    && publicMutationCanonical(entry.value) === publicMutationCanonical({ issuer: offer.issuer, generation: offer.generation, scope: offer.scope, expiry, revision: String(BigInt(a.revision) + 1n) }), 'PAID_RECEIPT_ENTRY_TRANSITION')
  commerceCheck(publicMutationCanonical(z) === publicMutationCanonical({ ...a, revision: String(BigInt(a.revision) + 1n), entries: { ...a.entries, size: String(BigInt(a.entries.size) + (created ? 1n : 0n)) }, attempts: { ...a.attempts, size: String(BigInt(a.attempts.size) + 1n) } }), 'PAID_RECEIPT_LEDGER_TRANSITION')
  const attempt = { buyer: p.buyer, attempt: p.attempt }, attemptId = deriveDynamicFieldID(a.attempts.id, type(content.origins, 'paid_access', 'AttemptKey'), NativePaidAttemptKeyBcs.serialize(attempt).toBytes())
  const attemptObject = await read(attemptId, `0x2::dynamic_field::Field<${type(content.origins, 'paid_access', 'AttemptKey')},${type(content.origins, 'paid_access', 'Receipt')}>`, 'created'), receipt = decodeCommerce(NativePaidAttemptFieldBcs, attemptObject.bytes)
  const entryHash = sha256(PaidContentEntryBcs.serialize(entry.value).toBytes())
  commerceCheck(attemptObject.object.owner.ObjectOwner === a.attempts.id && receipt.id === attemptId && receipt.name.buyer === p.buyer && toHex(receipt.name.attempt) === toHex(p.attempt)
    && publicMutationCanonical(receipt.value) === publicMutationCanonical({ kind: p.kind, quote: p.quote.hash, entry_hash: entryHash, price: quote.ask, total: quote.total, platform_fee: quote.platformFee, fee_revision: cfg.revision, platform_recipient: cfg.recipient, beneficiary: offer.issuer }), 'PAID_RECEIPT_ATTEMPT')
  return { proof: 'native-paid-original-attempt-entry-ledger-only' as const, transactionDigest: packet.digest, soulId, stateId, ledgerId, entry: entry.value,
    receipt: receipt.value, originalPolicy, claimedEffectIds: [ledgerId, entryId, attemptId], requiresOriginalFinalityAndEvents: true as const,
    requiresOriginalServiceStateAndOfferProof: true as const, notMoneySettlementProof: true as const, notContentDeliveryProof: true as const, notCurrentAuthority: true as const }
}
