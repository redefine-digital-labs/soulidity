import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, normalizeStructTag, fromBase64 } from '@mysten/sui/utils'
import type { PublicMutationPacket } from '../../sui/public-mutation-journal'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import { readHistoricalChildThroughParent } from '../../sui/historical-parent-lineage'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { NativeTransferPolicyBcs, NativeMarketRuleFieldBcs } from './native-sale-conditions'
import { commerceCheck, decodeCommerce } from './economics-read'

/** Original readonly Native transfer rule. Parent proves original graph,
 * Offer, Config and finality. Additional rules may permit listing, but this
 * product's exact purchase graph supplies only the Native rule receipt.
 */
export async function proveHistoricalSaleTransferPolicy(input: {
  client: SuiGrpcClient; effects: Parameters<typeof readHistoricalMoveObject>[0]['effects'];
  transactionDigest: string; checkpoint: string; packet: Pick<PublicMutationPacket, 'bytes' | 'digest'>;
  policyId: string; configId: string; coinType: string; native: PinnedMovePackage; standard: PinnedMovePackage; signal: AbortSignal
}) {
  const { client, signal, transactionDigest, checkpoint, policyId, configId } = input
  const effects = structuredClone(input.effects), packet = structuredClone(input.packet), coinType = normalizeStructTag(input.coinType), e = effects.V2
  commerceCheck(e?.status.$kind === 'Success' && e.transactionDigest === transactionDigest && packet.digest === transactionDigest, 'TRANSFER_POLICY_CONTEXT')
  const native = await readPinnedMovePackage(client, input.native, signal), standard = await readPinnedMovePackage(client, input.standard, signal)
  const link = native.linkage.get(standard.pin.originalPackageId)
  commerceCheck(link?.upgradedId === standard.pin.callablePackageId && link.upgradedVersion === String(standard.version), 'TRANSFER_POLICY_STANDARD_LINK')
  const type = (origins: Map<string, string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin, 'TRANSFER_POLICY_ORIGIN'); return `${origin}::${module}::${name}` }
  const read = (objectId: string, type: string, mode: 'readonly') => readHistoricalMoveObject({ client, effects, transactionDigest, objectId, type, mode, signal, maxBytes: 256 * 1024 })
  const rule = type(native.origins, 'market', 'Rule'), policyType = `0x2::transfer_policy::TransferPolicy<${type(standard.origins, 'soul', 'Soul')}>`
  const policyObject = await read(policyId, policyType, 'readonly'), policy = decodeCommerce(NativeTransferPolicyBcs, policyObject.bytes)
  const refs = Transaction.from(fromBase64(packet.bytes)).getData().inputs.flatMap(i => i.Object?.SharedObject ? [i.Object.SharedObject] : []).filter(r => r.objectId === policyId)
  commerceCheck(refs.length === 1 && !refs[0].mutable && policyObject.object.owner.Shared?.initialSharedVersion === String(refs[0].initialSharedVersion), 'LIST_POLICY_SHARED_REFERENCE')
  const ruleNames = policy.rules.contents.map(r => normalizeStructTag(r.name))
  commerceCheck(policy.id === policyId && ruleNames.length <= 64 && new Set(ruleNames).size === ruleNames.length
    && ruleNames.includes(rule), 'LIST_POLICY_TRANSFER_RULES')
  const keyType = `0x2::transfer_policy::RuleKey<${rule}>`, ruleId = deriveDynamicFieldID(policyId, keyType, moveEmptyStructBytes())
  commerceCheck(!e.changedObjects.some(([id]) => id === ruleId), 'LIST_POLICY_READONLY_RULE_CHANGED')
  const proof = await readHistoricalChildThroughParent({ client, anchorEffects: effects, anchorTransactionDigest: transactionDigest,
    anchorCheckpoint: checkpoint, anchorMode: 'readonly', rootId: policyId, rootType: policyType, parentUid: policyId,
    childId: ruleId, childType: `0x2::dynamic_field::Field<${keyType},${type(native.origins, 'market', 'RuleConfig')}>`,
    chainIdentifier: '35834a8a', genesisDigest: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S', signal,
    assertContainsParent: bytes => {
      const p = decodeCommerce(NativeTransferPolicyBcs, bytes)
      commerceCheck(p.id === policyId && p.rules.contents.some(r => normalizeStructTag(r.name) === rule), 'LIST_POLICY_ANCESTOR_ROOT')
    } })
  const field = decodeCommerce(NativeMarketRuleFieldBcs, proof.bytes)
  commerceCheck(field.id === ruleId && field.name.dummy_field === false && field.value.config === configId
    && normalizeStructTag(field.value.currency.name) === coinType, 'LIST_POLICY_RULE_CONFIG')
  const additionalRules = ruleNames.filter(name => name !== rule)
  return { proof: 'original-native-transfer-policy-rule-only' as const, transactionDigest, policyId, ruleId, additionalRules,
    ruleHistory: { writerTransactionDigest: proof.writerTransactionDigest, trail: proof.trail }, notCurrentAuthority: true as const }
}
