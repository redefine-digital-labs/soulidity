import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('follow status regression guards', () => {
  it('loads chain follow state with the wallet and release scoped cache, without owned follow APIs', () => {
    const source = readSource('web/lib/hooks/use-social.ts')
    const hook = readSource('web/lib/hooks/use-wallet-follow.ts')
    expect(source).not.toContain('/api/community/follow')
    expect(hook).not.toContain('getAuthHeaders')
    expect(hook).toContain("['follow-status', config?.deployment ?? null, targetId, owner]")
    expect(hook).toContain('readWalletFollowState({ client: suiGrpcClient')
    expect(hook).toContain('targetProfileId: targetId, viewerAddress: walletAddress, signal')
  })

  it('reads community profile follow stats from the canonical member id', () => {
    const source = readSource('web/app/community/u/[spaceId]/page.tsx')

    expect(source).toContain('const targetId = profile?.id ??')
    expect(source).toContain('/^0x[0-9a-f]{64}$/.test(spaceId)')
    expect(source).toContain('!/^0x0+$/.test(spaceId) ? spaceId : null')
    expect(source).toContain('useFollowStatus(targetId)')
    expect(source).not.toContain('const { data: followData } = useFollowStatus(spaceId)')
    expect(source).toContain('<FollowButton targetMemberId={targetId} />')
  })

  it('refreshes the viewer-scoped chain state after confirmed outcomes, never optimistic cache patches', () => {
    const source = readSource('web/lib/hooks/use-wallet-follow.ts')
    expect(source).toContain("result.phase === 'SUCCEEDED' || result.phase === 'FAILED'")
    expect(source).toContain('invalidateQueries({ queryKey: queryKey(targetId, walletAddress) })')
    expect(source).not.toContain('setQueryData')
    expect(readSource('web/components/community/follow-button.tsx')).not.toContain('optimistic')
  })
})
