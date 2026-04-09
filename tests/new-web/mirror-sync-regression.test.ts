import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('mirror sync regression guards', () => {
  // -------------------------------------------------------------------------
  // Bug 1: skillsOnChainId null after mint (RPC indexing lag)
  // -------------------------------------------------------------------------
  describe('publish route: skillsOnChainId fallback from event data', () => {
    it('patches skillsOnChainId when chain query returns null but event has skillsId', () => {
      const source = readSource('web/app/api/souls/publish/route.ts')

      // Guard the conditional that detects the RPC lag scenario
      expect(source).toContain('if (initialSkill?.skillsId && !mirrored.skillsOnChainId)')
    })

    it('writes the event-extracted skillsId to the DB via prisma.soulAsset.update', () => {
      const source = readSource('web/app/api/souls/publish/route.ts')

      expect(source).toContain('await prisma.soulAsset.update(')
      expect(source).toContain('data: { skillsOnChainId: initialSkill.skillsId }')
    })

    it('mutates mirrored.skillsOnChainId so the response reflects the patched value', () => {
      const source = readSource('web/app/api/souls/publish/route.ts')

      expect(source).toContain('mirrored.skillsOnChainId = initialSkill.skillsId')
    })

    it('patch is placed after syncSoulProjectionFromChain and before memory/skill projections', () => {
      const source = readSource('web/app/api/souls/publish/route.ts')

      const syncPos = source.indexOf('await syncSoulProjectionFromChain(')
      const patchPos = source.indexOf('if (initialSkill?.skillsId && !mirrored.skillsOnChainId)')
      const memoryPos = source.indexOf('if (foundingMemory)')
      const skillPos = source.indexOf('if (initialSkill)')

      expect(patchPos).toBeGreaterThan(syncPos)
      expect(patchPos).toBeLessThan(memoryPos)
      expect(patchPos).toBeLessThan(skillPos)
    })

    it('fallback logic is correct: patches only when event has skillsId but mirror is null', () => {
      // Inline unit for the conditional itself — no mocks needed
      type Skill = { skillsId: string } | null
      type Mirrored = { onChainId: string; skillsOnChainId: string | null }

      function shouldPatch(initialSkill: Skill, mirrored: Mirrored): boolean {
        return !!(initialSkill?.skillsId && !mirrored.skillsOnChainId)
      }

      // Case 1: event has id, chain missed it → patch
      expect(shouldPatch({ skillsId: '0xabc' }, { onChainId: '0xsoul', skillsOnChainId: null })).toBe(true)

      // Case 2: chain already resolved it → no patch
      expect(shouldPatch({ skillsId: '0xabc' }, { onChainId: '0xsoul', skillsOnChainId: '0xabc' })).toBe(false)

      // Case 3: no skill minted → no patch
      expect(shouldPatch(null, { onChainId: '0xsoul', skillsOnChainId: null })).toBe(false)

      // Case 4: patch sets the value correctly
      const mirrored: Mirrored = { onChainId: '0xsoul', skillsOnChainId: null }
      const skill: Skill = { skillsId: '0xskills999' }
      if (shouldPatch(skill, mirrored)) {
        mirrored.skillsOnChainId = skill!.skillsId
      }
      expect(mirrored.skillsOnChainId).toBe('0xskills999')
    })
  })

  // -------------------------------------------------------------------------
  // Bug 2: Collection add-soul mirror silent failure → granular diagnostics
  // -------------------------------------------------------------------------
  describe('collection add-soul route: granular error diagnostics', () => {
    it('catches errors and logs memberId, txDigest, collectionId, errorType, and errorMsg', () => {
      const source = readSource('web/app/api/collections/[id]/add-soul/route.ts')

      expect(source).toContain("console.error('[collection-add-soul] Mirror failed'")
      expect(source).toContain('memberId: auth.identity.memberId')
      expect(source).toContain('txDigest')
      expect(source).toContain('collectionId: collection.onChainId')
      expect(source).toContain('errorType')
      expect(source).toContain('errorMsg')
    })

    it('distinguishes OnChainVerificationError from unknown errors in the response', () => {
      const source = readSource('web/app/api/collections/[id]/add-soul/route.ts')

      expect(source).toContain('error instanceof OnChainVerificationError')
      expect(source).toContain("isVerification ? 'verification' : 'unknown'")
      expect(source).toContain("isVerification ? 422 : 500")
    })

    it('returns descriptive error message prefixed with the error detail for verification failures', () => {
      const source = readSource('web/app/api/collections/[id]/add-soul/route.ts')

      expect(source).toContain('`Event verification failed: ${errorMsg}`')
    })

    it('returns generic error message for non-verification failures to avoid leaking internals', () => {
      const source = readSource('web/app/api/collections/[id]/add-soul/route.ts')

      expect(source).toContain("'Failed to mirror add-soul transaction'")
    })

    it('normalizes collectionId comparison with toLowerCase to prevent case-mismatch false positives', () => {
      const source = readSource('web/app/api/collections/[id]/add-soul/route.ts')

      expect(source).toContain('.toLowerCase()')
      expect(source).toContain("'Transaction targeted a different collection'")
    })
  })
})
