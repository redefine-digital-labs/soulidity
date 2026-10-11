import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toBase64, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { EncryptedObject } from '../../../web/node_modules/@mysten/seal/dist/index.mjs'
import { deriveContentUploadRecoveryId, generateContentDocumentIdHex } from '../../../packages/soulidity-sdk/src/index'
import { contentAppendPreparationMessage, contentAppendPreparationOperationHash,
  type ContentAppendPreparation, type ContentAppendPreparationScope } from '../../../web/lib/soulidity/content-append-preparation'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
/** Structural EncryptedObjects + a REAL author personal-message signature.
 * This is a signed-store fixture, NOT an AES/Seal decryption fixture: opaque
 * bodies deliberately have no decryptable private payload or usable raw DEK. */
export async function contentAppendStoreFixture(changes: Partial<ContentAppendPreparationScope> = {}): Promise<ContentAppendPreparation> {
  const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(27))
  const scope: ContentAppendPreparationScope = { author: signer.toSuiAddress(), originalPackageId: id(6), callablePackageId: id(7),
    contentObjectId: id(17), kind: 1, name: 'default', versionIndex: '9007199254740993', intentJson: '{"operation":"append"}', ...changes }
  const wrap = (documentId: string, length: number, aad = new Uint8Array()) => toBase64(EncryptedObject.serialize({
    version: 0, packageId: scope.originalPackageId, id: documentId, services: [[id(60), 1]], threshold: 1,
    encryptedShares: { BonehFranklinBLS12381: { nonce: new Uint8Array(96), encryptedShares: [new Uint8Array(32)],
      encryptedRandomness: new Uint8Array(32) } }, ciphertext: { Aes256Gcm: { blob: new Uint8Array(length + 16), aad } },
  }).toBytes())
  const documentId = generateContentDocumentIdHex({ contentObjectId: scope.contentObjectId, kind: scope.kind, name: scope.name,
    versionIndex: BigInt(scope.versionIndex), nonce: new Uint8Array(16).fill(5) })
  const nonce = '07'.repeat(16), recoveryId = deriveContentUploadRecoveryId({ author: scope.author, contentObjectId: scope.contentObjectId,
    operationHash: contentAppendPreparationOperationHash(scope), nonce })
  const ciphertext = new Uint8Array(21).fill(19), contentHash = 'c'.repeat(64)
  const unsigned = { schema: 'soulidity.content-append-preparation.v1' as const, scope,
    sealConfig: { threshold: 1, ttlMin: 5, serverConfigs: [{ objectId: id(60), weight: 1, aggregatorUrl: 'https://seal.example.com/' }] },
    contentHash, payloadHash: toHex(sha256(ciphertext)), plaintextByteLength: 5, ciphertext,
    sidecar: { version: 1 as const, mode: 'seal-envelope' as const, sealPackageId: scope.originalPackageId, documentId,
      encryptedDek: wrap(documentId, 64), iv: toBase64(new Uint8Array(12)), cipher: 'AES-GCM-256' as const,
      mimeType: 'text/plain', fileName: 'memory.txt', contentHash },
    recovery: { nonce, documentId: recoveryId, encrypted: wrap(recoveryId, 128, new TextEncoder().encode(JSON.stringify(scope))), plaintextByteLength: 128 } }
  return { ...unsigned, authorSignature: (await signer.signPersonalMessage(contentAppendPreparationMessage(unsigned))).signature }
}
