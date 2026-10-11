import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { decodeNativeBcs, NativeReceiveError, receiveId, type NativeReceiveTarget } from './native-receive'
import type { EquipmentReadSet, EquipmentLoadoutBcs } from './native-equipment'
import { EquipmentDefinitionsBcs, EquipmentBaseRegistryBcs } from './native-equipment-source-bcs'
import { readNativeSourceAuthority } from './native-source-authority'
import { normalizeStructTag, parseStructTag } from '@mysten/sui/utils'
import { EquipmentPackReleaseBcs } from './native-equipment-pack'
import { readNativePackDefinitions } from './native-pack-definitions'

export interface EquipmentUpdateSource { definitionRegistryId: string; baseRegistryId: string;
  packDefinitions?: Array<{ releaseId: string; paymentCoinType: string; definitionCommitment: string }> }
const sameHash = (a: number[], b: number[]) => a.length === 32 && b.length === 32 && a.every((v, i) => v === b[i])
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_EQUIPMENT_SOURCE_INVALID', message)
}

/** Only the sealed source identity required by the final guard. Removal must
 * not depend on active Maker/access/Pack/Seal services or candidate pagination.
 * Actual final selections are checked by Move on the exact transaction bytes. */
export async function readEquipmentUpdateSource(client: SuiGrpcClient, target: NativeReceiveTarget,
  reads: EquipmentReadSet, loadout: ReturnType<typeof EquipmentLoadoutBcs.parse>): Promise<EquipmentUpdateSource> {
  const { rt, baseType } = await readNativeSourceAuthority(client, target)
  const definitionRegistryId = receiveId(loadout.definition_registry_id)
  const definitions = decodeNativeBcs(EquipmentDefinitionsBcs,
    await reads.read(definitionRegistryId, rt('RuntimeDefinitionRegistryV8'), 3))
  check(definitions.id === definitionRegistryId && definitions.version === '8' && definitions.sealed
    && definitions.root_id === loadout.root_id && definitions.root_version === loadout.root_version
    && sameHash(definitions.root_content_commitment, loadout.root_content_commitment), 'Equipment update definition binding mismatch')
  const baseRegistryId = receiveId(definitions.base_registry_id)
  const base = decodeNativeBcs(EquipmentBaseRegistryBcs,
    await reads.read(baseRegistryId, baseType('BaseDefinitionRegistryV8'), 3))
  check(base.id === baseRegistryId && base.version === '8' && base.sealed && base.sealed_commitments
    && base.root_id === loadout.root_id && base.maker_version === loadout.root_version
    && sameHash(base.root_content_commitment, loadout.root_content_commitment), 'Equipment update Base binding mismatch')
  check(loadout.attached_pack_definitions.length <= 500, 'Attached Pack count invalid')
  const packDefinitions: NonNullable<EquipmentUpdateSource['packDefinitions']> = []
  const seen = new Set<string>()
  for (const binding of loadout.attached_pack_definitions) {
    const releaseId = receiveId(binding.release_id)
    check(releaseId !== loadout.root_id && !seen.has(releaseId), 'Attached Pack identity invalid'); seen.add(releaseId)
    const { response } = await client.ledgerService.getObject({ objectId: releaseId,
      readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents'] } })
    check(response.object?.objectType, 'Attached Pack type missing')
    const type = parseStructTag(response.object.objectType)
    check(type.typeParams.length === 1, 'Attached Pack coin type missing')
    const paymentCoinType = normalizeStructTag(type.typeParams[0])
    const release = decodeNativeBcs(EquipmentPackReleaseBcs, reads.accept(response.object, releaseId,
      `${rt('PackReleaseV8')}<${paymentCoinType}>`, 3))
    check(release.id === releaseId && release.version === '8' && release.root_id === loadout.root_id
      && release.root_version === loadout.root_version && sameHash(release.root_content_commitment, loadout.root_content_commitment),
    'Attached Pack update binding mismatch')
    const owned = await readNativePackDefinitions(reads, release, rt)
    check(sameHash(binding.definition_commitment, owned.commitment), 'Attached Pack definition commitment mismatch')
    packDefinitions.push({ releaseId, paymentCoinType,
      definitionCommitment: owned.commitment.map(byte => byte.toString(16).padStart(2, '0')).join('') })
  }
  return { definitionRegistryId, baseRegistryId, ...(packDefinitions.length ? { packDefinitions } : {}) }
}
