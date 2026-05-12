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
    // R-001: each preflight item now drives both the mergedScopeMask AND
    // the per-Soul `setCapacityTo` bump. The accumulator stores a
    // `PreflightDecision` so the bump survives chunking and is read out
    // when the batch builder runs.
    expect(source).toContain('decisionBySoul.set(m.soulOnChainId,')
    expect(source).toContain('mergedScopeMask: m.mergedScopeMask')
    expect(source).toContain('decisionBySoul.get(item.soulOnChainId)')
    expect(source).toContain('scopeMask: decision?.mergedScopeMask ?? SOUL_GRANT_SCOPE_ASSETS')

    // The bare single-bit scope on every batch row must be gone.
    expect(source).not.toContain('scopeMask: SOUL_GRANT_SCOPE_ASSETS,\n                // Lifetime')
  })

  // ── R-002: preflight is chunked to honor the 100-item endpoint cap ──
  it('chunks the merge preflight at MERGE_PREFLIGHT_BATCH_SIZE so >100 Souls do not 400', () => {
    const source = readSource('web/app/account/pets/_components/PetGrantDialog.tsx')

    // Constant must be declared and used to drive the chunking.
    expect(source).toMatch(/const MERGE_PREFLIGHT_BATCH_SIZE = 100\b/)
    expect(source).toContain('chunk(selectedItems, MERGE_PREFLIGHT_BATCH_SIZE)')

    // The preflight `fetch` must live inside a `for ... of preflightChunks`
    // loop, not a single un-chunked call.
    expect(source).toMatch(
      /for \(const preflightBatch of preflightChunks\)[\s\S]+?fetch\('\/api\/souls\/grant-merge-masks'/,
    )

    // Per-soul decisions (merged scope + capacity bump) must accumulate
    // across chunks (Map kept outside the loop).
    expect(source).toContain('const decisionBySoul = new Map<string, PreflightDecision>()')
  })

  // ── R-001: preflight capacity contract is honored in the batch PTB ──
  it('splices set_grant_capacity into the batch when requiredCapacity > currentCapacity', () => {
    const source = readSource('web/app/account/pets/_components/PetGrantDialog.tsx')

    // Per-soul decision carries both fields.
    expect(source).toMatch(/interface PreflightDecision \{[\s\S]+?mergedScopeMask:\s*number[\s\S]+?setCapacityTo:\s*number \| null[\s\S]+?\}/)
    // setCapacityTo is null when no bump is needed, requiredCapacity otherwise.
    expect(source).toContain('setCapacityTo:\n                m.requiredCapacity > m.currentCapacity ? m.requiredCapacity : null,')
    // buildBatchIssueGrantsTx is called with per-item setCapacityTo so the
    // PTB splices `grant::set_grant_capacity` before `grant::issue` for
    // any Soul that needs it.
    expect(source).toContain('setCapacityTo: decision?.setCapacityTo ?? null,')
  })

  // ── R-001: fail-fast when a Soul would exceed MAX_GRANT_CAPACITY ──
  it('aborts before signing if any Soul would exceed MAX_GRANT_CAPACITY', () => {
    const source = readSource('web/app/account/pets/_components/PetGrantDialog.tsx')

    expect(source).toContain("import {")
    expect(source).toContain('MAX_GRANT_CAPACITY,')
    // Throw before any `signAndExecute` call so the wallet never sees a
    // PTB that would abort on-chain.
    expect(source).toMatch(/m\.isNewGrantee && m\.requiredCapacity > MAX_GRANT_CAPACITY/)
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
    expect(source).toContain('await issueGrant(addr, null, mergedScopeMask, { setCapacityTo })')
    // The pre-fix path issued with raw scopeMask. That must not return.
    expect(source).not.toContain('await issueGrant(addr, null, scopeMask)')
  })

  // ── R-001: preflight isNewGrantee + requiredCapacity govern the gate ──
  it('honors the preflight requiredCapacity contract before signing', () => {
    const source = readSource('web/app/souls/[id]/page.tsx')

    // The hard mirror-only block is gone — preflight is authoritative.
    // (Chain-only existing grants would otherwise be misclassified as
    // "capacity full new grantee" by the local mirror.)
    expect(source).not.toMatch(/if \(capacityFullForNewGrantee\) \{[\s\S]+?return\s*$/m)

    // Preflight fields used: isNewGrantee, currentCapacity, requiredCapacity.
    expect(source).toContain('isNewGrantee: boolean')
    expect(source).toContain('currentCapacity: number')
    expect(source).toContain('requiredCapacity: number')

    // Capacity bump is derived from preflight, not from local mirror.
    expect(source).toContain('const setCapacityTo = requiredCapacity > currentCapacity ? requiredCapacity : null')

    // Fail-fast when the bump would exceed the on-chain ceiling.
    expect(source).toContain('isNewGrantee && requiredCapacity > MAX_GRANT_CAPACITY')

    // Disable state no longer references the stale-mirror block flag.
    expect(source).not.toMatch(/disabled=\{[\s\S]+?capacityFullForNewGrantee[\s\S]+?\}/)
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
