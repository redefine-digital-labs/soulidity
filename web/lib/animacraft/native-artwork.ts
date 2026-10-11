import { nativeArtworkBlobId, nativeArtworkConcat, nativeArtworkHash, nativeArtworkHex } from './native-artwork-bytes'
import { equipmentBytesEqual } from './native-equipment-bytes'
import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { getBlobUrl, profileReadStep } from '@soulidity/sdk'
import { attestNativeReceiveTarget, NativeReceiveError, receiveId, decodeNativeBcs,
  NativeSoulBindingBcs, NativeSoulStateBcs, NativeSoulBcs, type NativeReceiveTarget } from './native-receive'
import { EquipmentReadSet } from './native-equipment'

const A = bcs.Address; const V = bcs.vector(bcs.u8()); const U = bcs.u64(); const S = bcs.string()
// Exact CompleteOutputV8 layout from the target Output package.
export const NativeArtworkOutputBcs = bcs.struct('CompleteOutputV8', {
  id: A, version: U, root_id: A, maker_version: U, root_content_commitment: V, output_registry_id: A,
  output_key: S, original_holder: A, holder: A, loadout_id: A, loadout_revision: U, loadout_commitment: V,
  output_policy_commitment: V, renderer_schema_commitment: V, recipe_commitment: V, render_commitment: V,
  render_blob_id: S, render_sha256: V, render_blob_commitment: V, output_commitment: V,
  protected: bcs.bool(), scope_key: S, asset_key: S, seal_id: bcs.option(V), protection_binding_commitment: V,
})
function check(value: unknown, label: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_ARTWORK_INVALID', label)
}
const equalHash = (a: number[], b: number[]) => a.length === 32 && b.length === 32 && a.every((v, i) => v === b[i])
export type NativeArtworkProof = { status: 'PUBLIC' | 'PROTECTED'; soulId: string; bindingId: string;
  outputId: string; blobId: string; sha256: string }

/** Soul/State IDs are lookup hints only. Verify the native state, DF9, immutable binding
 * and immutable Output before treating any Blob as this Soul's public artwork. */
export async function readNativeArtwork(client: SuiGrpcClient, target: NativeReceiveTarget,
  input: { soulId: string; stateId: string }): Promise<NativeArtworkProof> {
  return (await readNativeArtworkOutput(client, target, input)).proof
}

/** Shared provenance read for artwork and the immutable completed recipe. */
export async function readNativeArtworkOutput(client: SuiGrpcClient, target: NativeReceiveTarget,
  input: { soulId: string; stateId: string }, options: { completedRecipe?: boolean } = {}) {
  const soulId = receiveId(input.soulId); const stateId = receiveId(input.stateId)
  const types = await attestNativeReceiveTarget(client, target, options)
  const reads = new EquipmentReadSet(client)
  const read = reads.read.bind(reads)
  const state = decodeNativeBcs(NativeSoulStateBcs, await read(stateId, types.stateType, 3))
  check(state.id === stateId && state.soul_id === soulId, 'Artwork SoulState mismatch')
  const soul = decodeNativeBcs(NativeSoulBcs, await reads.kioskItem(soulId, types.soulType, state.current_kiosk_id))
  check(soul.id === soulId && soul.provenance_kind === 3, 'Native Animacraft Soul required')
  const fieldId = deriveDynamicFieldID(stateId, 'u8', new Uint8Array([9]))
  const Field = bcs.struct('Field', { id: A, name: bcs.u8(), value: A })
  const field = decodeNativeBcs(Field, await read(fieldId, '0x2::dynamic_field::Field<u8,0x2::object::ID>', 2, stateId))
  check(field.id === fieldId && field.name === 9, 'Artwork binding slot mismatch')
  const binding = decodeNativeBcs(NativeSoulBindingBcs, await read(receiveId(field.value), types.bindingType, 4))
  check(binding.id === field.value && binding.version === '8' && binding.protocol_config_id === target.protocolConfigId
    && binding.soul_id === soulId && binding.soul_state_id === stateId, 'Artwork native provenance mismatch')
  const output = decodeNativeBcs(NativeArtworkOutputBcs, await read(receiveId(binding.output_id), types.outputType, 4))
  check(output.id === binding.output_id && output.version === '8' && output.root_id === binding.root_id
    && output.maker_version === binding.maker_version && output.output_key === binding.output_key
    && output.original_holder === binding.original_holder
    && equalHash(output.root_content_commitment, binding.root_content_commitment)
    && equalHash(output.output_policy_commitment, binding.output_policy_commitment)
    && equalHash(output.recipe_commitment, binding.recipe_commitment)
    && equalHash(output.render_commitment, binding.render_commitment)
    && equalHash(output.output_commitment, binding.output_commitment), 'Artwork immutable Output mismatch')
  const blobId = output.render_blob_id
  check(nativeArtworkBlobId(blobId)
    && soul.image_url === `walrus://${blobId}` && output.render_sha256.length === 32, 'Artwork Blob identity mismatch')
  // A mixed public/protected description is malformed, never a public fallback.
  check(output.protected ? output.seal_id !== null && output.seal_id.length > 0 && output.scope_key !== '' && output.asset_key !== ''
    : output.seal_id === null && output.scope_key === '' && output.asset_key === '', 'Artwork protection metadata mismatch')
  const proof: NativeArtworkProof = { status: output.protected ? 'PROTECTED' : 'PUBLIC', soulId, bindingId: binding.id,
    outputId: output.id, blobId, sha256: nativeArtworkHex(output.render_sha256) }
  await reads.verify()
  return { proof, output, types }
}

const MAX_PNG = 12 * 1024 * 1024
/** Bounded, credential-free download from the configured aggregator only. No
 * redirect or arbitrary browser URL can make this a general-purpose proxy. */
export async function fetchNativeArtwork(proof: NativeArtworkProof, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<Uint8Array> {
  proof = structuredClone(proof)
  if (proof.status !== 'PUBLIC') throw new NativeReceiveError('NATIVE_ARTWORK_PROTECTED', 'Artwork requires authorized decryption', 403)
  check(nativeArtworkBlobId(proof.blobId), 'Artwork Blob identity mismatch')
  const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
  abort.throwIfAborted()
  let received: Response | undefined, discarded = false
  const discard = (response: Response) => {
    if (!discarded) { discarded = true; void response.body?.cancel().catch(() => {}) }
  }
  const pending = fetcher(getBlobUrl(proof.blobId), { redirect: 'error', credentials: 'omit', signal: abort }).then(response => {
    received = response
    if (abort.aborted) discard(response)
    return response
  })
  // If cancellation skips run(), a late transport rejection still has an owner.
  void pending.catch(() => {})
  // Own the response across every microtask between fetch and body-reader handoff.
  let response: Response
  try { response = await profileReadStep(abort, () => pending, discard); abort.throwIfAborted() }
  catch (error) { if (received) discard(received); throw error }
  if (!response.ok) discard(response)
  check(response.ok && response.body, 'Artwork storage unavailable')
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_PNG)) {
    discard(response); throw new NativeReceiveError('NATIVE_ARTWORK_TOO_LARGE', 'Artwork exceeds size limit', 413)
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0
  try {
    for (;;) {
      const { value, done } = await profileReadStep(abort, () => reader.read()); if (done) break
      length += value.byteLength
      if (length > MAX_PNG) throw new NativeReceiveError('NATIVE_ARTWORK_TOO_LARGE', 'Artwork exceeds size limit', 413)
      chunks.push(value)
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
  abort.throwIfAborted()
  const bytes = nativeArtworkConcat(chunks, length), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  check(bytes.length >= 33 && equipmentBytesEqual(bytes.subarray(0, 8), new Uint8Array([137,80,78,71,13,10,26,10]))
    && view.getUint32(8) === 13 && equipmentBytesEqual(bytes.subarray(12, 16), new Uint8Array([73,72,68,82]))
    && view.getUint32(16) > 0 && view.getUint32(16) <= 8192
    && view.getUint32(20) > 0 && view.getUint32(20) <= 8192
    && nativeArtworkHex(nativeArtworkHash(bytes)) === proof.sha256, 'Artwork PNG bytes/hash mismatch')
  return bytes
}
