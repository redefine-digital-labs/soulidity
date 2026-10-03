import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function source(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('Soul detail grant panel source contract', () => {
  it('issues Skills & Docs grants with both skills and Seal document scopes', () => {
    const page = source('web/app/souls/[id]/page.tsx')

    expect(page).toContain('SOUL_GRANT_SCOPE_SKILLS | SOUL_GRANT_SCOPE_SEAL')
    expect(page).not.toContain("scope === 'skills' ? SOUL_GRANT_SCOPE_SKILLS : SOUL_GRANT_SCOPE_MEMORY")
  })

  it('does not describe reassignment as atomic and invalidates every viewer variant', () => {
    const page = source('web/app/souls/[id]/page.tsx')

    expect(page).not.toContain('existing grant will be revoked atomically')
    expect(page).toContain("queryClient.invalidateQueries({ queryKey: ['soul', detailQueryId] })")
  })

  it('adds or updates grants without auto-revoking an arbitrary active grantee', () => {
    const page = source('web/app/souls/[id]/page.tsx')

    expect(page).not.toContain('const activeGrant = soul.activeGrants[0] ?? null')
    expect(page).toContain('findActiveGrantForAddress(soul.activeGrants, trimmedAgentAddress)')
    expect(page).toContain('BigInt(soul.activeGrantCount) >= BigInt(soul.grantCapacity)')
    // Display is only a hint; the raw-chain plan binds capacity/count/slot
    // snapshots and merges live scopes before signing the atomic operation.
    expect(page).toContain('will be raised automatically for a new grantee')
    expect(page).not.toContain('Capacity full. Revoke an existing grantee before authorizing a new one.')
    expect(page).not.toContain('await revokeGrant(existing.granteeAddress)')
    expect(page).not.toContain('Reassigning revokes the current grant first')
  })

  it('does not render an enabled no-op grantee agent-session CTA', () => {
    const page = source('web/app/souls/[id]/page.tsx')

    expect(page).not.toContain('Open agent session')
  })

  it('wires memory decrypt through content actions instead of a disabled placeholder', () => {
    const page = source('web/app/souls/[id]/page.tsx')

    expect(page).toContain('actions.decryptContentVersion(entry)')
    expect(page).toContain("title={canDecrypt ? undefined : 'No observed read access'}")
    expect(page).not.toContain('Memory decrypt flow not yet wired')
    expect(page).not.toContain('Decrypt unavailable')
  })
})
