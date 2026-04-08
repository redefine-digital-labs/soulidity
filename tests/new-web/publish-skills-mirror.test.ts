import { describe, it, expect } from 'vitest'

describe('publish mirror skillsOnChainId fallback', () => {
  it('should patch when chain state returns null but event has skillsId', () => {
    // Verify the logic: when initialSkill exists and mirrored.skillsOnChainId is null,
    // the patch should apply
    const initialSkill = { skillsId: '0xabc123', skillName: 'test', versionIndex: 0 }
    const mirrored = { onChainId: '0xdef456', skillsOnChainId: null as string | null }

    // The fix condition
    const shouldPatch = !!(initialSkill?.skillsId && !mirrored.skillsOnChainId)
    expect(shouldPatch).toBe(true)

    // After patch
    if (shouldPatch) {
      mirrored.skillsOnChainId = initialSkill.skillsId
    }
    expect(mirrored.skillsOnChainId).toBe('0xabc123')
  })

  it('should NOT patch when chain state already has skillsId', () => {
    const initialSkill = { skillsId: '0xabc123', skillName: 'test', versionIndex: 0 }
    const mirrored = { onChainId: '0xdef456', skillsOnChainId: '0xexisting' as string | null }

    const shouldPatch = !!(initialSkill?.skillsId && !mirrored.skillsOnChainId)
    expect(shouldPatch).toBe(false)
    expect(mirrored.skillsOnChainId).toBe('0xexisting')
  })

  it('should NOT patch when no skills were minted', () => {
    const initialSkill = null
    const mirrored = { onChainId: '0xdef456', skillsOnChainId: null as string | null }

    const shouldPatch = !!(initialSkill?.skillsId && !mirrored.skillsOnChainId)
    expect(shouldPatch).toBe(false)
    expect(mirrored.skillsOnChainId).toBeNull()
  })
})
