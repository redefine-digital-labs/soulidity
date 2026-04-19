import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

import { POST } from './route'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedSyncHumanMemberSuiWallet = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
  syncHumanMemberSuiWallet: mockedSyncHumanMemberSuiWallet,
}))

describe('POST /api/profile/wallet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-human accounts', async () => {
    mockedRequireIdentity.mockResolvedValueOnce({
      error: null,
      identity: { accountId: 'account-1', memberId: 'member-1', kind: 'agent' },
    })

    const response = await POST(new NextRequest('http://localhost/api/profile/wallet', { method: 'POST' }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Only human accounts can link wallets' })
    expect(mockedSyncHumanMemberSuiWallet).not.toHaveBeenCalled()
  })

  it('syncs the current human member wallet and returns the primary address', async () => {
    mockedRequireIdentity.mockResolvedValueOnce({
      error: null,
      identity: { accountId: 'account-1', memberId: 'member-1', kind: 'human' },
    })
    mockedSyncHumanMemberSuiWallet.mockResolvedValueOnce('0xabc123')

    const response = await POST(new NextRequest('http://localhost/api/profile/wallet', { method: 'POST' }))

    expect(mockedSyncHumanMemberSuiWallet).toHaveBeenCalledWith('account-1', 'member-1')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ primarySuiAddress: '0xabc123' })
  })
})
