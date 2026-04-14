import { generateKeyPairSync } from 'node:crypto'
import { importSPKI, jwtVerify } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireDesktopIdentity = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  account: {
    findUnique: vi.fn(),
  },
}))
const mockedPrivy = vi.hoisted(() => ({
  getUserByCustomAuthId: vi.fn(),
}))

vi.mock('@web/lib/desktop/auth', () => ({
  requireDesktopIdentity: mockedRequireDesktopIdentity,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/auth/privy', () => ({
  privy: mockedPrivy,
}))

describe('POST /api/desktop/auth/privy-token', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    process.env.PRIVY_CUSTOM_AUTH_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    process.env.PRIVY_CUSTOM_AUTH_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    process.env.NEXT_PUBLIC_PRIVY_APP_ID = 'privy-app-123'

    mockedRequireDesktopIdentity.mockResolvedValue({ accountId: 'account-123' })
    mockedPrisma.account.findUnique.mockResolvedValue({
      id: 'account-123',
      privyDid: 'did:privy:existing-user',
    })
    mockedPrivy.getUserByCustomAuthId.mockResolvedValue({
      id: 'did:privy:existing-user',
    })
  })

  it('returns a short-lived signed custom auth JWT for the linked desktop account', async () => {
    const { POST } = await import('../../web/app/api/desktop/auth/privy-token/route.ts')
    const response = await POST(new Request('http://localhost/api/desktop/auth/privy-token', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer dtk_desktop-token',
      },
    }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.alreadyLinked).toBe(true)
    expect(typeof body.jwt).toBe('string')

    const verificationKey = await importSPKI(process.env.PRIVY_CUSTOM_AUTH_PUBLIC_KEY_PEM!, 'ES256')
    const verified = await jwtVerify(body.jwt, verificationKey, {
      algorithms: ['ES256'],
    })

    expect(verified.payload.sub).toBe('account-123')
    expect(verified.payload.aud).toBe('privy-app-123')
    expect(verified.payload.scope).toBe('desktop-create')
  })

  it('returns 409 when the desktop account is not linked to the same Privy user yet', async () => {
    mockedPrivy.getUserByCustomAuthId.mockResolvedValueOnce(null)

    const { POST } = await import('../../web/app/api/desktop/auth/privy-token/route.ts')
    const response = await POST(new Request('http://localhost/api/desktop/auth/privy-token', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer dtk_desktop-token',
      },
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Desktop wallet auth is not linked yet. Re-link this device from the web app first.',
    })
  })
})
