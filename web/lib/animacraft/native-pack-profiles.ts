import { bcs } from '@mysten/sui/bcs'
import { sha256 } from '@noble/hashes/sha2.js'
import { equipmentUtf8 } from './native-equipment-bytes'
import { NativeReceiveError } from './native-receive'
import type { NativePackDefinitions } from './native-pack-definitions'
const V = bcs.vector(bcs.u8()); const U = bcs.u64()
const Empty = bcs.struct('EmptyCommitmentInputV8', { domain: V, version: U, root_content_commitment: V })
const Profile = bcs.struct('PartProfileCommitmentInputV8', { domain: V, version: U, root_content_commitment: V,
  sequence: U, previous: V, part_key: bcs.string(), core_part_payload_commitment: V,
  required: bcs.bool(), wardrobe_mode: bcs.u8(), behavior: bcs.u8(), capacity: U, admission_ceiling: bcs.u8() })
/** Same publication-order rolling profile projection as Runtime
 * pack_part_profiles_v8. Release content, not Maker content, binds this chain. */
export function nativePackProfiles(definitions: NativePackDefinitions, admission: number) {
  const check = (value: unknown) => { if (!value) throw new NativeReceiveError('NATIVE_PACK_PROFILE_INVALID', 'Pack Part profile policy mismatch') }
  check([0, 1, 2].includes(admission) && definitions.release_content_commitment.length === 32
    && definitions.rows.parts.length <= 500)
  const root_content_commitment = definitions.release_content_commitment
  let previous = [...sha256(Empty.serialize({ domain: [...equipmentUtf8('animacraft-v8/runtime/part-profiles-empty')],
    version: '8', root_content_commitment }).toBytes())]
  const keys = new Set<string>()
  return definitions.rows.parts.map((part, index) => {
    check(part.sequence === String(index) && !part.required && [0, 1].includes(part.slot_mode)
      && BigInt(part.capacity) > 0n && BigInt(part.capacity) <= 64n && part.payload_commitment.length === 32
      && part.key.length > 0 && !keys.has(part.key))
    keys.add(part.key)
    const profile = { index: String(index), part_key: part.key, core_part_payload_commitment: part.payload_commitment,
      required: false, wardrobe_mode: part.slot_mode, behavior: part.slot_mode === 0 ? 0 : admission === 0 ? 1 : 3,
      capacity: part.capacity, admission_ceiling: admission }
    previous = [...sha256(Profile.serialize({ domain: [...equipmentUtf8('animacraft-v8/runtime/part-profile')], version: '8',
      root_content_commitment, sequence: profile.index, previous, ...profile }).toBytes())]
    return { ...profile, profile_commitment: previous }
  })
}
