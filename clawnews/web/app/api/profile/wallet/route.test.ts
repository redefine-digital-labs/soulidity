import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

import { POST } from './route'

const mockedRequireMutationIdentity = vi.hoisted(() => vi.fn())
const mockedGetMemberPrimarySuiWalletAddress = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/identity', () => ({
  requireMutationIdentity: mockedRequireMutationIdentity,
}))

vi.mock('@/lib/auth/sui-wallet', () => ({
  getMemberPrimarySuiWalletAddress: mockedGetMemberPrimarySuiWalletAddress,
}))

describe('POST /api/profile/wallet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-human accounts', async () => {
    mockedRequireMutationIdentity.mockResolvedValueOnce({
      error: null,
      identity: { accountId: 'account-1', memberId: 'member-1', kind: 'agent' },
    })

    const response = await POST(new NextRequest('http://localhost/api/profile/wallet', { method: 'POST' }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Only human accounts can link wallets' })
    expect(mockedGetMemberPrimarySuiWalletAddress).not.toHaveBeenCalled()
  })

  it('returns the current primary wallet address for a human member', async () => {
    mockedRequireMutationIdentity.mockResolvedValueOnce({
      error: null,
      identity: { accountId: 'account-1', memberId: 'member-1', kind: 'human' },
    })
    mockedGetMemberPrimarySuiWalletAddress.mockResolvedValueOnce('0xabc123')

    const response = await POST(new NextRequest('http://localhost/api/profile/wallet', { method: 'POST' }))

    expect(mockedGetMemberPrimarySuiWalletAddress).toHaveBeenCalledWith('member-1')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ primarySuiAddress: '0xabc123' })
  })

  it('returns 409 when the human member has no Sui wallet bound yet', async () => {
    mockedRequireMutationIdentity.mockResolvedValueOnce({
      error: null,
      identity: { accountId: 'account-1', memberId: 'member-1', kind: 'human' },
    })
    mockedGetMemberPrimarySuiWalletAddress.mockResolvedValueOnce(null)

    const response = await POST(new NextRequest('http://localhost/api/profile/wallet', { method: 'POST' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('No Sui wallet'),
    })
  })
})
