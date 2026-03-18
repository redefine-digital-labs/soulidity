import bs58 from 'bs58'
import nacl from 'tweetnacl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedResolveIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())

const mockedPrisma = vi.hoisted(() => ({
  walletBinding: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  },
}))

vi.mock('@web/lib/auth/identity', () => ({
  resolveIdentity: mockedResolveIdentity,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

describe('wallet bind Solana support', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedResolveIdentity.mockResolvedValue({
      accountId: 'account-1',
      memberId: 'agent-1',
      kind: 'agent',
    })
    mockedTakeRateLimitToken.mockReturnValue({
      limited: false,
      retryAfterSeconds: 3600,
    })
  })

  it('creates a Solana-specific challenge message', async () => {
    const { POST } = await import('../../web/app/api/wallet/bind/challenge/route.ts')
    const response = await POST(
      new Request('http://localhost/api/wallet/bind/challenge', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ chain: 'solana' }),
      }) as any,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        message: expect.stringContaining('Solana wallet'),
      }),
    )
  })

  it('rate limits wallet bind challenge creation', async () => {
    mockedTakeRateLimitToken.mockReturnValue({
      limited: true,
      retryAfterSeconds: 3600,
    })

    const { POST } = await import('../../web/app/api/wallet/bind/challenge/route.ts')
    const response = await POST(
      new Request('http://localhost/api/wallet/bind/challenge', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ chain: 'solana' }),
      }) as any,
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('3600')
  })

  it('verifies a Solana Ed25519 signature and stores a Solana wallet binding', async () => {
    const keypair = nacl.sign.keyPair()
    const address = bs58.encode(keypair.publicKey)
    const nonce = 'nonce-1'
    const message = `Sign this message to bind your Solana wallet to CryptoOpenClaw.\n\nAccount: agent-1\nNonce: ${nonce}`
    const signature = bs58.encode(
      nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey),
    )

    mockedPrisma.walletBinding.findUnique.mockResolvedValue(null)
    mockedPrisma.walletBinding.updateMany.mockResolvedValue({ count: 0 })
    mockedPrisma.walletBinding.create.mockResolvedValue({
      id: 'binding-1',
      chain: 'solana',
      address,
      isPrimary: true,
    })

    const { POST } = await import('../../web/app/api/wallet/bind/confirm/route.ts')
    const response = await POST({
      json: async () => ({
        chain: 'solana',
        nonce,
        signature,
        address,
      }),
      cookies: {
        get: (name: string) => {
          if (name === 'wallet-bind-nonce') {
            return { value: nonce }
          }
          if (name === 'wallet-bind-chain') {
            return { value: 'solana' }
          }
          return undefined
        },
      },
    } as any)

    expect(response.status).toBe(200)
    expect(mockedPrisma.walletBinding.create).toHaveBeenCalledWith({
      data: {
        memberId: 'agent-1',
        chain: 'solana',
        address,
        isPrimary: true,
      },
    })
  })

  it('rate limits wallet bind confirm attempts', async () => {
    mockedTakeRateLimitToken.mockReturnValue({
      limited: true,
      retryAfterSeconds: 3600,
    })

    const { POST } = await import('../../web/app/api/wallet/bind/confirm/route.ts')
    const response = await POST({
      json: async () => ({
        chain: 'solana',
        nonce: 'nonce-1',
        signature: 'sig',
        address: 'addr',
      }),
      cookies: {
        get: () => undefined,
      },
    } as any)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('3600')
  })
})
