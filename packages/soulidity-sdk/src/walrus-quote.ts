const MIB = 1024 * 1024

export const WALRUS_SINGLE_BLOB_MAX_BYTES = 50 * MIB
export const WALRUS_DEFAULT_CHUNK_BYTES = 16 * MIB
export const WALRUS_UPLOAD_QUOTE_TTL_MS = 60_000

type WalrusNetwork = 'testnet' | 'mainnet'
type ChunkingMode = false | true | 'auto'

export interface WalrusQuoteFileInput {
  name: string
  size: number
  encryptedSize?: number
}

export interface WalrusUploadPlanInput {
  files: WalrusQuoteFileInput[]
  network: WalrusNetwork
  storageEpochs: number
  chunking: ChunkingMode
  relayUrl: string
  chunkSizeBytes?: number
  /**
   * Number of wallet signatures the caller will request. The default is one
   * per Walrus operation (`(chunkCount + manifestCount) * 2`), which matches
   * the per-blob register+certify path. Batch flows that bundle N
   * register_blob calls into one PTB and N certify_blob calls into the mint
   * PTB pass `walletSignatureCount: 2` to keep the cost-review modal honest.
   */
  walletSignatureCount?: number
}

export interface WalrusUploadPlanFile {
  name: string
  plaintextBytes: number
  payloadBytes: number
  chunkCount: number
}

export interface WalrusUploadPlan {
  files: WalrusUploadPlanFile[]
  network: WalrusNetwork
  storageEpochs: number
  chunking: boolean
  chunkSizeBytes: number
  relayUrl: string
  totalBytes: number
  chunkCount: number
  manifestCount: number
  transactionCount: number
  /**
   * Wallet signatures the user will be asked to approve. `null` means the
   * legacy per-blob model where each Walrus operation maps 1:1 to a wallet
   * transaction (`transactionCount` is the source of truth). When set, this
   * overrides `transactionCount` in cost-review UI and gas-budget defaults so
   * batch flows that collapse N operations into 2 PTBs do not display 2N
   * signatures.
   */
  walletSignatureCount: number | null
  fingerprint: string
}

export interface WalrusQuoteItem {
  label: string
  payloadBytes: number
  relayTipMist: bigint
  walStorageCost: bigint
  walWriteCost: bigint
}

export interface WalrusUploadQuote {
  id: string
  network: WalrusNetwork
  relayUrl: string
  storageEpochs: number
  totalBytes: number
  fileCount: number
  chunkCount: number
  manifestCount: number
  transactionCount: number
  /** Mirrors `WalrusUploadPlan.walletSignatureCount`. */
  walletSignatureCount: number | null
  relayTipMist: bigint
  walStorageCost: bigint
  walWriteCost: bigint
  gasBudgetMist: bigint
  items: WalrusQuoteItem[]
  planFingerprint: string
  quotedAt: number
  expiresAt: number
}

function assertPositiveSafeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`)
  }
}

function normalizeRelayUrl(relayUrl: string) {
  const url = new URL(relayUrl)
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function hashString(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `walrus-quote-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function manifestPayloadBytes(file: WalrusUploadPlanFile, chunkSizeBytes = WALRUS_DEFAULT_CHUNK_BYTES) {
  const placeholderChunks = Array.from({ length: file.chunkCount }, (_, index) => ({
    index,
    offset: index * chunkSizeBytes,
    size: index === file.chunkCount - 1
      ? file.payloadBytes - index * chunkSizeBytes
      : chunkSizeBytes,
    blobId: 'b'.repeat(96),
    blobObjectId: `0x${'0'.repeat(64)}`,
    storageTxDigest: 's'.repeat(64),
    certifyTxDigest: 'c'.repeat(64),
  }))
  return new TextEncoder().encode(JSON.stringify({
    version: 1,
    type: 'clawnews-walrus-chunk-manifest',
    name: file.name,
    payloadBytes: file.payloadBytes,
    chunkCount: file.chunkCount,
    chunks: placeholderChunks,
  })).byteLength
}

export function buildWalrusUploadPlan(input: WalrusUploadPlanInput): WalrusUploadPlan {
  assertPositiveSafeInteger(input.storageEpochs, 'storageEpochs')
  const chunkSizeBytes = input.chunkSizeBytes ?? WALRUS_DEFAULT_CHUNK_BYTES
  assertPositiveSafeInteger(chunkSizeBytes, 'chunkSizeBytes')
  if (input.files.length === 0) {
    throw new Error('At least one file is required for a Walrus upload quote')
  }
  if (input.walletSignatureCount !== undefined) {
    assertPositiveSafeInteger(input.walletSignatureCount, 'walletSignatureCount')
  }

  const files = input.files.map((file) => {
    assertPositiveSafeInteger(file.size, `${file.name || 'file'} size`)
    const payloadBytes = file.encryptedSize ?? file.size
    assertPositiveSafeInteger(payloadBytes, `${file.name || 'file'} payload size`)
    const shouldChunk = input.chunking === true || (input.chunking === 'auto' && payloadBytes > WALRUS_SINGLE_BLOB_MAX_BYTES)
    return {
      name: file.name || 'blob',
      plaintextBytes: file.size,
      payloadBytes,
      chunkCount: shouldChunk ? Math.ceil(payloadBytes / chunkSizeBytes) : 1,
    }
  })
  const chunking = files.some((file) => file.chunkCount > 1)
  const manifestCount = files.filter((file) => file.chunkCount > 1).length
  const totalBytes = files.reduce((sum, file) => (
    sum + file.payloadBytes + (file.chunkCount > 1 ? manifestPayloadBytes(file, chunkSizeBytes) : 0)
  ), 0)
  const chunkCount = files.reduce((sum, file) => sum + file.chunkCount, 0)
  const relayUrl = normalizeRelayUrl(input.relayUrl)
  const walletSignatureCount = input.walletSignatureCount ?? null
  const fingerprintPayload = {
    files,
    network: input.network,
    storageEpochs: input.storageEpochs,
    chunking,
    chunkSizeBytes,
    relayUrl,
    walletSignatureCount,
  }

  return {
    files,
    network: input.network,
    storageEpochs: input.storageEpochs,
    chunking,
    chunkSizeBytes,
    relayUrl,
    totalBytes,
    chunkCount,
    manifestCount,
    transactionCount: (chunkCount + manifestCount) * 2,
    walletSignatureCount,
    fingerprint: hashString(stableStringify(fingerprintPayload)),
  }
}

function quoteItemsFromPlan(plan: WalrusUploadPlan): Array<{ label: string; payloadBytes: number }> {
  return plan.files.flatMap((file) => {
    if (file.chunkCount <= 1) {
      return [{ label: file.name, payloadBytes: file.payloadBytes }]
    }
    const items = Array.from({ length: file.chunkCount }, (_, chunkIndex) => {
      const start = chunkIndex * plan.chunkSizeBytes
      const end = Math.min(file.payloadBytes, start + plan.chunkSizeBytes)
      return {
        label: `${file.name} chunk ${chunkIndex + 1}/${file.chunkCount}`,
        payloadBytes: end - start,
      }
    })
    return [
      ...items,
      { label: `${file.name} manifest`, payloadBytes: manifestPayloadBytes(file, plan.chunkSizeBytes) },
    ]
  })
}

export async function quoteWalrusUpload(
  plan: WalrusUploadPlan,
  options: {
    now?: () => number
    fetchStorageCost?: (payloadBytes: number, storageEpochs: number) => Promise<{
      storageCost: bigint
      writeCost: bigint
      totalCost: bigint
    }>
    calculateRelayTip: (payloadBytes: number) => Promise<bigint>
    estimateGasBudgetMist?: (plan: WalrusUploadPlan) => bigint
  },
): Promise<WalrusUploadQuote> {
  const rawItems = quoteItemsFromPlan(plan)
  const items: WalrusQuoteItem[] = []

  for (const rawItem of rawItems) {
    const storageCost = options.fetchStorageCost
      ? await options.fetchStorageCost(rawItem.payloadBytes, plan.storageEpochs)
      : { storageCost: 0n, writeCost: 0n, totalCost: 0n }
    const relayTipMist = await options.calculateRelayTip(rawItem.payloadBytes)
    items.push({
      ...rawItem,
      relayTipMist,
      walStorageCost: storageCost.storageCost,
      walWriteCost: storageCost.writeCost,
    })
  }

  const quotedAt = options.now?.() ?? Date.now()
  // When the caller has bundled Walrus operations into fewer wallet PTBs,
  // size the gas budget against the actual signature count rather than
  // against the per-blob op count (which would massively over-budget).
  const gasBudgetMultiplier = plan.walletSignatureCount ?? plan.transactionCount
  return {
    id: plan.fingerprint,
    network: plan.network,
    relayUrl: plan.relayUrl,
    storageEpochs: plan.storageEpochs,
    totalBytes: plan.totalBytes,
    fileCount: plan.files.length,
    chunkCount: plan.chunkCount,
    manifestCount: plan.manifestCount,
    transactionCount: plan.transactionCount,
    walletSignatureCount: plan.walletSignatureCount,
    relayTipMist: items.reduce((sum, item) => sum + item.relayTipMist, 0n),
    walStorageCost: items.reduce((sum, item) => sum + item.walStorageCost, 0n),
    walWriteCost: items.reduce((sum, item) => sum + item.walWriteCost, 0n),
    gasBudgetMist: options.estimateGasBudgetMist?.(plan) ?? BigInt(gasBudgetMultiplier) * 50_000_000n,
    items,
    planFingerprint: plan.fingerprint,
    quotedAt,
    expiresAt: quotedAt + WALRUS_UPLOAD_QUOTE_TTL_MS,
  }
}

export function isWalrusUploadQuoteFresh(
  quote: WalrusUploadQuote | null | undefined,
  plan: WalrusUploadPlan,
  now = Date.now(),
) {
  const currentFingerprint = hashString(stableStringify({
    files: plan.files,
    network: plan.network,
    storageEpochs: plan.storageEpochs,
    chunking: plan.chunking,
    chunkSizeBytes: plan.chunkSizeBytes,
    relayUrl: plan.relayUrl,
    walletSignatureCount: plan.walletSignatureCount,
  }))
  return Boolean(
    quote
    && quote.planFingerprint === currentFingerprint
    && quote.network === plan.network
    && quote.relayUrl === plan.relayUrl
    && quote.totalBytes === plan.totalBytes
    && quote.fileCount === plan.files.length
    && quote.chunkCount === plan.chunkCount
    && quote.manifestCount === plan.manifestCount
    && quote.transactionCount === plan.transactionCount
    && quote.walletSignatureCount === plan.walletSignatureCount
    && quote.expiresAt >= now,
  )
}
