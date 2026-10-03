import { createHash } from 'node:crypto'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase58, toBase64 } from '@mysten/sui/utils'
import { buildCommitPrivateWalletBookmarksTx } from '@soulidity/sdk'
import { bookmarkCryptoFixture, bid } from './private-bookmark-crypto'
import { parsePrivateBookmarkRecovery, privateBookmarkStorageScope, privateBookmarkWalrusKey } from '../../../web/lib/bookmarks/private-bookmark-recovery'
import { parseWalrusSingleRecord } from '../../../web/lib/upload/walrus-single-operation'

/** Actual AES/Seal ciphertext; synthetic payment packets are structural fixtures,
 * never live payment, Walrus certification or deployed authorization evidence. */
export async function privateBookmarkRecoveryFixture() {
  const crypto = await bookmarkCryptoFixture(), bytes = await crypto.encryptBytes()
  const record = parsePrivateBookmarkRecovery({ schema: 'soulidity.private-bookmark-recovery.v1', sequence: 0, status: 'ACTIVE',
    paymentStarted: false, config: { deployment: { originalPackageId: crypto.context.originalPackageId,
      callablePackageId: bid(41), callableDigest: toBase58(new Uint8Array(32).fill(12)), chainIdentifier: crypto.context.chainIdentifier },
      registryId: crypto.scope.registryId, storage: { blobType: `${bid(42)}::blob::Blob`, aggregatorUrl: 'https://walrus.example.com' },
      sealConfig: crypto.sealConfig, writesEnabled: true },
    uploadConfig: { network: 'mainnet', relayUrl: 'https://relay.example.com', wasmUrl: '/walrus/walrus_wasm@0.3.5.wasm', storageEpochs: 3 },
    context: crypto.context, ciphertext: bytes, cipherSha256: createHash('sha256').update(bytes).digest('hex'), storage: null, transaction: null })
  async function packet(name: string) {
    const tx = new Transaction(); tx.setSender(crypto.scope.owner); tx.setGasOwner(crypto.scope.owner); tx.setGasPrice('1000'); tx.setGasBudget('50000000')
    tx.setGasPayment([{ objectId: bid(901), version: '1', digest: toBase58(new Uint8Array(32).fill(3)) }]); tx.setExpiration({ Epoch: '10' })
    tx.moveCall({ target: `${bid(900)}::system::${name}`, arguments: [] })
    const encoded = await tx.build()
    return { bytes: toBase64(encoded), digest: TransactionDataBuilder.getDigestFromBytes(encoded), expirationEpoch: '10', phase: 'SUCCEEDED' as const, signature: null }
  }
  const register = await packet('register_blob'), certify = await packet('certify_blob')
  const blobId = toBase64(new Uint8Array(32).fill(7)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  const walrus = parseWalrusSingleRecord({ schema: 'soulidity.walrus-single.v1',
    intent: { network: 'mainnet', owner: crypto.scope.owner, recipient: crypto.scope.owner, operationScope: privateBookmarkStorageScope(record),
      attachmentScope: null, contentHash: record.cipherSha256, payloadHash: record.cipherSha256, payloadByteLength: bytes.length,
      storageEpochs: record.uploadConfig.storageEpochs, relayUrl: record.uploadConfig.relayUrl },
    encoding: { blobId, rootHash: 'controlled-root', unencodedSize: bytes.length, nonce: null },
    uploaded: { blobId, blobObjectId: bid(902), certificate: 'controlled-certificate' },
    approved: { relayTip: '1', storageCost: '3', writeCost: '2', gasBudget: '100000000', quoteId: 'walrus-quote-controlled' },
    register, certify, acknowledged: false })
  const paid = parsePrivateBookmarkRecovery({ ...record, paymentStarted: true,
    storage: { reference: { blobObjectId: bid(902), blobId, sha256: record.cipherSha256, byteLength: String(bytes.length) },
      storageTxDigest: register.digest, certifyTxDigest: certify.digest, recoveryKey: privateBookmarkWalrusKey(record), quoteId: walrus.approved!.quoteId } })
  const plan = { deployment: paid.config.deployment, scope: paid.context.scope, expectedRevision: '0',
    requestId: paid.context.requestId, ciphertext: paid.storage!.reference }
  const data = new TransactionDataBuilder(buildCommitPrivateWalletBookmarksTx(plan).getData())
  data.inputs = data.inputs.map(input => input.UnresolvedObject
    ? Inputs.SharedObjectRef({ objectId: input.UnresolvedObject.objectId, initialSharedVersion: '1', mutable: true }) : input)
  data.gasData = { owner: crypto.scope.owner, budget: '1000000', price: '1',
    payment: [{ objectId: bid(901), version: '1', digest: toBase58(new Uint8Array(32).fill(3)) }] }
  data.expiration = { Epoch: '10', $kind: 'Epoch' }
  const headBytes = data.build(), transaction = { plan, packet: { bytes: toBase64(headBytes),
    digest: TransactionDataBuilder.getDigestFromBytes(headBytes), expirationEpoch: '10', phase: 'PREPARED' as const, signature: null } }
  const prepared = parsePrivateBookmarkRecovery({ ...paid, transaction })
  return { record, paid, prepared, walrus, library: crypto.library, soulId: crypto.soulId, decrypt: crypto.decryptBytes }
}
