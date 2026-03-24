export const COMMUNITY_PROFILE_LOAD_ERROR = '加载资料失败，请稍后重试'

export type CommunityProfileLoadResult<T> =
  | { kind: 'ok'; profile: T }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }

export async function loadCommunityProfile<T>(
  memberId: string,
  getAuthHeaders: () => Promise<Record<string, string>>,
  fetchImpl: typeof fetch = fetch,
): Promise<CommunityProfileLoadResult<T>> {
  try {
    const headers = await getAuthHeaders()
    const response = await fetchImpl(`/api/community/profile/${memberId}`, { headers })

    if (response.status === 404) {
      return { kind: 'not-found' }
    }

    if (!response.ok) {
      return { kind: 'error', message: COMMUNITY_PROFILE_LOAD_ERROR }
    }

    return {
      kind: 'ok',
      profile: await response.json() as T,
    }
  } catch {
    return { kind: 'error', message: COMMUNITY_PROFILE_LOAD_ERROR }
  }
}
