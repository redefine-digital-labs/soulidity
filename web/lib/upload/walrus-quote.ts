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
  relayTipMist: bigint
  walStorageCost: bigint
  walWriteCost: bigint
  gasBudgetMist: bigint
  items: WalrusQuoteItem[]
  planFingerprint: string
  quotedAt: number
  expiresAt: number
}

type RelayTipConfig =
  | string
  | { no_tip: true }
  | { send_tip: { address: string; kind: { const: number | string | bigint } | { linear: { base: number | string | bigint; perEncodedKib?: number | string | bigint; per_encoded_kib?: number | string | bigint; encoded_size_mul_per_kib?: number | string | bigint } } } }

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
  const fingerprintPayload = {
    files,
    network: input.network,
    storageEpochs: input.storageEpochs,
    chunking,
    chunkSizeBytes,
    relayUrl,
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
    fingerprint: hashString(stableStringify(fingerprintPayload)),
  }
}

function bigintFromUnknown(value: number | string | bigint | undefined, label: string): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return BigInt(Math.trunc(value))
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  throw new Error(`${label} is not a valid non-negative integer`)
}

function calculateRelayTip(config: RelayTipConfig, payloadBytes: number): bigint {
  if (typeof config === 'string') return 0n
  if ('no_tip' in config) return 0n
  const kind = config.send_tip.kind
  if ('const' in kind) {
    return bigintFromUnknown(kind.const, 'relay const tip')
  }
  const base = bigintFromUnknown(kind.linear.base, 'relay linear base tip')
  const perEncodedKib = bigintFromUnknown(
    kind.linear.perEncodedKib ?? kind.linear.per_encoded_kib ?? kind.linear.encoded_size_mul_per_kib,
    'relay linear perEncodedKib tip',
  )
  const kib = BigInt(Math.ceil(payloadBytes / 1024))
  return base + perEncodedKib * kib
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
    fetchTipConfig?: (url: string) => Promise<RelayTipConfig>
    fetchStorageCost?: (payloadBytes: number, storageEpochs: number) => Promise<{
      storageCost: bigint
      writeCost: bigint
      totalCost: bigint
    }>
    calculateRelayTip?: (payloadBytes: number) => Promise<bigint>
    estimateGasBudgetMist?: (plan: WalrusUploadPlan) => bigint
  } = {},
): Promise<WalrusUploadQuote> {
  const fetchTipConfig = options.fetchTipConfig ?? (async (url: string) => {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) {
      throw new Error(`Walrus relay tip quote failed: ${response.status}`)
    }
    return response.json() as Promise<RelayTipConfig>
  })
  const tipConfig = options.calculateRelayTip
    ? null
    : await fetchTipConfig(`${plan.relayUrl}/v1/tip-config`)
  const rawItems = quoteItemsFromPlan(plan)
  const items: WalrusQuoteItem[] = []

  for (const rawItem of rawItems) {
    const storageCost = options.fetchStorageCost
      ? await options.fetchStorageCost(rawItem.payloadBytes, plan.storageEpochs)
      : { storageCost: 0n, writeCost: 0n, totalCost: 0n }
    const relayTipMist = options.calculateRelayTip
      ? await options.calculateRelayTip(rawItem.payloadBytes)
      : calculateRelayTip(tipConfig!, rawItem.payloadBytes)
    items.push({
      ...rawItem,
      relayTipMist,
      walStorageCost: storageCost.storageCost,
      walWriteCost: storageCost.writeCost,
    })
  }

  const quotedAt = options.now?.() ?? Date.now()
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
    relayTipMist: items.reduce((sum, item) => sum + item.relayTipMist, 0n),
    walStorageCost: items.reduce((sum, item) => sum + item.walStorageCost, 0n),
    walWriteCost: items.reduce((sum, item) => sum + item.walWriteCost, 0n),
    gasBudgetMist: options.estimateGasBudgetMist?.(plan) ?? BigInt(plan.transactionCount) * 50_000_000n,
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
    && quote.expiresAt >= now,
  )
}
