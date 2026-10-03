/** Browser-safe metadata only, without secrets or plaintext. The raw reader
 * verifies chain provenance; this metadata never replaces Seal approval. */
export interface NativeCompleteReadTarget {
  schema: 'native-complete-read-v1'
  soulId: string
  stateId: string
  owner: string
  ownershipEpoch: string
  bindingId: string
  outputId: string
  receiptId: string
  rootId: string
  protocolConfigId: string
  catalogId: string
  releaseConfigId: string
  sealRegistryId: string
  sealPolicyId: string
  paymentCoinType: string
  release: { originalPackageId: string; callablePackageId: string; callableDigest: string }
  ciphertext: { blobId: string; sha256: string; sealId: number[]; aadBase64: string }
  policy: {
    keyServers: { objectId: string; weight: number; aggregatorUrl?: string }[]
    threshold: number
    maxPlaintextBytes: number
    cipherSuite: string
    keyDerivation: string
    ciphertextFormat: string
  }
}
