import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase64, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { profileReadStep } from '@soulidity/sdk'
import { readHistoricalMoveObject, historicalObjectOutput, historicalMoveObjectType } from '../sui/historical-object'
import { collectionCommandRaw } from '../collections/collection-command-plan'
import { soulAuthoringPacketCheck as check, type SoulAuthoringPacketRecord } from './soul-authoring-packet'

export type AuthoringCodec = { parse(bytes: Uint8Array): any; serialize(value: any): { toBytes(): Uint8Array } }
export function decodeAuthoringHistory<C extends AuthoringCodec>(codec: C, bytes: Uint8Array): ReturnType<C['parse']> {
  const value = codec.parse(bytes)
  check(toBase64(codec.serialize(value).toBytes()) === toBase64(bytes), 'HISTORY_NONCANONICAL_BCS'); return value
}
/** Historical outputs and exact frozen input references only. No current
 * ownership lookup can stand in for the original creation transaction. */
export function createSoulAuthoringHistoricalReader(params: {
  client: SuiGrpcClient; record: SoulAuthoringPacketRecord
  effects: ReturnType<typeof bcs.TransactionEffects.parse>; signal: AbortSignal
}) {
  const { client, signal } = params, record = structuredClone(params.record), effects = structuredClone(params.effects)
  const digest = record.packet.digest, packet = Transaction.from(fromBase64(record.packet.bytes)).getData()
  check(effects.V2?.transactionDigest === digest && effects.V2.status.$kind === 'Success', 'HISTORY_SUCCESS_REQUIRED')
  const claimed = new Set<string>()
  async function read<C extends AuthoringCodec>(objectId: string, type: string, codec: C,
    mode: 'created' | 'mutated' | 'written' | 'readonly' = 'created') {
    const result = await readHistoricalMoveObject({ client, signal, effects, transactionDigest: digest, objectId, type, mode })
    claimed.add(objectId)
    return { ...result, value: decodeAuthoringHistory(codec, result.bytes) }
  }
  async function field<K extends AuthoringCodec, C extends AuthoringCodec>(parent: string, keyType: string, keyCodec: K,
    key: ReturnType<K['parse']>, valueType: string, codec: C, mode: 'created' | 'mutated' | 'written' = 'created') {
    const keyBytes = keyCodec.serialize(key).toBytes(), objectId = deriveDynamicFieldID(parent, keyType, keyBytes)
    const result = await read(objectId, `0x2::dynamic_field::Field<${keyType},${valueType}>`,
      bcs.struct('Field', { id: bcs.Address, name: keyCodec as any, value: codec as any }), mode)
    check(result.reference.owner.ObjectOwner === parent && (result.reference.created || result.reference.inputOwner?.ObjectOwner === parent)
      && result.value.id === objectId && toBase64(keyCodec.serialize(result.value.name).toBytes()) === toBase64(keyBytes), 'HISTORY_FIELD_IDENTITY')
    return { objectId, value: result.value.value as ReturnType<C['parse']>, reference: result.reference }
  }
  async function input<C extends AuthoringCodec>(objectId: string, type: string, codec: C) {
    const refs = packet.inputs.flatMap(i => i.Object?.ImmOrOwnedObject?.objectId === objectId ? [i.Object.ImmOrOwnedObject] : [])
    check(refs.length <= 1, 'HISTORY_INPUT_ALIAS')
    let version: string, expectedDigest: string
    if (refs.length) { version = String(refs[0].version); expectedDigest = refs[0].digest }
    else {
      const output = historicalObjectOutput(effects, objectId, 'mutated')
      const shared = packet.inputs.flatMap(i => i.Object?.SharedObject?.objectId === objectId ? [i.Object.SharedObject] : [])
      check(shared.length === 1 && shared[0].mutable && output.inputOwner?.Shared && output.inputVersion && output.inputDigest
        && shared[0].initialSharedVersion === output.inputOwner.Shared.initialSharedVersion, 'HISTORY_INPUT_REFERENCE')
      version = String(output.inputVersion); expectedDigest = output.inputDigest
    }
    const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId, version: BigInt(version),
      readMask: { paths: ['object_id', 'version', 'digest', 'bcs'] } }, { abort: signal }))
    const row = structuredClone(response.object)
    check(row?.objectId === objectId && String(row.version) === version && row.digest === expectedDigest && row.bcs?.value instanceof Uint8Array,
      'HISTORY_INPUT_OBJECT_REQUIRED')
    const raw = collectionCommandRaw({ objectId, version, digest: expectedDigest, bcs: toBase64(row.bcs.value) }), move = raw.data.Move
    check(move && historicalMoveObjectType(move.type) === normalizeStructTag(type), 'HISTORY_INPUT_TYPE')
    if (effects.V2!.changedObjects.some(([id]) => id === objectId)) {
      const output = historicalObjectOutput(effects, objectId, 'mutated')
      check(String(output.inputVersion) === version && output.inputDigest === expectedDigest
        && JSON.stringify(output.inputOwner) === JSON.stringify(raw.owner), 'HISTORY_INPUT_EFFECTS_MISMATCH')
    }
    return { raw, value: decodeAuthoringHistory(codec, move.contents) }
  }
  return { read, field, input, effects, claimed }
}
export type SoulAuthoringHistoricalReader = ReturnType<typeof createSoulAuthoringHistoricalReader>
