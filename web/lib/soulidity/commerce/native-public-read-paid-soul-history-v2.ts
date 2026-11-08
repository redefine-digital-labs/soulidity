import { deriveKioskItemFieldId, assertKioskItemField, KIOSK_ITEM_FIELD_TYPE, SoulPublicKioskBcs } from '@soulidity/sdk'
import { normalizeStructTag, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { CanonicalSoulBcs } from '../canonical-native-workbench'
import { NativePublicReadHostV2Bcs, NativePublicReadLinkV2Bcs } from '../native-public-read-record-v2'
import { readHistoricalSharedOwnedBranchCandidate } from './historical-shared-owned-branch-candidate'
import { commerceCheck, commerceId, decodeCommerce } from './economics-read'
import { proveNativePublicReadPaidReceiptV2 } from './native-public-read-paid-receipt-v2'

/** Actual original Standard Soul below Kiosk -> typed Item -> Soul, plus
 * original descriptor's cryptographic commitment to supplied exact Link BCS.
 * Link bytes are a preimage, NOT an authenticated original Link Object/ref.
 * Original ModuleKey pointer and Link ownership still require separate proof.
 */
export async function proveNativePublicReadPaidSoulHistoryV2(input: Parameters<typeof proveNativePublicReadPaidReceiptV2>[0] & {
  checkpoint: string; standard: PinnedMovePackage; linkBytes: Uint8Array
}) {
  const saved = structuredClone({ intent: input.intent, packet: input.packet, gas: input.gas, effects: input.effects, offer: input.offer,
    soulId: input.soulId, ledgerId: input.ledgerId, native: input.native, content: input.content, foundation: input.foundation,
    checkpoint: input.checkpoint, standard: input.standard, linkBytes: input.linkBytes })
  const { signal } = input, p = saved.intent, source = input.client.ledgerService
  const client = { ledgerService: { getServiceInfo: source.getServiceInfo.bind(source), getTransaction: source.getTransaction.bind(source),
    getCheckpoint: source.getCheckpoint.bind(source), getObject: source.getObject.bind(source) } } as unknown as typeof input.client
  commerceCheck(saved.linkBytes instanceof Uint8Array && saved.linkBytes.length === 96, 'PUBLIC_PAID_V2_SOUL_LINK_BYTES')
  const receipt = await proveNativePublicReadPaidReceiptV2({ ...saved, client, signal })
  const native = await readPinnedMovePackage(client, saved.native, signal), standard = await readPinnedMovePackage(client, saved.standard, signal)
  const dependency = native.linkage.get(standard.pin.originalPackageId)
  commerceCheck(dependency?.upgradedId === standard.pin.callablePackageId && dependency.upgradedVersion === String(standard.version), 'PUBLIC_PAID_V2_SOUL_STANDARD_LINK')
  const type = (origins: Map<string,string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin, 'PUBLIC_PAID_V2_SOUL_ORIGIN'); return `${origin}::${module}::${name}` }
  const witness = type(native.origins,'birth','NativeModule'), linkType = type(native.origins,'birth','PublicReadLinkV2')
  commerceCheck(witness.split('::')[0] === linkType.split('::')[0], 'PUBLIC_PAID_V2_SOUL_COLOCATED_LINK')
  const link = decodeCommerce(NativePublicReadLinkV2Bcs,saved.linkBytes)
  commerceCheck(commerceId(link.id) && link.root === saved.soulId && link.host === receipt.hostId
    && ![saved.soulId, receipt.hostId, receipt.stateId, saved.ledgerId, p.config.objectId, p.registry.objectId, p.kiosk.objectId,
      p.paymentCoin.objectId].includes(link.id), 'PUBLIC_PAID_V2_SOUL_LINK_PREIMAGE')
  const hostObject = await readHistoricalMoveObject({ client, effects: saved.effects, transactionDigest: saved.packet.digest,
    objectId: receipt.hostId, type: type(native.origins,'birth','PublicReadHostV2'), mode: 'input', signal })
  const host = decodeCommerce(NativePublicReadHostV2Bcs,hostObject.bytes)
  const itemId = deriveKioskItemFieldId(p.kiosk.objectId,saved.soulId)
  const history = await readHistoricalSharedOwnedBranchCandidate({ client, anchorEffects: saved.effects, anchorTransactionDigest: saved.packet.digest,
    anchorCheckpoint: saved.checkpoint, anchorMode: 'readonly', rootId: p.kiosk.objectId, rootType: '0x2::kiosk::Kiosk',
    rootParentUid: p.kiosk.objectId, branchId: itemId, branchType: KIOSK_ITEM_FIELD_TYPE, targetId: saved.soulId,
    targetType: type(standard.origins,'soul','Soul'), chainIdentifier: '35834a8a', genesisDigest: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S', signal,
    assertContainsParent: (bytes,uid) => { commerceCheck(decodeCommerce(SoulPublicKioskBcs,bytes).id === uid, 'PUBLIC_PAID_V2_SOUL_KIOSK') },
    assertBranch: (bytes,targetId) => { commerceCheck(assertKioskItemField(bytes,p.kiosk.objectId,targetId) === itemId, 'PUBLIC_PAID_V2_SOUL_ITEM') },
    assertTarget: bytes => { const soul = decodeCommerce(CanonicalSoulBcs,bytes)
      commerceCheck(soul.id === saved.soulId && soul.schema === 1 && !soul.editing && soul.modules.length <= 64
        && soul.origin.source === p.registry.objectId && soul.origin.minted_by === host.state.creator
        && soul.origin.source_hash.length === 32 && BigInt(soul.origin.source_version) > 0n
        && normalizeStructTag(soul.origin.source_type.name) === type(native.origins,'registry','Registry')
        && normalizeStructTag(soul.origin.producer.name) === type(native.origins,'registry','SoulProducer'), 'PUBLIC_PAID_V2_SOUL_VALUE')
      const descriptors = soul.modules.filter(d => normalizeStructTag(d.namespace.name) === witness && toHex(d.name) === '6e6174697665')
      commerceCheck(descriptors.length === 1, 'PUBLIC_PAID_V2_SOUL_DESCRIPTOR_COUNT')
      const d = descriptors[0]
      commerceCheck(d.object === link.id && d.schema === 2 && !d.removable && normalizeStructTag(d.value_type.name) === linkType
        && toHex(d.body_hash) === toHex(sha3_256(saved.linkBytes)) && toHex(d.semantic_hash) === toHex(sha256(saved.linkBytes)), 'PUBLIC_PAID_V2_SOUL_DESCRIPTOR')
    } })
  const soul = decodeCommerce(CanonicalSoulBcs,history.bytes)
  return { format: 'native-public-read-v2' as const, proof: 'original-soul-type-item-owner-and-link-commitment-candidate-only' as const,
    transactionDigest: saved.packet.digest, soulId: soul.id, soulRevision: soul.revision, kioskId: p.kiosk.objectId, itemFieldId: itemId,
    linkId: link.id, hostId: link.host, reference: history.reference, writerCheckpoint: history.trail[history.trail.length - 1].checkpoint, writerTransactionDigest: history.writerTransactionDigest, trail: history.trail, itemTrail: history.branchTrail,
    requiresOriginalModulePointerAndLinkOwnershipProof: true as const, requiresQualifiedKioskParentCommitInvariant: true as const,
    requiresSharedHelperIndependentReview: true as const, requiresOriginalSourceQualification: true as const,
    notCurrentCustody: true as const, notContentDeliveryProof: true as const }
}
