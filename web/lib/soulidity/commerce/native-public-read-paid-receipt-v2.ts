import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { SoulPublicKioskBcs } from '@soulidity/sdk'
import { NativePublicReadHostV2Bcs } from '../native-public-read-record-v2'
import { sha256 } from '@noble/hashes/sha2.js'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { publicMutationCanonical, type PublicMutationPacket } from '../../sui/public-mutation-journal'
import { NativeInitialPaidBcs } from '../native-initial-children'
import { EconomicsConfigBcs, recoverEconomicsHistoricalGates } from './economics-bcs'
import { commerceCheck, commerceId, decodeCommerce } from './economics-read'
import { PaidContentOfferBcs, PaidContentEntryBcs, PaidContentBuyerKeyBcs, quoteNativePaidContent } from './paid-content-policy'
import type { NativePublicReadPaidPurchaseV2 } from './native-public-read-paid-transaction-v2'
import type { NativePaidReviewedGas } from './native-paid-content-packet'
import { assertNativePublicReadPaidPacketV2 } from './native-public-read-paid-packet-v2'
import { NativePaidAttemptKeyBcs, NativePaidAttemptFieldBcs, NativePaidEntryFieldBcs } from './native-paid-content-receipt'
const Clock = bcs.struct('Clock', { id: bcs.Address, timestamp_ms: bcs.u64() })

/** Original HostV2/paid Ledger/Entry/Attempt subproof after parent finality.
 * State is embedded in the original Shared Host, never a standalone v1 input.
 * Shared Content BCS codecs are reused only; no v1 reader/composer is invoked.
 * Parent still owes original Link/custody/Auth generation/Paid pointer/Offer,
 * frozen source qualification, finality/events, actual money and usable delivery.
 */
export async function proveNativePublicReadPaidReceiptV2(input: { client: SuiGrpcClient; intent: NativePublicReadPaidPurchaseV2;
  packet: Pick<PublicMutationPacket, 'bytes' | 'digest' | 'expirationEpoch'>; gas: NativePaidReviewedGas;
  effects: Parameters<typeof readHistoricalMoveObject>[0]['effects']; offer: ReturnType<typeof PaidContentOfferBcs.parse>;
  soulId: string; ledgerId: string; native: PinnedMovePackage; content: PinnedMovePackage; foundation: PinnedMovePackage; signal: AbortSignal }) {
  const p = structuredClone(input.intent), packet = structuredClone(input.packet), effects = structuredClone(input.effects), offer = structuredClone(input.offer)
  const { signal, soulId, ledgerId } = input, nativePin = structuredClone(input.native), contentPin = structuredClone(input.content), foundationPin = structuredClone(input.foundation)
  const ledgerSource = input.client.ledgerService
  const client = { ledgerService: { getObject: ledgerSource.getObject.bind(ledgerSource) } } as unknown as typeof input.client
  await assertNativePublicReadPaidPacketV2(p, packet, input.gas)
  commerceCheck(effects.V2?.status.$kind === 'Success' && effects.V2.transactionDigest === packet.digest && effects.V2.changedObjects.length <= 4096
    && new Set(effects.V2.changedObjects.map(([id]) => id)).size === effects.V2.changedObjects.length, 'PUBLIC_PAID_V2_RECEIPT_CONTEXT')
  const native = await readPinnedMovePackage(client, nativePin, signal), content = await readPinnedMovePackage(client, contentPin, signal), foundation = await readPinnedMovePackage(client, foundationPin, signal)
  commerceCheck(native.pin.callablePackageId === p.nativeCallablePackageId, 'PUBLIC_PAID_V2_RECEIPT_CALLABLE')
  for (const [from, pkg] of [[native, content], [native, foundation], [content, foundation]] as const) { const link = from.linkage.get(pkg.pin.originalPackageId)
    commerceCheck(link?.upgradedId === pkg.pin.callablePackageId && link.upgradedVersion === String(pkg.version), 'PUBLIC_PAID_V2_RECEIPT_LINK') }
  const type = (origins: Map<string, string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin, 'PUBLIC_PAID_V2_RECEIPT_ORIGIN'); return `${origin}::${module}::${name}` }
  const read = (id: string, type: string, mode: 'input' | 'mutated' | 'created' | 'readonly') => readHistoricalMoveObject({ client, effects, transactionDigest: packet.digest, objectId: id, type, mode, signal })
  const hostType = type(native.origins, 'birth', 'PublicReadHostV2')
  type(native.origins, 'birth', 'PublicReadLinkV2')
  const hostBefore = await read(p.host.objectId, hostType, 'input'), hostAfter = await read(p.host.objectId, hostType, 'mutated')
  const host = decodeCommerce(NativePublicReadHostV2Bcs, hostBefore.bytes), stateId = host.state.id
  commerceCheck(hostBefore.object.owner.Shared?.initialSharedVersion === p.host.initialSharedVersion
    && hostAfter.object.owner.Shared?.initialSharedVersion === p.host.initialSharedVersion && host.id === p.host.objectId
    && host.root === soulId && host.state.root === soulId && host.state.protocol === p.config.objectId && host.state.registry === p.registry.objectId
    && host.state.schema === 1 && host.state.issuer.original === native.pin.originalPackageId
    && toHex(hostBefore.bytes) === toHex(hostAfter.bytes)
    && !effects.V2!.changedObjects.some(([id]) => id === stateId), 'PUBLIC_PAID_V2_RECEIPT_HOST')
  const kioskObject = await read(p.kiosk.objectId, '0x2::kiosk::Kiosk', 'readonly'), kiosk = decodeCommerce(SoulPublicKioskBcs, kioskObject.bytes)
  commerceCheck(kioskObject.object.owner.Shared?.initialSharedVersion === p.kiosk.initialSharedVersion && kiosk.id === p.kiosk.objectId
    && kiosk.item_count > 0 && kiosk.owner === offer.issuer, 'PUBLIC_PAID_V2_RECEIPT_KIOSK')
  const roleIds = [soulId, p.host.objectId, stateId, ledgerId, p.config.objectId, p.registry.objectId, p.kiosk.objectId, p.paymentCoin.objectId, `0x${'6'.padStart(64, '0')}`]
  commerceCheck(roleIds.every(commerceId) && new Set(roleIds).size === roleIds.length, 'PUBLIC_PAID_V2_RECEIPT_ROLES')
  const ledgerType = type(content.origins, 'paid_access', 'Ledger'), beforeObject = await read(ledgerId, ledgerType, 'input'), afterObject = await read(ledgerId, ledgerType, 'mutated')
  const a = decodeCommerce(NativeInitialPaidBcs, beforeObject.bytes), z = decodeCommerce(NativeInitialPaidBcs, afterObject.bytes)
  const tableIds = [a.offers.id, a.entries.id, a.attempts.id]
  commerceCheck(tableIds.every(commerceId) && new Set([...roleIds, ...tableIds]).size === roleIds.length + tableIds.length, 'PUBLIC_PAID_V2_RECEIPT_TABLE_ROLES')
  const paidKey = `0x2::dynamic_object_field::Wrapper<${type(native.origins, 'birth', 'PaidKey')}>`, paidField = deriveDynamicFieldID(stateId, paidKey, moveEmptyStructBytes())
  commerceCheck(a.id === ledgerId && a.root === soulId && a.protocol === p.config.objectId && a.controller.root === soulId && a.controller.parent === stateId
    && normalizeStructTag(a.controller.operator.name) === type(native.origins, 'birth', 'ContentOperator')
    && beforeObject.object.owner.ObjectOwner === paidField && afterObject.object.owner.ObjectOwner === paidField, 'PUBLIC_PAID_V2_RECEIPT_LEDGER_BINDING')
  const cfgObject = await read(p.config.objectId, `${type(foundation.origins, 'economics', 'Config')}<${normalizeStructTag(p.coinType)}>`, 'input')
  const cfg = decodeCommerce(EconomicsConfigBcs, cfgObject.bytes)
  commerceCheck(cfgObject.object.owner.Shared?.initialSharedVersion === p.config.initialSharedVersion
    && cfg.id === a.protocol && cfg.income.root === cfg.id && cfg.revision === p.feeRevision && cfg.schema === 3
    && cfg.original_package === foundation.pin.originalPackageId && cfg.callable_package === foundation.pin.callablePackageId
    && normalizeStructTag(cfg.payment_coin.name) === normalizeStructTag(p.coinType), 'PUBLIC_PAID_V2_RECEIPT_CONFIG')
  const gates = recoverEconomicsHistoricalGates(cfg).gates
  commerceCheck(cfg.enabled && !cfg.paused && BigInt(cfg.minimum_release) <= 2n && gates.primary, 'PUBLIC_PAID_V2_RECEIPT_ORIGINAL_PRIMARY_POLICY')
  // Current frozen ABI calls PaidAuthority1/PaidRevision1. Defining Revision
  // identity can predate the callable package after a compatible upgrade.
  const role = cfg.roles.roles[5], authorityOrigin = content.origins.get('paid_access::PaidAuthority1'), revisionOrigin = content.origins.get('paid_access::PaidRevision1')
  commerceCheck(cfg.roles.roles.length === 6 && role?.pinned && authorityOrigin === content.pin.originalPackageId
    && revisionOrigin && role.original === authorityOrigin && role.callable === revisionOrigin
    && role.marker && normalizeStructTag(role.marker.name) === `${revisionOrigin}::paid_access::PaidRevision1`, 'PUBLIC_PAID_V2_RECEIPT_ORIGINAL_PAID_ROLE')
  const originalPolicy = { proof: 'original-config-primary-gates-and-paid-role-types-only' as const, gates, paidRole: role,
    requiresOriginalNativeBindingAndGateFieldProof: true as const, notCurrentPolicy: true as const }
  const quote = quoteNativePaidContent({ root: soulId, protocol: a.protocol, kind: p.kind, offer, feeRevision: cfg.revision, primaryBps: cfg.primary_bps, platformRecipient: cfg.recipient })
  commerceCheck(BigInt(offer.revision) <= BigInt(a.revision) && toHex(quote.hash) === toHex(p.quote.hash) && quote.total === p.quote.total, 'PUBLIC_PAID_V2_RECEIPT_QUOTE')
  const key = { kind: p.kind, buyer: p.buyer }, entryId = deriveDynamicFieldID(a.entries.id, type(content.origins, 'paid_access', 'BuyerKey'), PaidContentBuyerKeyBcs.serialize(key).toBytes())
  const created = effects.V2.changedObjects.find(([id]) => id === entryId)?.[1].idOperation.$kind === 'Created'
  const entryType = `0x2::dynamic_field::Field<${type(content.origins, 'paid_access', 'BuyerKey')},${type(content.origins, 'paid_access', 'Entry')}>`
  const output = await read(entryId, entryType, created ? 'created' : 'mutated'), entry = decodeCommerce(NativePaidEntryFieldBcs, output.bytes)
  commerceCheck(output.object.owner.ObjectOwner === a.entries.id && entry.id === entryId && entry.name.kind === p.kind && entry.name.buyer === p.buyer, 'PUBLIC_PAID_V2_RECEIPT_ENTRY_KEY')
  let old: ReturnType<typeof PaidContentEntryBcs.parse> | null = null
  if (!created) {
    const previous = await read(entryId, entryType, 'input'), field = decodeCommerce(NativePaidEntryFieldBcs, previous.bytes)
    commerceCheck(previous.object.owner.ObjectOwner === a.entries.id && field.id === entryId && publicMutationCanonical(field.name) === publicMutationCanonical(key)
      && p.entryHash !== null && toHex(sha256(PaidContentEntryBcs.serialize(field.value).toBytes())) === toHex(p.entryHash), 'PUBLIC_PAID_V2_RECEIPT_PREVIOUS_ENTRY')
    old = field.value
    commerceCheck(BigInt(old.revision) <= BigInt(a.revision), 'PUBLIC_PAID_V2_RECEIPT_PREVIOUS_REVISION')
  } else commerceCheck(p.entryHash === null, 'PUBLIC_PAID_V2_RECEIPT_NEW_ENTRY')
  const clockObject = await read(`0x${'6'.padStart(64, '0')}`, '0x2::clock::Clock', 'readonly'), clock = decodeCommerce(Clock, clockObject.bytes)
  commerceCheck(clockObject.object.owner.Shared?.initialSharedVersion === '1', 'PUBLIC_PAID_V2_RECEIPT_CLOCK')
  let base = BigInt(clock.timestamp_ms)
  if (old && old.issuer === offer.issuer && old.generation === offer.generation) {
    commerceCheck(old.expiry !== null, 'PUBLIC_PAID_V2_RECEIPT_PERMANENT_RENEWAL'); base = BigInt(old.expiry) > base ? BigInt(old.expiry) : base
  }
  const expiry = offer.duration === null ? null : String(base + BigInt(offer.duration))
  commerceCheck(offer.issuer !== p.buyer && BigInt(offer.scope) > 0n && (offer.duration === null || BigInt(offer.duration) > 0n)
    && BigInt(clock.timestamp_ms) <= BigInt(p.quoteExpiryMs) && (expiry === null || BigInt(expiry) <= (1n << 64n) - 1n)
    && publicMutationCanonical(entry.value) === publicMutationCanonical({ issuer: offer.issuer, generation: offer.generation, scope: offer.scope, expiry, revision: String(BigInt(a.revision) + 1n) }), 'PUBLIC_PAID_V2_RECEIPT_ENTRY_TRANSITION')
  commerceCheck(publicMutationCanonical(z) === publicMutationCanonical({ ...a, revision: String(BigInt(a.revision) + 1n), entries: { ...a.entries, size: String(BigInt(a.entries.size) + (created ? 1n : 0n)) }, attempts: { ...a.attempts, size: String(BigInt(a.attempts.size) + 1n) } }), 'PUBLIC_PAID_V2_RECEIPT_LEDGER_TRANSITION')
  const attempt = { buyer: p.buyer, attempt: p.attempt }, attemptId = deriveDynamicFieldID(a.attempts.id, type(content.origins, 'paid_access', 'AttemptKey'), NativePaidAttemptKeyBcs.serialize(attempt).toBytes())
  const attemptObject = await read(attemptId, `0x2::dynamic_field::Field<${type(content.origins, 'paid_access', 'AttemptKey')},${type(content.origins, 'paid_access', 'Receipt')}>`, 'created'), receipt = decodeCommerce(NativePaidAttemptFieldBcs, attemptObject.bytes)
  const entryHash = sha256(PaidContentEntryBcs.serialize(entry.value).toBytes())
  commerceCheck(attemptObject.object.owner.ObjectOwner === a.attempts.id && receipt.id === attemptId && receipt.name.buyer === p.buyer && toHex(receipt.name.attempt) === toHex(p.attempt)
    && publicMutationCanonical(receipt.value) === publicMutationCanonical({ kind: p.kind, quote: p.quote.hash, entry_hash: entryHash, price: quote.ask, total: quote.total, platform_fee: quote.platformFee, fee_revision: cfg.revision, platform_recipient: cfg.recipient, beneficiary: offer.issuer }), 'PUBLIC_PAID_V2_RECEIPT_ATTEMPT')
  return { format: 'native-public-read-v2' as const, proof: 'native-public-read-v2-original-host-entry-attempt-ledger-only' as const, transactionDigest: packet.digest, soulId, hostId: host.id, stateId, ledgerId, entry: entry.value,
    receipt: receipt.value, originalPolicy, claimedEffectIds: [host.id, ledgerId, entryId, attemptId], observedReadOnlyIds: [p.kiosk.objectId, `0x${'6'.padStart(64, '0')}`], requiresOriginalFinalityAndEvents: true as const,
    requiresOriginalHostLinkPaidPointerAuthAndOfferProof: true as const, requiresOriginalKioskItemAndLockProof: true as const, requiresQualifiedSourceAndFormatAdoption: true as const, notMoneySettlementProof: true as const, notContentDeliveryProof: true as const, notCurrentAuthority: true as const }
}
