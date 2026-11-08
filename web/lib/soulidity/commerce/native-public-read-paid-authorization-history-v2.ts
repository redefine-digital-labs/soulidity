import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, normalizeStructTag } from '@mysten/sui/utils'
import { readPinnedMovePackage } from '../../sui/pinned-move-package'
import { moveEmptyStructBytes, MoveEmptyStructBcs } from '../../sui/move-empty-struct'
import { NativePublicReadHostV2Bcs } from '../native-public-read-record-v2'
import { NativeInitialAuthorizationBcs } from '../native-initial-children'
import { readHistoricalSharedOwnedBranchCandidate } from './historical-shared-owned-branch-candidate'
import { commerceCheck, commerceId, decodeCommerce } from './economics-read'
import { proveNativePublicReadPaidReceiptV2 } from './native-public-read-paid-receipt-v2'
const Pointer = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: bcs.Address })

/** Original Auth generation via the explicit two-edge Host/State -> DOF ->
 * Authorization candidate. Source/root-commit and independent helper review
 * remain mandatory. Does not claim current grants, owner read or delivery.
 */
export async function proveNativePublicReadPaidAuthorizationHistoryV2(input: Parameters<typeof proveNativePublicReadPaidReceiptV2>[0] & { checkpoint: string; authorizationId: string }) {
  const saved = structuredClone({ intent: input.intent, packet: input.packet, gas: input.gas, effects: input.effects, offer: input.offer,
    soulId: input.soulId, ledgerId: input.ledgerId, native: input.native, content: input.content, foundation: input.foundation,
    checkpoint: input.checkpoint, authorizationId: input.authorizationId })
  const { signal } = input, p = saved.intent, source = input.client.ledgerService
  const client = { ledgerService: { getServiceInfo: source.getServiceInfo.bind(source), getTransaction: source.getTransaction.bind(source),
    getCheckpoint: source.getCheckpoint.bind(source), getObject: source.getObject.bind(source) } } as unknown as typeof input.client
  commerceCheck(commerceId(saved.authorizationId), 'PUBLIC_PAID_V2_AUTH_ID')
  const receipt = await proveNativePublicReadPaidReceiptV2({ ...saved, client, signal })
  const native = await readPinnedMovePackage(client, saved.native, signal), content = await readPinnedMovePackage(client, saved.content, signal)
  const type = (origins: Map<string,string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin, 'PUBLIC_PAID_V2_AUTH_ORIGIN'); return `${origin}::${module}::${name}` }
  const wrapped = `0x2::dynamic_object_field::Wrapper<${type(native.origins,'birth','AuthorizationKey')}>`
  const branchId = deriveDynamicFieldID(receipt.stateId, wrapped, moveEmptyStructBytes())
  commerceCheck(new Set([saved.authorizationId, branchId, receipt.hostId, receipt.stateId, saved.soulId, saved.ledgerId, p.config.objectId, p.registry.objectId,
    p.kiosk.objectId, p.paymentCoin.objectId]).size === 10, 'PUBLIC_PAID_V2_AUTH_ALIAS')
  const history = await readHistoricalSharedOwnedBranchCandidate({ client, anchorEffects: saved.effects, anchorTransactionDigest: saved.packet.digest,
    anchorCheckpoint: saved.checkpoint, anchorMode: 'input', rootId: receipt.hostId, rootType: type(native.origins,'birth','PublicReadHostV2'),
    rootParentUid: receipt.stateId, branchId, branchType: `0x2::dynamic_field::Field<${wrapped},0x2::object::ID>`, targetId: saved.authorizationId,
    targetType: type(content.origins,'authorization','Authorization'), chainIdentifier: '35834a8a', genesisDigest: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S', signal,
    assertContainsParent: (bytes, uid) => { const host = decodeCommerce(NativePublicReadHostV2Bcs,bytes)
      commerceCheck(host.id === receipt.hostId && host.root === saved.soulId && host.state.id === uid && host.state.root === saved.soulId
        && host.state.protocol === p.config.objectId && host.state.registry === p.registry.objectId && host.state.schema === 1
        && host.state.issuer.original === native.pin.originalPackageId, 'PUBLIC_PAID_V2_AUTH_HOST') },
    assertBranch: (bytes, targetId) => { const field = decodeCommerce(Pointer,bytes)
      commerceCheck(field.id === branchId && field.name.name.dummy_field === false && field.value === targetId, 'PUBLIC_PAID_V2_AUTH_POINTER') },
    assertTarget: bytes => { const auth = decodeCommerce(NativeInitialAuthorizationBcs,bytes)
      commerceCheck(auth.id === saved.authorizationId && auth.root === saved.soulId && auth.controller.root === saved.soulId
        && auth.controller.parent === receipt.stateId && normalizeStructTag(auth.controller.operator.name) === type(native.origins,'birth','ContentOperator')
        && auth.generation === saved.offer.generation && BigInt(auth.count) <= BigInt(auth.capacity)
        && BigInt(auth.grants.size) >= BigInt(auth.count) && commerceId(auth.grants.id), 'PUBLIC_PAID_V2_AUTH_VALUE') } })
  const auth = decodeCommerce(NativeInitialAuthorizationBcs,history.bytes)
  commerceCheck(![saved.authorizationId, branchId, receipt.hostId, receipt.stateId, saved.soulId, saved.ledgerId, p.config.objectId, p.registry.objectId,
    p.kiosk.objectId, p.paymentCoin.objectId].includes(auth.grants.id), 'PUBLIC_PAID_V2_AUTH_GRANTS_ALIAS')
  return { format: 'native-public-read-v2' as const, proof: 'original-auth-generation-through-host-typed-branch-candidate-only' as const,
    transactionDigest: saved.packet.digest, hostId: receipt.hostId, stateId: receipt.stateId, authorizationId: auth.id, generation: auth.generation,
    branchId, writerTransactionDigest: history.writerTransactionDigest, trail: history.trail, branchTrail: history.branchTrail,
    requiresQualifiedHostParentCommitInvariant: true as const, requiresSharedHelperIndependentReview: true as const,
    requiresOriginalSoulHostLinkAndCustodyProof: true as const, notCurrentAuthorization: true as const, notContentDeliveryProof: true as const }
}
