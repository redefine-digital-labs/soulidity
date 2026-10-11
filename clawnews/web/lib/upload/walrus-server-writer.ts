import 'server-only'

import {
  normalizeWalrusBlobId,
  parseRequiredObjectId,
  readTransactionSender,
  sameSuiValue,
  suiClient as defaultSuiClient,
} from '@soulidity/sdk'
import {
  deserializeWalrusEncodedBlob,
  type SerializedWalrusEncodedBlob,
  type WalrusCertificateLike,
} from '@/lib/upload/walrus-batch-transport'

const WALRUS_STORAGE_WRITE_TIMEOUT_MS = 20_000
const WALRUS_WEIGHTED_QUORUM_CONFIRMATION_RETRIES = 2

export class WalrusBatchCompleteError extends Error {
  readonly status: number

  constructor(message: string, status = 422) {
    super(message)
    this.name = 'WalrusBatchCompleteError'
    this.status = status
  }
}

export interface WalrusBatchCompleteBlobInput extends SerializedWalrusEncodedBlob {
  blobId: string
  blobObjectId: string
}

export interface CompleteWalrusBatchUploadParams {
  network: 'testnet' | 'mainnet'
  registerTxDigest: string
  walletAddress: string
  blobs: WalrusBatchCompleteBlobInput[]
}

interface WalrusRegisterValidationClient {
  waitForTransaction: (args: { digest: string; timeout?: number }) => Promise<unknown>
  getTransactionBlock: (args: {
    digest: string
    options: {
      showObjectChanges: boolean
      showEffects: boolean
      showInput: boolean
    }
  }) => Promise<{
    effects?: { status?: { status?: string; error?: string } } | null
    transaction?: { data?: { sender?: string | null } } | null
    objectChanges?: Array<{
      type?: string
      objectType?: string
      objectId?: string
    }> | null
  }>
}

interface WalrusRegisterValidationWalrusClient {
  getBlobObject: (id: string) => Promise<{
    id: string
    blob_id: string
    deletable?: boolean
  }>
  getBlobType: () => string | Promise<string>
}

interface WalrusStorageWriterClient extends WalrusRegisterValidationWalrusClient {
  writeEncodedBlobToNodes: (args: {
    blobId: string
    objectId: string
    metadata: unknown
    sliversByNode: unknown
    deletable: true
  }) => Promise<unknown[]>
  getStorageConfirmations: (args: {
    blobId: string
    objectId: string
    deletable: true
  }) => Promise<unknown[]>
  certificateFromConfirmations: (args: {
    confirmations: unknown[]
    blobId: string
    blobObjectId: string
    deletable: true
  }) => Promise<WalrusCertificateLike>
  systemState: () => Promise<{
    committee: {
      n_shards: number
      members: Array<{ weight: number }>
    }
  }>
}

export function walrusBlobIdFromU256Decimal(value: string): string {
  let n = BigInt(value)
  if (n < 0n) throw new WalrusBatchCompleteError('Walrus Blob object has an invalid negative blob_id')

  const bytes = new Uint8Array(32)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number(n & 0xffn)
    n >>= 8n
  }
  if (n !== 0n) {
    throw new WalrusBatchCompleteError('Walrus Blob object blob_id is larger than u256')
  }

  const base64 = Buffer.from(bytes).toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function normalizeExpectedBlobInput(input: { blobId: string; blobObjectId: string }) {
  const blobId = normalizeWalrusBlobId(input.blobId)
  if (!blobId) {
    throw new WalrusBatchCompleteError('Invalid blobId', 400)
  }

  const blobObjectId = parseRequiredObjectId(input.blobObjectId)
  if (!blobObjectId) {
    throw new WalrusBatchCompleteError('Invalid blobObjectId', 400)
  }

  return { blobId, blobObjectId }
}

export async function resolveRegisteredWalrusBlobObjects(params: {
  suiClient: WalrusRegisterValidationClient
  walrusClient: WalrusRegisterValidationWalrusClient
  digest: string
  walletAddress: string
  expected: Array<{ blobId: string; blobObjectId: string }>
}): Promise<Array<{ blobId: string; blobObjectId: string }>> {
  const expected = params.expected.map(normalizeExpectedBlobInput)
  const expectedObjectIds = new Set<string>()
  for (const item of expected) {
    if (expectedObjectIds.has(item.blobObjectId)) {
      throw new WalrusBatchCompleteError(`Duplicate blobObjectId ${item.blobObjectId}`, 400)
    }
    expectedObjectIds.add(item.blobObjectId)
  }

  const expectedBlobType = await params.walrusClient.getBlobType()
  await params.suiClient.waitForTransaction({ digest: params.digest })
  const tx = await params.suiClient.getTransactionBlock({
    digest: params.digest,
    options: { showObjectChanges: true, showEffects: true, showInput: true },
  })

  if (tx.effects?.status?.status !== 'success') {
    throw new WalrusBatchCompleteError(
      `Register transaction did not succeed. Digest: ${params.digest}`,
      422,
    )
  }

  const sender = readTransactionSender(tx)
  if (!sameSuiValue(sender, params.walletAddress)) {
    throw new WalrusBatchCompleteError(
      'Register transaction sender does not match the signed-in wallet',
      403,
    )
  }

  const createdBlobObjectIds = new Set<string>()
  for (const change of tx.objectChanges ?? []) {
    if (
      change.type === 'created'
      && change.objectType === expectedBlobType
      && typeof change.objectId === 'string'
    ) {
      const objectId = parseRequiredObjectId(change.objectId)
      if (objectId) createdBlobObjectIds.add(objectId)
    }
  }

  for (const { blobObjectId } of expected) {
    if (!createdBlobObjectIds.has(blobObjectId)) {
      throw new WalrusBatchCompleteError(
        `Register transaction did not create Blob object ${blobObjectId}. Digest: ${params.digest}`,
        422,
      )
    }
  }

  const decoded = await Promise.all(
    expected.map((item) => params.walrusClient.getBlobObject(item.blobObjectId)),
  )

  return expected.map((item, index) => {
    const blob = decoded[index]
    if (!sameSuiValue(blob.id, item.blobObjectId)) {
      throw new WalrusBatchCompleteError(
        `Walrus Blob object ${item.blobObjectId} resolved as unexpected object ${blob.id}`,
        422,
      )
    }
    const actualBlobId = walrusBlobIdFromU256Decimal(blob.blob_id)
    if (actualBlobId !== item.blobId) {
      throw new WalrusBatchCompleteError(
        `Walrus Blob object ${item.blobObjectId} does not match expected blobId ${item.blobId}`,
        422,
      )
    }
    if (blob.deletable !== true) {
      throw new WalrusBatchCompleteError(
        `Walrus Blob object ${item.blobObjectId} is not deletable`,
        422,
      )
    }
    return item
  })
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function hasWalrusWeightedQuorum(params: {
  signerWeights: readonly number[]
  nShards: number
}): boolean {
  if (!Number.isFinite(params.nShards) || params.nShards <= 0) return false
  const weight = params.signerWeights.reduce((sum, value) => {
    if (!Number.isFinite(value) || value <= 0) return sum
    return sum + Math.trunc(value)
  }, 0)
  return 3 * weight >= 2 * Math.trunc(params.nShards) + 1
}

async function writeEncodedBlobAndBuildCertificate(params: {
  client: WalrusStorageWriterClient
  blobId: string
  blobObjectId: string
  metadata: unknown
  sliversByNode: unknown
}) {
  const getStorageConfirmations = () =>
    withTimeout(
      params.client.getStorageConfirmations({
        blobId: params.blobId,
        objectId: params.blobObjectId,
        deletable: true,
      }),
      WALRUS_STORAGE_WRITE_TIMEOUT_MS,
      `Timed out fetching Walrus storage confirmations for blobId ${params.blobId} objectId ${params.blobObjectId}`,
    )

  let confirmations: unknown[]
  let writeError: unknown = null
  try {
    confirmations = await withTimeout(
      params.client.writeEncodedBlobToNodes({
        blobId: params.blobId,
        objectId: params.blobObjectId,
        metadata: params.metadata,
        sliversByNode: params.sliversByNode,
        deletable: true,
      }),
      WALRUS_STORAGE_WRITE_TIMEOUT_MS,
      `Timed out writing Walrus slivers for blobId ${params.blobId} objectId ${params.blobObjectId}`,
    )
  } catch (error) {
    writeError = error
    confirmations = await getStorageConfirmations()
  }

  let lastQuorumStatus: { signingWeight: number; nShards: number } | null = null
  for (let attempt = 0; attempt <= WALRUS_WEIGHTED_QUORUM_CONFIRMATION_RETRIES; attempt++) {
    let certificate: WalrusCertificateLike
    try {
      certificate = await params.client.certificateFromConfirmations({
        confirmations,
        blobId: params.blobId,
        blobObjectId: params.blobObjectId,
        deletable: true,
      })
    } catch (certificateError) {
      if (writeError) throw writeError
      throw certificateError
    }

    const systemState = await params.client.systemState()
    const signerWeights = certificate.signers.map((signer) => {
      if (!Number.isInteger(signer) || signer < 0) return 0
      const weight = systemState.committee.members[signer]?.weight
      return Number.isFinite(weight) && weight > 0 ? Math.trunc(weight) : 0
    })
    const signingWeight = signerWeights.reduce((sum, value) => sum + value, 0)
    const nShards = Math.trunc(systemState.committee.n_shards)
    if (hasWalrusWeightedQuorum({ signerWeights, nShards })) {
      return {
        blobId: params.blobId,
        blobObjectId: params.blobObjectId,
        certificate,
      }
    }

    lastQuorumStatus = { signingWeight, nShards }
    if (attempt === WALRUS_WEIGHTED_QUORUM_CONFIRMATION_RETRIES) break
    confirmations = await getStorageConfirmations()
  }

  if (lastQuorumStatus) {
    throw new Error(
      'Walrus certificate weighted quorum pre-signing guard rejected '
      + `blobId ${params.blobId} objectId ${params.blobObjectId}: `
      + `signing weight ${lastQuorumStatus.signingWeight} did not satisfy `
      + `n_shards ${lastQuorumStatus.nShards}`,
    )
  }

  throw new Error(
    `Walrus certificate weighted quorum pre-signing guard could not evaluate blobId ${params.blobId} objectId ${params.blobObjectId}`,
  )
}

async function createServerWalrusClient(params: {
  network: 'testnet' | 'mainnet'
  suiClient: unknown
}): Promise<WalrusStorageWriterClient> {
  const { WalrusClient } = await import('@mysten/walrus')
  return new WalrusClient({
    suiClient: params.suiClient as never,
    network: params.network,
  }) as WalrusStorageWriterClient
}

export async function completeWalrusBatchUpload(
  params: CompleteWalrusBatchUploadParams,
): Promise<{
  files: Array<{
    blobId: string
    blobObjectId: string
    certificate: WalrusCertificateLike
  }>
}> {
  if (params.blobs.length === 0) {
    throw new WalrusBatchCompleteError('At least one Walrus blob is required', 400)
  }

  const walrusClient = await createServerWalrusClient({
    network: params.network,
    suiClient: defaultSuiClient,
  })

  await resolveRegisteredWalrusBlobObjects({
    suiClient: defaultSuiClient as unknown as WalrusRegisterValidationClient,
    walrusClient,
    digest: params.registerTxDigest,
    walletAddress: params.walletAddress,
    expected: params.blobs.map((blob) => ({
      blobId: blob.blobId,
      blobObjectId: blob.blobObjectId,
    })),
  })

  const files = await Promise.all(params.blobs.map((serialized) => {
    const blob = deserializeWalrusEncodedBlob(serialized)
    return writeEncodedBlobAndBuildCertificate({
      client: walrusClient,
      blobId: blob.blobId,
      blobObjectId: blob.blobObjectId,
      metadata: blob.metadata,
      sliversByNode: blob.sliversByNode,
    })
  }))

  return { files }
}
