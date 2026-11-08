import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toBase64, toHex } from '@mysten/sui/utils'
import { readHistoricalMoveObject } from '../sui/historical-object'
import { readHistoricalChildThroughParent } from '../sui/historical-parent-lineage'
import { readPinnedMovePackage } from '../sui/pinned-move-package'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../sui/move-empty-struct'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import { EconomicsConfigBcs } from './commerce/economics-bcs'
import { CanonicalNativeStateBcs, parseCanonicalNativeWorkbenchTarget, type CanonicalNativeWorkbenchTarget } from './canonical-native-workbench'
import { parseNativeCreationIntent, type NativeCreationIntent } from './native-creation-transaction'
import { readNativeMintConfigPolicy } from './native-mint-config-policy'

const A = bcs.Address
export const NativeSourceRevisionBcs = bcs.struct('Revision', { original: A, callable: A,
  marker: bcs.struct('TypeName', { name: bcs.string() }), version: bcs.u64() })
export const NativeSourceRegistryFieldBcs = bcs.struct('SourceRegistryField', { id: A, name: MoveEmptyStructBcs,
  value: bcs.struct('SourceRegistryLocation', { id: A }) })
export const NativeSourceRevisionFieldBcs = bcs.struct('SourceRevisionField', { id: A, name: MoveEmptyStructBcs, value: NativeSourceRevisionBcs })

/** Independent historical source slots. Recomputes Config/link proof itself;
 * a saved DTO is never a permission token. Exact original Config root ancestry
 * proves the two unchanged fields, not today's registry/revision. Native State
 * issuer is read from its created full Object BCS and must match actual source
 * slot + current introducing marker + immutable package version.
 * Actual Native catalog and executed code qualification remain parent duties. */
export async function readNativeMintSourceSlots(input: {
  client: SuiGrpcClient; effects: ReturnType<typeof bcs.TransactionEffects.parse>; transactionDigest: string
  checkpoint: string; intent: NativeCreationIntent; target: CanonicalNativeWorkbenchTarget
  soulId: string; stateId: string; signal: AbortSignal
}) {
  const target = parseCanonicalNativeWorkbenchTarget(input.target), intent = parseNativeCreationIntent(input.intent)
  const effects = structuredClone(input.effects), { client, transactionDigest, checkpoint, soulId, stateId } = input
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  function check(v: unknown, code: string): asserts v { if (!v) throw Error(`NATIVE_SOURCE_SLOTS_${code}`) }
  const policy = await readNativeMintConfigPolicy({ client, effects, transactionDigest, intent, target, signal })
  const [foundation, native] = await Promise.all([readPinnedMovePackage(client, policy.foundation, signal), readPinnedMovePackage(client, target.native, signal)])
  function type(origins: Map<string, string>, module: string, name: string) {
    const origin = origins.get(`${module}::${name}`); check(origin, 'TYPE_ORIGIN'); return `${origin}::${module}::${name}`
  }
  const configType = `${type(foundation.origins, 'economics', 'Config')}<${normalizeStructTag(intent.target.paymentCoinType)}>`
  const registryType = type(native.origins, 'registry', 'Registry'), revisionType = type(foundation.origins, 'source_authority', 'Revision')
  const marker = type(native.origins, 'registry', 'SourceRevision2')
  check(native.origins.get('registry::SoulProducer') === target.native.originalPackageId
    && native.origins.get('registry::Registry') === target.native.originalPackageId
    && native.origins.get('registry::SourceRevision2') === target.native.callablePackageId, 'PROTECTED_SOURCE_IDENTITY')
  const state = await readHistoricalMoveObject({ client, effects, transactionDigest, objectId: stateId,
    type: type(native.origins, 'birth', 'State'), mode: 'created', signal, maxBytes: 256 * 1024 })
  const value = CanonicalNativeStateBcs.parse(state.bytes)
  check(value.id === stateId && value.root === soulId && value.protocol === target.configId && value.registry === target.registryId
    && value.creator === intent.author && value.content === intent.expectedContentId && toHex(value.mint_nonce) === intent.mintNonce
    && toBase64(CanonicalNativeStateBcs.serialize(value).toBytes()) === toBase64(state.bytes), 'STATE_BINDING')
  const result = []
  for (const [keyName, valueType] of [['SourceRegistryKey', type(foundation.origins, 'economics', 'SourceRegistryLocation')],
    ['SourceRevisionKey', revisionType]] as const) {
    const key = `${type(foundation.origins, 'economics', keyName)}<${registryType}>`
    const fieldId = deriveDynamicFieldID(target.configId, key, moveEmptyStructBytes())
    const proof = await readHistoricalChildThroughParent({ client, anchorEffects: effects, anchorTransactionDigest: transactionDigest,
      anchorMode: 'readonly', anchorCheckpoint: checkpoint, rootId: target.configId, rootType: configType, parentUid: target.configId,
      childId: fieldId, childType: `0x2::dynamic_field::Field<${key},${valueType}>`, chainIdentifier: target.chainIdentifier,
      genesisDigest: MAINNET_GENESIS_DIGEST, signal,
      assertContainsParent: bytes => {
        const c = EconomicsConfigBcs.parse(bytes)
        check(c.id === target.configId && c.schema === 3 && c.original_package === policy.foundation.originalPackageId
          && normalizeStructTag(c.payment_coin.name) === normalizeStructTag(intent.target.paymentCoinType)
          && toBase64(EconomicsConfigBcs.serialize(c).toBytes()) === toBase64(bytes), 'CONFIG_ROOT_BINDING')
      } })
    if (keyName === 'SourceRegistryKey') {
      const field = NativeSourceRegistryFieldBcs.parse(proof.bytes)
      check(field.id === fieldId && field.name.dummy_field === false && field.value.id === target.registryId
        && toBase64(NativeSourceRegistryFieldBcs.serialize(field).toBytes()) === toBase64(proof.bytes), 'REGISTRY_LOCATION')
    } else {
      const field = NativeSourceRevisionFieldBcs.parse(proof.bytes), r = field.value
      check(field.id === fieldId && field.name.dummy_field === false && r.original === target.native.originalPackageId
        && r.callable === target.native.callablePackageId && r.marker.name === marker.slice(2) && BigInt(r.version) === native.version
        && toBase64(NativeSourceRevisionBcs.serialize(r).toBytes()) === toBase64(NativeSourceRevisionBcs.serialize(value.issuer).toBytes())
        && toBase64(NativeSourceRevisionFieldBcs.serialize(field).toBytes()) === toBase64(proof.bytes), 'SOURCE_REVISION')
    }
    result.push({ fieldId, keyName, writerTransactionDigest: proof.writerTransactionDigest, trail: proof.trail })
  }
  signal.throwIfAborted()
  return { proof: 'historical-native-config-source-slots-only' as const, transactionDigest, registryId: target.registryId,
    issuer: value.issuer, fields: result, requiresCatalogAndExecutedCodeProof: true as const,
    notCreationReceipt: true as const, notCurrentAuthority: true as const }
}
