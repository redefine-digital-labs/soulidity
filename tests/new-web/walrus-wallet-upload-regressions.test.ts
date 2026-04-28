import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  WALRUS_UPLOAD_QUOTE_TTL_MS,
  buildWalrusUploadPlan,
  isWalrusUploadQuoteFresh,
  quoteWalrusUpload,
} from '@/lib/upload/walrus-quote'

describe('wallet-paid Walrus upload quote guards', () => {
  it('formats WAL costs in human-readable WAL units', async () => {
    const { formatWal } = await import('@/components/upload/upload-cost-review')

    expect(formatWal(0n)).toBe('0 WAL')
    expect(formatWal(436_905n)).toBe('0.000436905 WAL')
    expect(formatWal(300_000_000n)).toBe('0.3 WAL')
    expect(formatWal(1_000_000_000n)).toBe('1 WAL')
  })

  it('quotes all chunks plus the manifest with relay tip before upload', async () => {
    const fetchTipConfig = vi.fn(async () => ({
      send_tip: {
        address: '0x2',
        kind: {
          linear: {
            base: 10,
            per_encoded_kib: 2,
          },
        },
      },
    }))

    const plan = buildWalrusUploadPlan({
      files: [
        { name: 'large.bin', size: 55 * 1024 * 1024, encryptedSize: 55 * 1024 * 1024 + 16 },
      ],
      network: 'testnet',
      storageEpochs: 3,
      chunking: 'auto',
      relayUrl: 'https://relay.example',
    })

    expect(plan.chunkCount).toBe(4)
    expect(plan.transactionCount).toBe(10)

    const quote = await quoteWalrusUpload(plan, {
      now: () => 1_000,
      fetchTipConfig,
    })

    expect(fetchTipConfig).toHaveBeenCalledWith('https://relay.example/v1/tip-config')
    expect(quote.totalBytes).toBeGreaterThan(55 * 1024 * 1024)
    expect(quote.relayTipMist).toBeGreaterThan(0n)
    expect(quote.items).toHaveLength(5)
    expect(quote.expiresAt).toBe(1_000 + WALRUS_UPLOAD_QUOTE_TTL_MS)
  })

  it('invalidates quotes when TTL, network, relay, file, or chunk plan changes', async () => {
    const plan = buildWalrusUploadPlan({
      files: [{ name: 'soul.md', size: 1024, encryptedSize: 1040 }],
      network: 'testnet',
      storageEpochs: 3,
      chunking: false,
      relayUrl: 'https://relay.example',
    })
    const quote = await quoteWalrusUpload(plan, {
      now: () => 10_000,
      fetchTipConfig: async () => ({ no_tip: true }),
    })

    expect(isWalrusUploadQuoteFresh(quote, plan, 10_500)).toBe(true)
    expect(isWalrusUploadQuoteFresh(quote, { ...plan, network: 'mainnet' }, 10_500)).toBe(false)
    expect(isWalrusUploadQuoteFresh(quote, { ...plan, relayUrl: 'https://other.example' }, 10_500)).toBe(false)
    expect(isWalrusUploadQuoteFresh(quote, { ...plan, files: [{ ...plan.files[0]!, payloadBytes: 2048 }] }, 10_500)).toBe(false)
    expect(isWalrusUploadQuoteFresh(quote, plan, quote.expiresAt + 1)).toBe(false)
  })

  it('keeps the browser upload helper off legacy server upload APIs', () => {
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')

    expect(source).toContain('quoteWalrusUpload')
    expect(source).not.toContain('/api/souls/upload')
    expect(source).not.toContain('/api/souls/upload/token')
    expect(source).not.toContain('/api/souls/upload/from-blob')
    expect(source).not.toContain('@vercel/blob/client')
    expect(source).not.toContain('sealDekEnvelope')
  })

  it('does not ask the relay tip quoter to enforce a zero tip ceiling', () => {
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')
    const quoteStart = source.indexOf('const quoteClient = await createWalrusClient')
    const quoteEnd = source.indexOf('const quote = await quoteWalrusUpload', quoteStart)
    const quoteClientBlock = source.slice(quoteStart, quoteEnd)

    expect(quoteStart).toBeGreaterThanOrEqual(0)
    expect(quoteEnd).toBeGreaterThan(quoteStart)
    expect(quoteClientBlock).not.toContain('maxRelayTipMist: 0n')
  })

  it('quotes relay tips without the SDK cached max-tip checker', () => {
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')
    const quoteStart = source.indexOf('const quote = await quoteWalrusUpload')
    const quoteEnd = source.indexOf('const approved = await params.confirmQuote', quoteStart)
    const quoteBlock = source.slice(quoteStart, quoteEnd)

    expect(quoteStart).toBeGreaterThanOrEqual(0)
    expect(quoteEnd).toBeGreaterThan(quoteStart)
    expect(quoteBlock).not.toContain('calculateUploadRelayTip')
  })

  it('clears the SDK upload relay tip cache before constructing Walrus clients', () => {
    const source = readFileSync('web/lib/upload/client-upload.ts', 'utf8')

    expect(source).toContain('upload-relay-tip-config')
    expect(source).toContain('cache.clear')
  })
})
