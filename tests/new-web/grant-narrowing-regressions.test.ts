import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

// Wiring complements real domain, original-page, recommendation and append-hook
// behavior tests. Pet retains its separate private batch flow below.
describe('human grant cutover wiring', () => {
  it('uses private discovery only for addresses and delegates merge/capacity to the raw-chain operation', () => {
    const banner = readSource('web/components/souls/agent-grant-recommendations.tsx')
    expect(banner).toContain('auto-grant-targets?scopeMask=${kindScopeMask}')
    expect(banner).toContain('readBrowserContentWriteState')
    expect(banner).not.toContain('body.currentCapacity')
    expect(banner).not.toContain('target.desiredScopeMask')
    const hook = readSource('web/lib/hooks/use-grant.ts')
    expect(hook).toContain("access.mutate({ action: 'grant-issue'")
    expect(hook).not.toContain('fetch(')
  })
  it('preserves Assets selection without a mirror capacity signing gate', () => {
    const page = readSource('web/app/souls/[id]/page.tsx')
    expect(page).toContain("id: 'assets' as const")
    expect(page).toContain("title: 'Sprite & Audio'")
    expect(page).toContain('assetsScope ? SOUL_GRANT_SCOPE_ASSETS : 0')
    expect(page).toContain('await issueGrant(addr, expiry, scopeMask)')
    expect(page).not.toContain('/api/souls/grant-merge-masks')
    expect(page).not.toMatch(/disabled=\{[^}]*mirrorLooksFullForNewGrantee/)
  })
  it('retains first-Sprite activation in the browser append intent, not a removed sync payload', () => {
    const append = readSource('web/lib/hooks/use-soul-content-append.ts')
    expect(append).toContain("setActive: role === 'owner' && params.kind === KIND_SPRITE")
    expect(append).toContain('Boolean(params.setActive) || !state.activeBindings.some(b => b.kind === KIND_SPRITE)')
    expect(append).not.toContain('/content/sync')
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
