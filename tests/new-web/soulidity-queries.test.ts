import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedGetObject = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/sui', () => ({
  suiClient: {
    getObject: mockedGetObject,
  },
}))

describe('Soulidity queries', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('parses SoulSkills objects without depending on legacy version_ids vectors', async () => {
    mockedGetObject.mockResolvedValue({
      data: {
        objectId: '0x5',
        type: '0x42::skills::SoulSkills',
        content: {
          dataType: 'moveObject',
          type: '0x42::skills::SoulSkills',
          fields: {
            soul_id: '0x6',
            next_version: '3',
            version_count: '2',
            latest_version_id: { vec: [{ id: '0x7' }] },
            version_index: {
              type: '0x2::table::Table<u64, 0x2::object::ID>',
              fields: {
                id: { id: '0x8' },
                size: '2',
              },
            },
          },
        },
      },
    })

    const { getSoulSkillsObject } = await import('../../new-web/lib/soulidity/queries')
    await expect(getSoulSkillsObject('0x5', '0x42')).resolves.toEqual({
      objectId: '0x5',
      packageId: '0x0000000000000000000000000000000000000000000000000000000000000042',
      soulId: '0x0000000000000000000000000000000000000000000000000000000000000006',
      nextVersion: 3,
      versionCount: 2,
      latestVersionId: '0x0000000000000000000000000000000000000000000000000000000000000007',
    })
  })
})
