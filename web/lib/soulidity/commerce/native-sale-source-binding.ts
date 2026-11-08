import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, toHex } from '@mysten/sui/utils'
import { readPinnedMovePackage, type PinnedMovePackage } from '../../sui/pinned-move-package'
import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../sui/move-empty-struct'
import { CanonicalNativeStateBcs } from '../canonical-native-workbench'
import { commerceCheck, decodeCommerce, readCommerceObject, readEconomicsIncome, type EconomicsTarget } from './economics-read'
import { recoverEconomicsHistoricalGates } from './economics-bcs'
import { NativeSourceRevisionBcs, NativeSourceRevisionFieldBcs } from '../native-mint-source-slots'

export const NativeSaleRegistryBcs = bcs.struct('Registry', { id: bcs.Address, protocol: bcs.Address, schema: bcs.u16(),
  kiosks: bcs.struct('Table', { id: bcs.Address, size: bcs.u64() }) })
export const NativeSaleSourceLocationBcs = bcs.struct('Field', { id: bcs.Address, name: MoveEmptyStructBcs,
  value: bcs.struct('SourceRegistryLocation', { id: bcs.Address }) })

/** Exact birth::assert_sale_binding relation: original State root/protocol/
 * registry + actual Registry protocol + permanent typed Config directory.
 * Default resale mode adds no current issuer gate to already-issued assets.
 * Explicit service mode checks the current SourceRevision2 witness and issuer.
 * Parent must authenticate State's Standard module relationship and custody.
 */
export async function readNativeSaleSourceBinding(input: { client: SuiGrpcClient; economics: EconomicsTarget;
  native: PinnedMovePackage; registryId: string; soulId: string; stateId: string; requireCurrentIssuer?: boolean; signal: AbortSignal }) {
  const { client, registryId, soulId, stateId } = input, economics = structuredClone(input.economics), nativePin = structuredClone(input.native)
  const requireCurrentIssuer = input.requireCurrentIssuer === true
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(30000)])
  const income = await readEconomicsIncome({ client, target: economics, signal })
  const native = await readPinnedMovePackage(client, nativePin, signal), foundation = await readPinnedMovePackage(client, economics.foundation, signal)
  const link = native.linkage.get(economics.foundation.originalPackageId)
  commerceCheck(link?.upgradedId === economics.foundation.callablePackageId && link.upgradedVersion === String(foundation.version), 'SALE_SOURCE_FOUNDATION_LINK')
  const type = (origins: Map<string, string>, module: string, name: string) => { const origin = origins.get(`${module}::${name}`)
    commerceCheck(origin, 'SALE_SOURCE_ORIGIN'); return `${origin}::${module}::${name}` }
  const observations = new Map<string, { type: string; version: string; digest: string }>()
  async function read(id: string, expectedType: string) { const row = await readCommerceObject(client, id, expectedType, signal)
    observations.set(id, { type: expectedType, version: row.version, digest: row.digest }); return row }
  const registryType = type(native.origins, 'registry', 'Registry'), stateType = type(native.origins, 'birth', 'State')
  const registryObject = await read(registryId, registryType), registry = decodeCommerce(NativeSaleRegistryBcs, registryObject.contents)
  commerceCheck(registryObject.owner.$kind === 'Shared' && registry.id === registryId && registry.protocol === economics.configId && registry.schema === 1, 'SALE_SOURCE_REGISTRY')
  const stateObject = await read(stateId, stateType), state = decodeCommerce(CanonicalNativeStateBcs, stateObject.contents)
  commerceCheck(state.id === stateId && state.root === soulId && state.protocol === economics.configId
    && state.registry === registry.id && state.schema === 1, 'SALE_SOURCE_STATE')
  const keyType = `${type(foundation.origins, 'economics', 'SourceRegistryKey')}<${registryType}>`
  const directoryId = deriveDynamicFieldID(economics.configId, keyType, moveEmptyStructBytes())
  const directoryObject = await read(directoryId, `0x2::dynamic_field::Field<${keyType},${type(foundation.origins, 'economics', 'SourceRegistryLocation')}>`)
  const directory = decodeCommerce(NativeSaleSourceLocationBcs, directoryObject.contents)
  commerceCheck(directoryObject.owner.ObjectOwner === economics.configId && directory.id === directoryId
    && directory.value.id === registry.id, 'SALE_SOURCE_DIRECTORY')
  let currentIssuer: { fieldId: string; version: string; digest: string } | null = null
  if (requireCurrentIssuer) {
    const revisionKey = `${type(foundation.origins, 'economics', 'SourceRevisionKey')}<${registryType}>`
    const fieldId = deriveDynamicFieldID(economics.configId, revisionKey, moveEmptyStructBytes())
    const fieldObject = await read(fieldId, `0x2::dynamic_field::Field<${revisionKey},${type(foundation.origins, 'source_authority', 'Revision')}>`)
    const field = decodeCommerce(NativeSourceRevisionFieldBcs, fieldObject.contents), r = field.value
    const markerOrigin = native.origins.get('registry::SourceRevision2')
    commerceCheck(fieldObject.owner.ObjectOwner === economics.configId && field.id === fieldId && !field.name.dummy_field
      && native.origins.get('registry::SoulProducer') === nativePin.originalPackageId
      && native.origins.get('registry::Registry') === nativePin.originalPackageId
      && r.original === nativePin.originalPackageId && r.callable === markerOrigin && BigInt(r.version) > 0n
      && r.marker.name === `${markerOrigin?.slice(2)}::registry::SourceRevision2`
      && toHex(NativeSourceRevisionBcs.serialize(r).toBytes()) === toHex(NativeSourceRevisionBcs.serialize(state.issuer).toBytes()), 'PAID_SOURCE_CURRENT_ISSUER')
    currentIssuer = { fieldId, version: fieldObject.version, digest: fieldObject.digest }
  }
  const gates = recoverEconomicsHistoricalGates(income.config)
  observations.set(income.object.objectId, { type: income.configType, version: income.object.version, digest: income.object.digest })
  for (const [id, stamp] of observations) { const current = await readCommerceObject(client, id, stamp.type, signal)
    commerceCheck(current.version === stamp.version && current.digest === stamp.digest, 'SALE_SOURCE_CHANGED') }
  return { proof: 'native-sale-current-state-registry-config-binding-only' as const, soulId: soulId, stateId: state.id,
    registryId: registry.id, config: income.object, gates: gates.gates, directoryId, currentIssuer, notAuthorization: true as const }
}
