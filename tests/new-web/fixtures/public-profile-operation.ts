import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toBase58, toBase64 } from '@mysten/sui/utils'
import { buildCreateWalletProfileTx, buildUpdateWalletProfileTx } from '../../../packages/soulidity-sdk/src/wallet-profile'
import { createPublicProfileSaveIntent } from '../../../packages/soulidity-sdk/src/public-profile-save'
import { encodePublicWalletProfileMetadata, publicWalletProfileMetadataHash } from '../../../packages/soulidity-sdk/src/public-profile-metadata'
import type { PublicProfileOperation } from '../../../packages/soulidity-sdk/src/public-profile-operation'

export const profileId = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
export const profileSigner = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(9))
export const profileDigest = toBase58(new Uint8Array(32).fill(1))
export async function publicProfileOperationFixture(create = false) {
  const id = profileId, digest = profileDigest
  const intent = createPublicProfileSaveIntent({ deployment: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '01010101' },
    owner: profileSigner.toSuiAddress(), expected: create ? null : { profileId: id(4), revision: '0' }, handle: 'alice',
    metadata: { schema: 'soulidity.public-profile.v1', displayName: 'Alice', avatar: '🦊', bio: null,
      coverImageUrl: null, twitterUrl: null, websiteUrl: null } })
  const metadataBytes = encodePublicWalletProfileMetadata(intent.metadata)
  const receipt = { schema: 'soulidity.public-profile-upload.v1' as const,
    intentHash: await publicWalletProfileMetadataHash(new TextEncoder().encode(JSON.stringify(intent))),
    reference: { blobObjectId: id(50), blobId: toBase64(new Uint8Array(32).fill(2)).replace(/=$/, ''),
      sha256: await publicWalletProfileMetadataHash(metadataBytes), byteLength: metadataBytes.length } }
  const common = { deployment: intent.deployment, owner: intent.owner, handle: intent.handle, metadata: receipt.reference }
  const template = (create ? buildCreateWalletProfileTx(common) : buildUpdateWalletProfileTx({ ...common, profileId: id(4), expectedRevision: '0' })).getData()
  const tx = Transaction.from(JSON.stringify({ ...template, inputs: template.inputs.map(input => {
    if (!input.UnresolvedObject) return input
    const objectId = input.UnresolvedObject.objectId
    return objectId === id(4) ? { Object: { ImmOrOwnedObject: { objectId, version: '1', digest } } }
      : { Object: { SharedObject: { objectId, initialSharedVersion: '1', mutable: objectId === id(3) } } }
  }) }))
  tx.setGasOwner(intent.owner); tx.setGasBudget('10000000'); tx.setGasPrice('1000')
  tx.setGasPayment([{ objectId: id(60), version: '1', digest }]); tx.setExpiration({ Epoch: '10' })
  const bytes = await tx.build()
  const record: PublicProfileOperation = { schema: 'soulidity.public-profile-operation.v1', intent, receipt,
    bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '10', phase: 'PREPARED', signature: null }
  return { intent, receipt, record, tx }
}
