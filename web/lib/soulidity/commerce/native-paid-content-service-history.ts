import { SoulPublicKioskBcs } from '@soulidity/sdk'
import { bcs } from '@mysten/sui/bcs'
import { normalizeStructTag, toHex } from '@mysten/sui/utils'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { commerceCheck, commerceId, decodeCommerce } from './economics-read'
import { NativePaidServiceBcs, NativePaidServiceBindingBcs } from './native-paid-service-read'
import { proveNativePaidContentReceipt } from './native-paid-content-receipt'

const Clock = bcs.struct('Clock', { id: bcs.Address, timestamp_ms: bcs.u64() })

/** Original Shared service input/output, not today's service or custody.
 * Domain parent must still prove original Soul/State/module/ledger tree,
 * Offer membership, source qualification and the service opening delegation.
 */
export async function proveNativePaidContentServiceHistory(input: Parameters<typeof proveNativePaidContentReceipt>[0] & {
  standard: PinnedMovePackage; custody: PinnedMovePackage }) {
  const saved = structuredClone({ intent: input.intent, packet: input.packet, gas: input.gas, effects: input.effects, offer: input.offer,
    soulId: input.soulId, stateId: input.stateId, ledgerId: input.ledgerId, native: input.native, content: input.content, foundation: input.foundation,
    standard: input.standard, custody: input.custody })
  const { client, signal } = input, p = saved.intent
  await proveNativePaidContentReceipt({ ...saved, client, signal })
  const native = await readPinnedMovePackage(client, saved.native, signal), standard = await readPinnedMovePackage(client, saved.standard, signal), custody = await readPinnedMovePackage(client, saved.custody, signal)
  for (const pkg of [standard, custody]) { const link = native.linkage.get(pkg.pin.originalPackageId)
    commerceCheck(link?.upgradedId === pkg.pin.callablePackageId && link.upgradedVersion === String(pkg.version), 'PAID_SERVICE_HISTORY_LINK') }
  const type = (origins: Map<string, string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin, 'PAID_SERVICE_HISTORY_ORIGIN'); return `${origin}::${module}::${name}` }
  const serviceType = `${type(standard.origins, 'soul', 'SourceService')}<${type(native.origins, 'birth', 'NativeModule')},${type(native.origins, 'birth', 'State')}>`
  const read = (id: string, type: string, mode: 'input' | 'mutated' | 'readonly') => readHistoricalMoveObject({ client, effects: saved.effects,
    transactionDigest: saved.packet.digest, objectId: id, type, mode, signal })
  const beforeObject = await read(p.service.objectId, serviceType, 'input'), afterObject = await read(p.service.objectId, serviceType, 'mutated')
  const before = decodeCommerce(NativePaidServiceBcs, beforeObject.bytes), after = decodeCommerce(NativePaidServiceBcs, afterObject.bytes)
  commerceCheck(beforeObject.object.owner.Shared?.initialSharedVersion === p.service.initialSharedVersion
    && afterObject.object.owner.Shared?.initialSharedVersion === p.service.initialSharedVersion
    && before.id === p.service.objectId && before.root === saved.soulId && before.value === saved.stateId
    && before.schema === 1 && toHex(before.name) === '6e6174697665' && before.revision === p.rootRevision && !before.busy
    && before.authority.owner === saved.offer.issuer && before.authority.kiosk === p.kiosk.objectId
    && before.authority.cap.for === p.kiosk.objectId && [0, 32].includes(before.authority.closed_digest.length)
    && normalizeStructTag(before.return_witness.name) === type(custody.origins, 'account', 'AccountServiceWitness'), 'PAID_SERVICE_HISTORY_BINDING')
  commerceCheck([before.account, before.authority.cap.id].every(commerceId)
    && new Set([before.id, before.root, before.value, saved.ledgerId, before.account, before.authority.cap.id, p.kiosk.objectId]).size === 7, 'PAID_SERVICE_HISTORY_ROLES')
  const binding = decodeCommerce(NativePaidServiceBindingBcs, before.binding)
  commerceCheck(publicMutationCanonical(binding) === publicMutationCanonical({ state: saved.stateId, ledger: saved.ledgerId,
    protocol: p.config.objectId, registry: p.registry.objectId, generation: saved.offer.generation }), 'PAID_SERVICE_HISTORY_LEDGER')
  const clockObject = await read(`0x${'6'.padStart(64, '0')}`, '0x2::clock::Clock', 'readonly'), clock = decodeCommerce(Clock, clockObject.bytes)
  commerceCheck(BigInt(clock.timestamp_ms) < BigInt(before.expires), 'PAID_SERVICE_HISTORY_EXPIRED')
  commerceCheck(publicMutationCanonical(after) === publicMutationCanonical({ ...before, revision: String(BigInt(before.revision) + 1n) }), 'PAID_SERVICE_HISTORY_TRANSITION')
  const kioskBefore = await read(p.kiosk.objectId, '0x2::kiosk::Kiosk', 'input'), kioskAfter = await read(p.kiosk.objectId, '0x2::kiosk::Kiosk', 'mutated')
  const kiosk = decodeCommerce(SoulPublicKioskBcs, kioskBefore.bytes), kioskOutput = decodeCommerce(SoulPublicKioskBcs, kioskAfter.bytes)
  commerceCheck(kioskBefore.object.owner.Shared?.initialSharedVersion === p.kiosk.initialSharedVersion
    && kioskAfter.object.owner.Shared?.initialSharedVersion === p.kiosk.initialSharedVersion
    && kiosk.id === p.kiosk.objectId && kiosk.owner === before.authority.owner && !kiosk.allow_extensions && kiosk.item_count > 0
    && publicMutationCanonical(kiosk) === publicMutationCanonical(kioskOutput), 'PAID_SERVICE_HISTORY_KIOSK')
  const kioskProof = { proof: 'original-paid-service-kiosk-body-unchanged-only' as const, kioskId: kiosk.id, owner: kiosk.owner, profits: kiosk.profits, itemCount: kiosk.item_count,
    requiresOriginalKioskItemAndLockProof: true as const, notCurrentCustody: true as const }
  return { proof: 'native-paid-original-shared-service-binding-transition-only' as const, transactionDigest: saved.packet.digest,
    serviceId: before.id, accountId: before.account, owner: before.authority.owner, kioskId: p.kiosk.objectId,
    soulId: saved.soulId, stateId: saved.stateId, ledgerId: saved.ledgerId, generation: binding.generation,
    beforeRevision: before.revision, afterRevision: after.revision, expiresAtMs: before.expires,
    kioskProof, claimedEffectIds: [before.id, p.kiosk.objectId], requiresOriginalSoulStateAndLedgerTreeProof: true as const,
    requiresOriginalOfferMembershipProof: true as const, requiresOriginalServiceOpeningDelegationProof: true as const,
    notContentDeliveryProof: true as const, notCurrentAuthority: true as const }
}
