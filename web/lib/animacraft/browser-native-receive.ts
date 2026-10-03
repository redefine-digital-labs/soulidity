import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { profileReadStep } from '@soulidity/sdk'
import { CONTENT_ENVELOPE_SCHEMA, contentEnvelopeKey, decodeContentEnvelope, encodeContentEnvelope, type ContentEnvelope } from '@/lib/soulidity/content-envelope'
import { parseContentSidecars } from '@/lib/soulidity/mirror/parse-content-sidecars'
import { getBrowserNativeReceiveTarget } from './browser-native-config'
import { EquipmentReadSet } from './native-equipment'
import { attestNativeReceiveTarget, createNativeReceiveClient, decodeNativeBcs, NativeReceiveError,
  NativeSoulStateBcs, parseNativeReceiveRequest, verifyNativeReceive, type NativeReceiveTarget } from './native-receive'
import type { NativeRequest } from './native-handoff'

const ConfigField = bcs.struct('Field', { id: bcs.Address, name: bcs.string(), value: bcs.vector(bcs.u8()) })
function check(value: unknown, message: string): asserts value {
  if (!value) throw new NativeReceiveError('NATIVE_RECEIVE_ENVELOPE_PENDING', message, 409)
}

/** No owned API, mirror, signing or mint. COMPLETE means both the historical
 * mint and matching durable encrypted envelopes have actually been read. */
export async function receiveBrowserNativeRequest(input: NativeRequest, getAddress: () => string | null, options: {
  signal?: AbortSignal; target?: () => NativeReceiveTarget; client?: (signal: AbortSignal) => SuiGrpcClient
} = {}) {
  const request = structuredClone(input)
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000)
  const assertWallet = () => {
    signal.throwIfAborted()
    if (getAddress() !== request.signer) throw new NativeReceiveError('AUTH_REQUIRED', 'Connect the same wallet to verify this Soul.', 401)
  }
  assertWallet()
  const target = structuredClone((options.target ?? getBrowserNativeReceiveTarget)())
  const client = (options.client ?? createNativeReceiveClient)(signal)
  if (request.type === 'PREFLIGHT') {
    await profileReadStep(signal, () => attestNativeReceiveTarget(client, target))
    assertWallet()
    return { ready: true as const, rootId: request.rootId, signer: request.signer }
  }
  const body = parseNativeReceiveRequest({ rootId: request.rootId, signer: request.signer, ...request.payload })
  const proof = await profileReadStep(signal, () => verifyNativeReceive(client, target, body))
  const provided = parseContentSidecars(body.contentSidecars, 'contentSidecars')
  const reads = new EquipmentReadSet(client)
  await profileReadStep(signal, async () => {
    const state = decodeNativeBcs(NativeSoulStateBcs, await reads.read(proof.stateId, proof.stateType, 3))
    check(state.id === proof.stateId && state.soul_id === proof.soulId && state.content_id === proof.contentId,
      'Current Soul content identity does not match the completed mint.')
    for (const version of proof.versions) {
      signal.throwIfAborted()
      const sidecar = provided.get(`${version.kind}::${version.name}::${version.versionIndex}`)
      if (!version.sealEncrypted) { check(!sidecar, 'Plaintext content must not carry an encrypted envelope.'); continue }
      check(sidecar, 'The completed Soul still needs its encrypted content envelope.')
      const expected = { contentObjectId: proof.contentId, kind: version.kind, name: version.name,
        versionIndex: version.versionIndex, blobObjectId: version.blobObjectId }
      const encoded = encodeContentEnvelope({ schema: CONTENT_ENVELOPE_SCHEMA, ...expected,
        sidecar: sidecar as ContentEnvelope['sidecar'] }, target.soulidityOriginalPackageId)
      const key = contentEnvelopeKey(expected)
      const fieldId = deriveDynamicFieldID(state.config_ext.id, '0x1::string::String', bcs.string().serialize(key).toBytes())
      const bytes = await reads.optional(fieldId, '0x2::dynamic_field::Field<0x1::string::String,vector<u8>>', 2, state.config_ext.id)
      check(bytes, 'The Soul was minted, but its encrypted envelope is not yet persisted. Resume finalization in Animacraft.')
      const field = decodeNativeBcs(ConfigField, bytes)
      check(field.id === fieldId && field.name === key, 'Content envelope field identity mismatch.')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(field.value))
      decodeContentEnvelope(text, expected, target.soulidityOriginalPackageId)
      check(text === encoded, 'The persisted content envelope differs from this completion.')
    }
    await reads.verify()
  })
  assertWallet()
  return { status: 'COMPLETE' as const, soulId: proof.soulId, transactionDigest: body.txDigest }
}
