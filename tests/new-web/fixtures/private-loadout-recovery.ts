import { vi } from 'vitest'
import { createHash } from 'node:crypto'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromHex, toBase58, toBase64 } from '@mysten/sui/utils'
import { SealClient, EncryptedObject } from '../../../web/node_modules/@mysten/seal/dist/index.mjs'
import { browserPrivateLoadoutFixture } from './browser-private-loadout'
import { nativeEquipmentSourceFixture } from './native-equipment-source'
import { captureNamedLoadout } from '../../../web/lib/animacraft/named-loadout'
import { emptyPrivateLoadoutLibrary, preparePrivateLoadoutMutation } from '../../../web/lib/animacraft/private-loadout-library'
import { encryptPrivateLoadoutLibrary, decryptPrivateLoadoutLibrary } from '../../../web/lib/animacraft/private-loadout-crypto'
import { NATIVE_SEAL_ENCRYPTION_PROFILE } from '../../../web/lib/animacraft/native-seal-profile'
import { parsePrivateLoadoutRecovery, privateLoadoutStorageScope, privateLoadoutWalrusKey,
  type PrivateLoadoutRecovery } from '../../../web/lib/animacraft/private-loadout-recovery'
import { parseWalrusSingleRecord } from '../../../web/lib/upload/walrus-single-operation'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
export async function privateLoadoutRecoveryFixture() {
  const browser = browserPrivateLoadoutFixture(true), source = await nativeEquipmentSourceFixture().readBase()
  const content = captureNamedLoadout(source)
  const scope = { soulId: content.soulId, stateId: content.stateId, owner: content.capturedOwner, ownershipEpoch: content.capturedOwnershipEpoch }
  const capture = { equipmentId: content.capturedEquipmentId, revision: content.capturedEquipmentRevision, commitment: 'bc'.repeat(32) }
  const requestId = 'ab'.repeat(32), secretName = 'Recovery-only secret outfit'
  const library = preparePrivateLoadoutMutation(emptyPrivateLoadoutLibrary(scope), { action: 'save', scope, requestId,
    expectedRevision: '0', at: '2026-09-11T12:00:00.000Z', loadoutId: '00000000-0000-0000-0000-000000000001', name: secretName, content, capture }).library
  const context = { scope, revision: '1', requestId, originalPackageId: browser.config.target.soulidityOriginalPackageId }
  const paths = ['bls12381', 'kdf', 'utils', 'decrypt'].map(name => `../../../web/node_modules/@mysten/seal/dist/${name}.mjs`)
  const modules = await Promise.all(paths.map(path => import(path))), cryptography: any = Object.assign({}, ...modules)
  const policy = { ...NATIVE_SEAL_ENCRYPTION_PROFILE, threshold: 2, maxPlaintextBytes: 32,
    keyServers: [{ objectId: id(700), weight: 2 }, { objectId: id(701), weight: 1 }] }
  const seal = new SealClient({ suiClient: { core: { getObject: async () => ({ object: { version: '1' } }) } } as any,
    serverConfigs: policy.keyServers, verifyKeyServers: true })
  vi.spyOn(seal, 'getKeyServers').mockResolvedValue(new Map(policy.keyServers.map(row => [row.objectId, {
    objectId: row.objectId, name: 'local test key', url: 'https://key.example', keyType: 0, serverType: 'Independent' as const,
    pk: cryptography.G2Element.generator().toBytes(),
  }])))
  const bytes = await encryptPrivateLoadoutLibrary({ library, context, policy, seal,
    signal: new AbortController().signal, verify: async () => {} })
  const record = parsePrivateLoadoutRecovery({ schema: 'soulidity.private-loadout-recovery.v1', sequence: 0, status: 'ACTIVE',
    paymentStarted: false, config: browser.config,
    uploadConfig: { network: 'mainnet', relayUrl: 'https://relay.example.com', wasmUrl: '/walrus/walrus_wasm@0.3.5.wasm', storageEpochs: 3 },
    context, capture, ciphertext: bytes, cipherSha256: createHash('sha256').update(bytes).digest('hex'), storage: null, transaction: null })
  // Structurally valid immutable Sui payment packets for import matching tests.
  // They are NOT live Walrus certification or chain/payment authorization proof.
  async function packet(name: string) {
    const tx = new Transaction(); tx.setSender(scope.owner); tx.setGasOwner(scope.owner); tx.setGasPrice('1000'); tx.setGasBudget('50000000')
    tx.setGasPayment([{ objectId: id(901), version: '1', digest: toBase58(new Uint8Array(32).fill(3)) }]); tx.setExpiration({ Epoch: '10' })
    tx.moveCall({ target: `${id(900)}::system::${name}`, arguments: [] })
    const encoded = await tx.build()
    return { bytes: toBase64(encoded), digest: TransactionDataBuilder.getDigestFromBytes(encoded), expirationEpoch: '10',
      phase: 'SUCCEEDED' as const, signature: null }
  }
  const register = await packet('register_blob'), certify = await packet('certify_blob')
  const blobId = toBase64(new Uint8Array(32).fill(7)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  const walrus = parseWalrusSingleRecord({ schema: 'soulidity.walrus-single.v1',
    intent: { network: 'mainnet', owner: scope.owner, recipient: scope.owner, operationScope: privateLoadoutStorageScope(record),
      attachmentScope: null, contentHash: record.cipherSha256, payloadHash: record.cipherSha256, payloadByteLength: bytes.length,
      storageEpochs: record.uploadConfig.storageEpochs, relayUrl: record.uploadConfig.relayUrl },
    encoding: { blobId, rootHash: 'controlled-root', unencodedSize: bytes.length, nonce: null },
    uploaded: { blobId, blobObjectId: id(902), certificate: 'controlled-certificate' },
    approved: { relayTip: '1', storageCost: '3', writeCost: '2', gasBudget: '100000000', quoteId: 'walrus-quote-controlled' },
    register, certify, acknowledged: false })
  const paid: PrivateLoadoutRecovery = parsePrivateLoadoutRecovery({ ...record, paymentStarted: true,
    storage: { reference: { blobObjectId: id(902), blobId, sha256: record.cipherSha256, byteLength: String(bytes.length) },
      storageTxDigest: register.digest, certifyTxDigest: certify.digest, recoveryKey: privateLoadoutWalrusKey(record),
      quoteId: walrus.approved!.quoteId } })
  const decrypt = (ciphertext: Uint8Array) => decryptPrivateLoadoutLibrary({ bytes: ciphertext, context, policy,
    signal: new AbortController().signal, verify: async () => {}, unwrap: async wrapped => {
      const parsed = EncryptedObject.parse(wrapped), fullId = cryptography.createFullId(parsed.packageId, parsed.id)
      return cryptography.decrypt({ encryptedObject: parsed,
        keys: new Map(policy.keyServers.map(row => [`${fullId}:${row.objectId}`, cryptography.hashToG1(fromHex(fullId))])),
        publicKeys: parsed.services.map(() => cryptography.G2Element.generator()), checkLEEncoding: false })
    } })
  return { record, paid, walrus, library, secretName, decrypt }
}
