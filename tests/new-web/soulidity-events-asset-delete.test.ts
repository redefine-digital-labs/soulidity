import { describe, it, expect } from 'vitest'

const PACKAGE_ID = '0x0000000000000000000000000000000000000000000000000000000000000123'
const ASSETS_ID = '0x00000000000000000000000000000000000000000000000000000000000000aa'
const SOUL_ID = '0x00000000000000000000000000000000000000000000000000000000000000bb'
const DELETED_BY = '0x00000000000000000000000000000000000000000000000000000000000000cc'

function makeTx(events: Array<{ type: string; parsedJson: Record<string, unknown> }>) {
  return { events } as never
}

describe('extractAssetVersionDeletedEvent', () => {
  it('extracts asset deletion event from transaction', async () => {
    const { extractAssetVersionDeletedEvent } = await import('../../web/lib/soulidity/events.ts')

    const tx = makeTx([{
      type: `${PACKAGE_ID}::assets::AssetVersionDeleted`,
      parsedJson: {
        assets_id: ASSETS_ID,
        soul_id: SOUL_ID,
        asset_name: 'persona-sprite',
        version_index: '0',
        deleted_by: DELETED_BY,
      },
    }])

    const result = extractAssetVersionDeletedEvent(tx, PACKAGE_ID)
    expect(result).toEqual({
      assetsId: ASSETS_ID,
      soulId: SOUL_ID,
      assetName: 'persona-sprite',
      versionIndex: 0,
      deletedBy: DELETED_BY,
    })
  })

  it('throws when event is missing', async () => {
    const { extractAssetVersionDeletedEvent } = await import('../../web/lib/soulidity/events.ts')
    const tx = makeTx([])
    expect(() => extractAssetVersionDeletedEvent(tx, PACKAGE_ID)).toThrow('AssetVersionDeleted event is missing')
  })
})
