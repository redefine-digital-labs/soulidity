import { bcs } from '@mysten/sui/bcs'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { blobIdFromInt, type ProtocolMessageCertificate } from '@mysten/walrus'

/** The installed Walrus SDK accepts this public BCS format in certifyBlob.
 * Its internal codec is not a package export; keep the exact wire layout here. */
export const WalrusBatchCertificateBcs = bcs.struct('Certificate', {
  signers: bcs.vector(bcs.u16()), serializedMessage: bcs.byteVector(), signature: bcs.byteVector(),
})
const Confirmation = bcs.struct('StorageConfirmation', {
  intent: bcs.struct('Intent', { type: bcs.u8(), version: bcs.u8(), appId: bcs.u8() }),
  epoch: bcs.u32(),
  messageContents: bcs.struct('StorageConfirmationBody', {
    blobId: bcs.u256(),
    blobType: bcs.enum('BlobPersistenceType', {
      Permanent: null, Deletable: bcs.struct('Deletable', { objectId: bcs.Address }),
    }),
  }),
})
function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`WALRUS_BATCH_CERTIFICATE_${code}`)
}
export function encodeWalrusBatchCertificate(input: ProtocolMessageCertificate): string {
  check(input && Array.isArray(input.signers) && input.signers.length > 0 && input.signers.length <= 65535
    && new Set(input.signers).size === input.signers.length
    && input.signers.every(n => Number.isInteger(n) && n >= 0 && n <= 65535)
    && input.serializedMessage instanceof Uint8Array && input.serializedMessage.length <= 1024
    && input.signature instanceof Uint8Array && input.signature.length === 96, 'SHAPE_INVALID')
  return WalrusBatchCertificateBcs.serialize(input).toBase64()
}
export function decodeWalrusBatchCertificate(input: string): ProtocolMessageCertificate {
  check(typeof input === 'string' && input.length > 0 && input.length <= 256 * 1024, 'SIZE_INVALID')
  const bytes = fromBase64(input)
  check(toBase64(bytes) === input, 'BASE64_INVALID')
  const value = WalrusBatchCertificateBcs.parse(bytes)
  const result = { signers: value.signers, serializedMessage: new Uint8Array(value.serializedMessage), signature: new Uint8Array(value.signature) }
  check(encodeWalrusBatchCertificate(result) === input, 'NONCANONICAL')
  return result
}
/** Shape/message/quorum validation is not BLS verification. The adapter only
 * authorizes fresh certify construction after certificateFromConfirmations has
 * verified node signatures; imported cached certificates alone are not proof. */
export function inspectWalrusBatchCertificate(input: string, expected: {
  blobId: string; blobObjectId: string; epoch?: number
  committee?: { n_shards: number; members: readonly { weight: number }[] }
}) {
  const certificate = decodeWalrusBatchCertificate(input)
  const message = Confirmation.parse(certificate.serializedMessage)
  check(toBase64(Confirmation.serialize(message).toBytes()) === toBase64(certificate.serializedMessage)
    && message.intent.type === 1 && message.intent.version === 0 && message.intent.appId === 3
    && blobIdFromInt(message.messageContents.blobId) === expected.blobId
    && message.messageContents.blobType.Deletable?.objectId === expected.blobObjectId,
  'MESSAGE_MISMATCH')
  if (expected.epoch !== undefined) check(message.epoch === expected.epoch, 'EPOCH_MISMATCH')
  if (expected.committee) {
    const { n_shards, members } = expected.committee
    check(Number.isInteger(n_shards) && n_shards > 0 && n_shards <= 65535 && members.length > 0
      && members.every(member => Number.isInteger(member.weight) && member.weight > 0 && member.weight <= 65535)
      && members.reduce((sum, member) => sum + member.weight, 0) === n_shards, 'COMMITTEE_INVALID')
    check(certificate.signers.every(index => index < members.length), 'SIGNER_OUT_OF_RANGE')
    const weight = certificate.signers.reduce((sum, index) => sum + members[index].weight, 0)
    check(3 * weight >= 2 * n_shards + 1, 'WEIGHTED_QUORUM_REQUIRED')
  }
  return { certificate, epoch: message.epoch }
}
