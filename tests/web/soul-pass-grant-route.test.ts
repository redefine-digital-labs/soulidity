import { beforeEach, describe, expect, it, vi } from 'vitest'

const CANONICAL_AGENT = `0x${'0'.repeat(61)}abc`
const OTHER_AGENT = `0x${'0'.repeat(61)}def`
const OWNER_ADDRESS = `0x${'1'.repeat(64)}`

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulPassSnapshot: { findFirst: vi.fn() },
  member: { findUnique: vi.fn() },
}))
const mockedDbSetAgentGrant = vi.hoisted(() => vi.fn())
const mockedDbRevokeAgentGrant = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulTxSync = vi.hoisted(() => vi.fn())
const mockedSuiClient = vi.hoisted(() => ({
  getTransactionBlock: vi.fn(),
  getObject: vi.fn(),
}))

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/souls/post-tx-db', () => ({
  dbSetAgentGrant: mockedDbSetAgentGrant,
  dbRevokeAgentGrant: mockedDbRevokeAgentGrant,
}))

vi.mock('@web/lib/souls/tx-sync', () => ({
  getStoredSoulTxSync: mockedGetStoredSoulTxSync,
  storeSoulTxSync: mockedStoreSoulTxSync,
}))

vi.mock('@web/lib/sui', () => ({
  suiClient: mockedSuiClient,
}))

describe('soul pass grant route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'member-1', kind: 'human' },
    })
    mockedTakeRateLimitToken.mockReturnValue({ limited: false, retryAfterSeconds: 60 })
    mockedPrisma.soulPassSnapshot.findFirst.mockResolvedValue({
      id: 'pass-db-1',
      onChainId: '0xpass',
      ownerMemberId: 'member-1',
    })
    mockedPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      wallet: OWNER_ADDRESS,
      walletBindings: [{ address: OWNER_ADDRESS, chain: 'sui' }],
    })
    mockedSuiClient.getTransactionBlock.mockResolvedValue({
      digest: '0xtx',
      effects: { status: { status: 'success' } },
      objectChanges: [
        {
          type: 'mutated',
          objectId: '0xpass',
          objectType: '0xpackage::pass::PerpetualPass',
          sender: OWNER_ADDRESS,
          owner: { AddressOwner: OWNER_ADDRESS },
          previousVersion: '1',
          version: '2',
        },
      ],
    })
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xpass',
        type: '0xpackage::pass::PerpetualPass',
        owner: { AddressOwner: OWNER_ADDRESS },
        content: {
          dataType: 'moveObject',
          type: '0xpackage::pass::PerpetualPass',
          fields: {
            series_id: '0xseries',
            release_id: '0xrelease',
            owner: OWNER_ADDRESS,
            agent_grant: { vec: [] },
          },
        },
      },
    })
    mockedGetStoredSoulTxSync.mockResolvedValue(null)
    mockedStoreSoulTxSync.mockResolvedValue(undefined)
  })

  it('rate limits grant mirroring before fetching the pass', async () => {
    mockedTakeRateLimitToken.mockReturnValueOnce({ limited: true, retryAfterSeconds: 45 })

    const { POST } = await import('../../web/app/api/souls/passes/[passId]/grant/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/passes/0xpass/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentAddress: '0xabc', txDigest: '0xtx' }),
      }) as any,
      { params: Promise.resolve({ passId: '0xpass' }) },
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('45')
    await expect(response.json()).resolves.toEqual({
      error: 'Too many grant sync requests, try again later',
    })
    expect(mockedPrisma.soulPassSnapshot.findFirst).not.toHaveBeenCalled()
  })

  it('requires txDigest when setting an agent grant mirror', async () => {
    const { POST } = await import('../../web/app/api/souls/passes/[passId]/grant/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/passes/0xpass/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentAddress: OTHER_AGENT }),
      }) as any,
      { params: Promise.resolve({ passId: '0xpass' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'txDigest is required',
    })
    expect(mockedDbSetAgentGrant).not.toHaveBeenCalled()
  })

  it('only looks up active passes when mirroring grant changes', async () => {
    const { POST } = await import('../../web/app/api/souls/passes/[passId]/grant/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/passes/0xpass/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentAddress: '0xabc', txDigest: '0xtx' }),
      }) as any,
      { params: Promise.resolve({ passId: '0xpass' }) },
    )

    expect(response.status).toBe(422)
    expect(mockedPrisma.soulPassSnapshot.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ id: '0xpass' }, { onChainId: '0xpass' }],
        ownerMemberId: 'member-1',
        status: 'active',
      },
    })
  })

  it('rejects grant mirroring when the verified on-chain pass state does not match the requested agent', async () => {
    const { POST } = await import('../../web/app/api/souls/passes/[passId]/grant/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/passes/0xpass/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentAddress: OTHER_AGENT, txDigest: '0xtx' }),
      }) as any,
      { params: Promise.resolve({ passId: '0xpass' }) },
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: 'On-chain pass grant does not match the requested agent',
    })
    expect(mockedDbSetAgentGrant).not.toHaveBeenCalled()
  })

  it('accepts a short-form agent address when it matches the canonical on-chain grant', async () => {
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xpass',
        type: '0xpackage::pass::PerpetualPass',
        owner: { AddressOwner: OWNER_ADDRESS },
        content: {
          dataType: 'moveObject',
          type: '0xpackage::pass::PerpetualPass',
          fields: {
            series_id: '0xseries',
            release_id: '0xrelease',
            owner: OWNER_ADDRESS,
            agent_grant: { vec: [CANONICAL_AGENT] },
          },
        },
      },
    })

    const { POST } = await import('../../web/app/api/souls/passes/[passId]/grant/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/passes/0xpass/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentAddress: '0xabc', txDigest: '0xtx' }),
      }) as any,
      { params: Promise.resolve({ passId: '0xpass' }) },
    )

    expect(response.status).toBe(200)
    expect(mockedDbSetAgentGrant).toHaveBeenCalledWith({
      passOnChainId: '0xpass',
      agentAddress: CANONICAL_AGENT,
    })
  })

  it('rejects malformed agent addresses before checking on-chain state', async () => {
    const { POST } = await import('../../web/app/api/souls/passes/[passId]/grant/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/passes/0xpass/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentAddress: 'not-a-wallet', txDigest: '0xtx' }),
      }) as any,
      { params: Promise.resolve({ passId: '0xpass' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'agentAddress must be a valid Sui address',
    })
    expect(mockedSuiClient.getTransactionBlock).not.toHaveBeenCalled()
  })

  it('replays the stored grant response for an already-processed txDigest', async () => {
    mockedGetStoredSoulTxSync.mockResolvedValue({
      statusCode: 200,
      body: {
        ok: true,
        agentGrant: CANONICAL_AGENT,
      },
    })

    const { POST } = await import('../../web/app/api/souls/passes/[passId]/grant/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/passes/0xpass/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentAddress: '0xabc', txDigest: '0xtx' }),
      }) as any,
      { params: Promise.resolve({ passId: '0xpass' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      agentGrant: CANONICAL_AGENT,
    })
    expect(mockedSuiClient.getTransactionBlock).not.toHaveBeenCalled()
    expect(mockedDbSetAgentGrant).not.toHaveBeenCalled()
  })

  it('requires txDigest when revoking an agent grant mirror', async () => {
    const { DELETE } = await import('../../web/app/api/souls/passes/[passId]/grant/route.ts')
    const response = await DELETE(
      new Request('http://localhost/api/souls/passes/0xpass/grant', {
        method: 'DELETE',
      }) as any,
      { params: Promise.resolve({ passId: '0xpass' }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'txDigest is required',
    })
    expect(mockedDbRevokeAgentGrant).not.toHaveBeenCalled()
  })

  it('rate limits revoke mirroring before fetching the pass', async () => {
    mockedTakeRateLimitToken.mockReturnValueOnce({ limited: true, retryAfterSeconds: 30 })

    const { DELETE } = await import('../../web/app/api/souls/passes/[passId]/grant/route.ts')
    const response = await DELETE(
      new Request('http://localhost/api/souls/passes/0xpass/grant', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: '0xtx' }),
      }) as any,
      { params: Promise.resolve({ passId: '0xpass' }) },
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('30')
    await expect(response.json()).resolves.toEqual({
      error: 'Too many grant sync requests, try again later',
    })
    expect(mockedPrisma.soulPassSnapshot.findFirst).not.toHaveBeenCalled()
  })

  it('replays the stored revoke response for an already-processed txDigest', async () => {
    mockedGetStoredSoulTxSync.mockResolvedValue({
      statusCode: 200,
      body: { ok: true },
    })

    const { DELETE } = await import('../../web/app/api/souls/passes/[passId]/grant/route.ts')
    const response = await DELETE(
      new Request('http://localhost/api/souls/passes/0xpass/grant', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txDigest: '0xtx' }),
      }) as any,
      { params: Promise.resolve({ passId: '0xpass' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true })
    expect(mockedSuiClient.getTransactionBlock).not.toHaveBeenCalled()
    expect(mockedDbRevokeAgentGrant).not.toHaveBeenCalled()
  })
})
