import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('follow status regression guards', () => {
  it('loads follow status with auth headers when available', () => {
    const source = readSource('web/lib/hooks/use-social.ts')
    const useFollowStatusBlock = source.match(/export function useFollowStatus[\s\S]*?\n}\n/)?.[0]

    expect(useFollowStatusBlock).toBeTruthy()
    expect(useFollowStatusBlock).toContain('const { user, getAuthHeaders } = useAuth()')
    expect(useFollowStatusBlock).toContain("queryKey: ['follow-status', memberId, user?.id ?? null]")
    expect(useFollowStatusBlock).toContain("const headers = await getAuthHeaders().catch(() => ({}))")
    expect(useFollowStatusBlock).toContain("cache: 'no-store'")
    expect(useFollowStatusBlock).toContain('headers,')
  })

  it('reads community profile follow stats from the canonical member id', () => {
    const source = readSource('web/app/community/u/[spaceId]/page.tsx')

    expect(source).toContain('useFollowStatus(profile?.id ?? null)')
    expect(source).not.toContain('const { data: followData } = useFollowStatus(spaceId)')
    expect(source).toContain('<FollowButton targetMemberId={profile.id} />')
  })

  it('updates the viewer-scoped follow cache after toggling', () => {
    const source = readSource('web/lib/hooks/use-social.ts')
    const useToggleFollowBlock = source.match(/export function useToggleFollow[\s\S]*?\n}\n\n\/\/ ── Bookmark hooks ──/)?.[0]

    expect(useToggleFollowBlock).toBeTruthy()
    expect(useToggleFollowBlock).toContain('const { user, getAuthHeaders } = useAuth()')
    expect(useToggleFollowBlock).toContain("const followStatusKey = ['follow-status', targetMemberId, user?.id ?? null] as const")
    expect(useToggleFollowBlock).toContain('setQueryData<FollowStatus>(followStatusKey')
    expect(useToggleFollowBlock).toContain('invalidateQueries({ queryKey: followStatusKey })')
  })
})
