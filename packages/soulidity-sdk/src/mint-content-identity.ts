import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { deriveObjectID } from '@mysten/sui/utils'

export interface MintContentIdentityInput {
  /** Persist once before payment; never regenerate for an unresolved mint. */
  mintNonce: Uint8Array
  expectedContentObjectId: string
}

function canonicalId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0+$/.test(value)) {
    throw new Error(`${label} must be a canonical nonzero address`)
  }
}

export function snapshotMintContentIdentity(input: MintContentIdentityInput): MintContentIdentityInput {
  if (!(input.mintNonce instanceof Uint8Array) || input.mintNonce.length !== 16) {
    throw new Error('mintNonce must contain exactly 16 bytes')
  }
  canonicalId(input.expectedContentObjectId, 'expectedContentObjectId')
  return { mintNonce: new Uint8Array(input.mintNonce), expectedContentObjectId: input.expectedContentObjectId }
}

const ContentMintKeyV1 = bcs.struct('ContentMintKeyV1', { author: bcs.Address, nonce: bcs.vector(bcs.u8()) })

/** Same typed derived-object key as Move. This is identity, not authorization. */
export function deriveMintContentObjectId(input: {
  kioskRegistryId: string; originalPackageId: string; author: string; mintNonce: Uint8Array
}): string {
  canonicalId(input.kioskRegistryId, 'kioskRegistryId')
  canonicalId(input.originalPackageId, 'originalPackageId')
  canonicalId(input.author, 'author')
  if (!(input.mintNonce instanceof Uint8Array) || input.mintNonce.length !== 16) {
    throw new Error('mintNonce must contain exactly 16 bytes')
  }
  return deriveObjectID(input.kioskRegistryId, `${input.originalPackageId}::market::ContentMintKeyV1`,
    ContentMintKeyV1.serialize({ author: input.author, nonce: input.mintNonce }).toBytes())
}

/** Append to the register/create PTB. The event commits recovery intent only. */
export function appendCommitMintManifest(tx: Transaction, input: {
  callablePackageId: string; manifestHash: Uint8Array
}): void {
  canonicalId(input.callablePackageId, 'callablePackageId')
  if (!(input.manifestHash instanceof Uint8Array) || input.manifestHash.length !== 32) {
    throw new Error('manifestHash must contain exactly 32 bytes')
  }
  tx.moveCall({ target: `${input.callablePackageId}::market::commit_mint_manifest`,
    arguments: [tx.pure.vector('u8', new Uint8Array(input.manifestHash))] })
}

export function buildCommitMintManifestTx(input: Parameters<typeof appendCommitMintManifest>[1]): Transaction {
  const tx = new Transaction()
  appendCommitMintManifest(tx, input)
  return tx
}
