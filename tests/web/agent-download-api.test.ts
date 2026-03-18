import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedResolveAgentByApiKey = vi.hoisted(() => vi.fn())
const mockedCreateSignedUrl = vi.hoisted(() => vi.fn())
const mockedWithX402 = vi.hoisted(() => vi.fn())
const mockedExtractPaymentIdentifier = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())

const mockedPrisma = vi.hoisted(() => ({
  entitlement: {
    findFirst: vi.fn(),
  },
  purchaseIntent: {
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  listing: {
    findFirst: vi.fn(),
  },
  walletBinding: {
    findFirst: vi.fn(),
  },
}))

vi.mock('@web/lib/auth/resolve-agent', () => ({
  resolveAgentByApiKey: mockedResolveAgentByApiKey,
}))

vi.mock('@web/lib/rate-limit', () => ({
  getRequestIp: vi.fn(() => '127.0.0.1'),
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@x402/extensions/payment-identifier', () => ({
  PAYMENT_IDENTIFIER: 'payment-identifier',
  declarePaymentIdentifierExtension: vi.fn(() => ({ required: true })),
  extractPaymentIdentifier: mockedExtractPaymentIdentifier,
}))

vi.mock('@web/lib/supabase/server', () => ({
  createSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        createSignedUrl: mockedCreateSignedUrl,
      }),
    },
  }),
}))

vi.mock('@web/lib/x402-server', () => ({
  x402Server: { name: 'mock-x402-server' },
}))

vi.mock('@web/lib/x402-next', () => ({
  withX402: mockedWithX402,
}))

describe('GET /api/agent/bundles/[bundleId]/download', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedWithX402.mockImplementation((handler: (request: Request) => Promise<Response>) => {
      return async (request: Request) => {
        if (request.headers.get('PAYMENT-SIGNATURE')) {
          return handler(request)
        }

        return new Response(JSON.stringify({ error: 'Payment required' }), {
          status: 402,
          headers: {
            'PAYMENT-REQUIRED': 'stub-payment-required',
            'content-type': 'application/json',
          },
        })
      }
    })
    mockedExtractPaymentIdentifier.mockReturnValue('payment-1')
    mockedTakeRateLimitToken.mockReturnValue({
      limited: false,
      retryAfterSeconds: 60,
    })
    mockedPrisma.purchaseIntent.findUnique.mockResolvedValue(null)
    mockedPrisma.purchaseIntent.create.mockResolvedValue({ id: 'intent-1' })
    mockedPrisma.purchaseIntent.updateMany.mockResolvedValue({ count: 0 })
  })

  it('returns a signed download URL when the owner already has entitlement', async () => {
    mockedResolveAgentByApiKey.mockResolvedValue({
      agentMemberId: 'agent-1',
      ownerMemberId: 'owner-1',
      accountId: 'account-1',
    })
    mockedPrisma.entitlement.findFirst.mockResolvedValue({
      bundle: {
        storageBucket: 'agent-bundles',
        storagePath: 'owner-1/bundle.zip',
        name: '../Research/Agent',
      },
    })
    mockedCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://storage.example/download.zip' },
      error: null,
    })

    const { GET } = await import('../../web/app/api/agent/bundles/[bundleId]/download/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/bundles/bundle-1/download', {
        headers: {
          authorization: 'Bearer sk-agent-secret',
        },
      }) as any,
      { params: Promise.resolve({ bundleId: 'bundle-1' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      downloadUrl: 'https://storage.example/download.zip',
      fileName: 'Research Agent.zip',
      expiresIn: 300,
    })
    expect(mockedWithX402).not.toHaveBeenCalled()
  })

  it('returns a 402 paywall when the owner lacks entitlement', async () => {
    mockedResolveAgentByApiKey.mockResolvedValue({
      agentMemberId: 'agent-1',
      ownerMemberId: 'owner-1',
      accountId: 'account-1',
    })
    mockedPrisma.entitlement.findFirst.mockResolvedValue(null)
    mockedPrisma.listing.findFirst.mockResolvedValue({
      priceUsdCents: 250,
      priceMist: 1_000_000_000n,
      bundle: {
        sellerId: 'seller-1',
        storageBucket: 'agent-bundles',
        storagePath: 'seller-1/bundle.zip',
        name: 'Research Agent',
      },
    })
    mockedPrisma.walletBinding.findFirst.mockResolvedValue({
      address: '11111111111111111111111111111111',
    })

    const { GET } = await import('../../web/app/api/agent/bundles/[bundleId]/download/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/bundles/bundle-1/download', {
        headers: {
          authorization: 'Bearer sk-agent-secret',
        },
      }) as any,
      { params: Promise.resolve({ bundleId: 'bundle-1' }) },
    )

    expect(response.status).toBe(402)
    expect(response.headers.get('PAYMENT-REQUIRED')).toBe('stub-payment-required')
    expect(mockedWithX402).toHaveBeenCalledTimes(1)
  })

  it('treats concurrent paymentRequestId creation as idempotent when purchase intent already exists', async () => {
    mockedResolveAgentByApiKey.mockResolvedValue({
      agentMemberId: 'agent-1',
      ownerMemberId: 'owner-1',
      accountId: 'account-1',
    })
    mockedPrisma.entitlement.findFirst.mockResolvedValue(null)
    mockedPrisma.listing.findFirst.mockResolvedValue({
      id: 'listing-1',
      priceUsdCents: 250,
      priceMist: 1_000_000_000n,
      bundle: {
        sellerId: 'seller-1',
        storageBucket: 'agent-bundles',
        storagePath: 'seller-1/bundle.zip',
        name: 'Research Agent',
      },
    })
    mockedPrisma.walletBinding.findFirst
      .mockResolvedValueOnce({ id: 'agent-wallet', address: 'agent-wallet-address' })
      .mockResolvedValueOnce({ address: 'seller-wallet-address' })
    mockedPrisma.purchaseIntent.findUnique.mockResolvedValue(null)
    mockedPrisma.purchaseIntent.create.mockRejectedValue({ code: 'P2002', meta: { target: ['payment_request_id'] } })
    mockedCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://storage.example/download.zip' },
      error: null,
    })

    const paymentPayload = Buffer.from(JSON.stringify({ x402Version: 2 })).toString('base64url')

    const { GET } = await import('../../web/app/api/agent/bundles/[bundleId]/download/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/bundles/bundle-1/download', {
        headers: {
          authorization: 'Bearer sk-agent-secret',
          'PAYMENT-SIGNATURE': paymentPayload,
        },
      }) as any,
      { params: Promise.resolve({ bundleId: 'bundle-1' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      downloadUrl: 'https://storage.example/download.zip',
      fileName: 'Research Agent.zip',
      expiresIn: 300,
    })
  })

  it('rejects requests without an API key', async () => {
    const { GET } = await import('../../web/app/api/agent/bundles/[bundleId]/download/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/bundles/bundle-1/download') as any,
      { params: Promise.resolve({ bundleId: 'bundle-1' }) },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('rate limits repeated invalid API key attempts', async () => {
    mockedResolveAgentByApiKey.mockResolvedValue(null)
    mockedTakeRateLimitToken.mockReturnValue({
      limited: true,
      retryAfterSeconds: 60,
    })

    const { GET } = await import('../../web/app/api/agent/bundles/[bundleId]/download/route.ts')
    const response = await GET(
      new Request('http://localhost/api/agent/bundles/bundle-1/download', {
        headers: {
          authorization: 'Bearer sk-invalid',
        },
      }) as any,
      { params: Promise.resolve({ bundleId: 'bundle-1' }) },
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    await expect(response.json()).resolves.toEqual({
      error: 'Too many invalid API key attempts',
    })
  })
})
