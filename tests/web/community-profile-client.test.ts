import { describe, expect, it, vi } from 'vitest'

import {
  COMMUNITY_PROFILE_LOAD_ERROR,
  loadCommunityProfile,
} from '../../web/lib/community/profile-client.ts'

describe('loadCommunityProfile', () => {
  it('returns not-found for 404 responses', async () => {
    const getAuthHeaders = vi.fn().mockResolvedValue({ Authorization: 'Bearer test' })
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))

    await expect(
      loadCommunityProfile('member-1', getAuthHeaders, fetchImpl),
    ).resolves.toEqual({ kind: 'not-found' })
    expect(fetchImpl).toHaveBeenCalledWith('/api/community/profile/member-1', {
      headers: { Authorization: 'Bearer test' },
    })
  })

  it('returns a stable error result when auth headers fail', async () => {
    const getAuthHeaders = vi.fn().mockRejectedValue(new Error('token unavailable'))
    const fetchImpl = vi.fn()

    await expect(
      loadCommunityProfile('member-1', getAuthHeaders, fetchImpl),
    ).resolves.toEqual({
      kind: 'error',
      message: COMMUNITY_PROFILE_LOAD_ERROR,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns a stable error result when fetch rejects', async () => {
    const getAuthHeaders = vi.fn().mockResolvedValue({})
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'))

    await expect(
      loadCommunityProfile('member-1', getAuthHeaders, fetchImpl),
    ).resolves.toEqual({
      kind: 'error',
      message: COMMUNITY_PROFILE_LOAD_ERROR,
    })
  })
})
