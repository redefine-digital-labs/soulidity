import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

/**
 * Regression locks for the "grant::issue narrows scope" class of bug:
 *
 *   grant::issue REPLACES an existing grantee's slot wholesale with the
 *   new scope_mask. If any Authorize entry point issues with the bare
 *   single-bit `kindScopeMask` for an agent who already holds other
 *   scopes, the supersede silently NARROWS them. Auto-grant on sprite
 *   upload (c1e3ab5) already merges via the plan endpoint, but three
 *   other entry points used to issue with the single-bit mask:
 *
 *     - banner: web/components/souls/agent-grant-recommendations.tsx
 *     - pet batch: web/app/account/pets/_components/PetGrantDialog.tsx
 *     - manual form: web/app/souls/[id]/page.tsx (GrantsPanel)
 *
 *   Plus the related Issue 2: owner's first sprite upload would skip
 *   set-active if the user unchecked the box, leaving the desktop
 *   catalog with no active binding → no download button.
 *
 *   These tests lock the fix in place: banner reads desiredScopeMask
 *   from the plan response, pet/form preflight /grant-merge-masks and
 *   issue with mergedScopeMask, and sprite-first-upload forces
 *   setActive regardless of the checkbox.
 */

describe('agent-grant-recommendations banner', () => {
  it('issues with the plan-returned desiredScopeMask, not the single-bit kindScopeMask', () => {
    const source = readSource('web/components/souls/agent-grant-recommendations.tsx')

    // Type: target carries desiredScopeMask
    expect(source).toMatch(/desiredScopeMask:\s*number/)
    // Call site: issueGrant uses target.desiredScopeMask
    expect(source).toContain('await grant.issueGrant(target.address, null, target.desiredScopeMask)')
    // Regression guard: the previous single-bit form must NOT come back
    expect(source).not.toContain('await grant.issueGrant(target.address, null, kindScopeMask)')
  })
})

describe('PetGrantDialog batch issue', () => {
  it('preflights /api/souls/grant-merge-masks and issues with per-item mergedScopeMask', () => {
    const source = readSource('web/app/account/pets/_components/PetGrantDialog.tsx')

    expect(source).toContain("'/api/souls/grant-merge-masks'")
    expect(source).toContain('addedScopeMask: SOUL_GRANT_SCOPE_ASSETS')
    expect(source).toContain('mergedMaskByItem.set(m.soulOnChainId, m.mergedScopeMask)')
    expect(source).toContain('mergedMaskByItem.get(item.soulOnChainId) ?? SOUL_GRANT_SCOPE_ASSETS')

    // The bare single-bit scope on every batch row must be gone.
    expect(source).not.toContain('scopeMask: SOUL_GRANT_SCOPE_ASSETS,\n                // Lifetime')
  })
})

describe('GrantsPanel manual Authorize form', () => {
  it('exposes an Assets (sprite & audio) scope checkbox', () => {
    const source = readSource('web/app/souls/[id]/page.tsx')

    expect(source).toContain("id: 'assets' as const")
    expect(source).toContain("title: 'Sprite & Audio'")
    expect(source).toContain('setAssetsScope')
    // scopeMask formula includes the SOUL_GRANT_SCOPE_ASSETS bit
    expect(source).toMatch(/assetsScope \? SOUL_GRANT_SCOPE_ASSETS : 0/)
  })

  it('preflights /api/souls/grant-merge-masks and issues with merged mask', () => {
    const source = readSource('web/app/souls/[id]/page.tsx')

    expect(source).toContain("'/api/souls/grant-merge-masks'")
    expect(source).toContain('addedScopeMask: scopeMask')
    expect(source).toContain('await issueGrant(addr, null, mergedScopeMask)')
    // The pre-fix path issued with raw scopeMask. That must not return.
    expect(source).not.toContain('await issueGrant(addr, null, scopeMask)')
  })
})

describe('sprite first-upload set-active', () => {
  it('forces effectiveSetActive when owner uploads first sprite without active binding', () => {
    const source = readSource('web/lib/hooks/use-soul-content-actions.ts')

    // The override logic exists and uses kind + role + activeSpriteName as guard.
    expect(source).toContain('ownerFirstSpriteForcesActive')
    expect(source).toContain('params.kind === KIND_SPRITE')
    expect(source).toContain("role === 'owner'")
    expect(source).toContain('!soul.activeSpriteName')
    expect(source).toContain('const effectiveSetActive = Boolean(params.setActive) || ownerFirstSpriteForcesActive')

    // All three callers (PTB splice, pending record, postSync) read effectiveSetActive,
    // not params.setActive (would re-introduce the bug if reverted).
    expect(source).toContain('if (effectiveSetActive) {')
    expect(source).toContain('setActive: effectiveSetActive,')
    // No remaining `if (params.setActive) {` blocks for sprite owner branch
    // (the replay path is separate and gated on rec.sprite.setActive which
    // is itself set to effectiveSetActive at persist-time).
    const occurrencesOfParamsSetActive = source.match(/if \(params\.setActive\)/g)?.length ?? 0
    expect(occurrencesOfParamsSetActive).toBe(0)
  })
})
