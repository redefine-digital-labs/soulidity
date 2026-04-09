import { describe, expect, it } from 'vitest'

import { paginateSoulSkillVersions } from '../../new-web/lib/soulidity/skill-version-pagination'

describe('paginateSoulSkillVersions', () => {
  it('returns a stable nextCursor when truncating a version list', () => {
    const result = paginateSoulSkillVersions([
      { id: '3', skillName: 'writer', versionIndex: 3 },
      { id: '2', skillName: 'writer', versionIndex: 2 },
      { id: '1', skillName: 'writer', versionIndex: 1 },
    ], {
      limit: 2,
      cursor: null,
    })

    expect(result).toEqual({
      items: [
        { id: '3', skillName: 'writer', versionIndex: 3 },
        { id: '2', skillName: 'writer', versionIndex: 2 },
      ],
      nextCursor: 'writer:2',
      total: 3,
    })
  })

  it('continues after the provided cursor', () => {
    const result = paginateSoulSkillVersions([
      { id: '3', skillName: 'writer', versionIndex: 3 },
      { id: '2', skillName: 'writer', versionIndex: 2 },
      { id: '1', skillName: 'writer', versionIndex: 1 },
    ], {
      limit: 2,
      cursor: 'writer:2',
    })

    expect(result).toEqual({
      items: [
        { id: '1', skillName: 'writer', versionIndex: 1 },
      ],
      nextCursor: null,
      total: 3,
    })
  })
})
