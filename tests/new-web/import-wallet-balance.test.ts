import { describe, expect, it } from 'vitest'

import {
  countPendingImportUploads,
  txBoundImportUploadObjectIds,
} from '@/lib/import/import-wallet-balance'

const upload = (blobObjectId: string) => ({
  blobId: `${blobObjectId}-blob`,
  blobObjectId,
  contentHash: `${blobObjectId}-hash`,
  blobUrl: `https://example.com/${blobObjectId}`,
})

describe('import wallet balance upload counting', () => {
  it('does not treat cached tx-bound uploads as reusable until object ids are verified fresh', () => {
    const reusableUploadResults = {
      ownerAddress: '0xwallet',
      coverImage: upload('0xcover'),
      charFile: { ...upload('0xchar'), sealMaterial: null },
      memorySeed: { ...upload('0xmemory'), sealMaterial: null },
      skillsFile: { ...upload('0xskills'), sealMaterial: null },
      spriteSheet: upload('0xsprite'),
    }

    expect(txBoundImportUploadObjectIds(reusableUploadResults)).toEqual([
      '0xchar',
      '0xmemory',
      '0xskills',
      '0xsprite',
    ])

    expect(countPendingImportUploads({
      reusableUploadResults,
      hasSkillsFile: true,
      hasSpriteSheetFile: true,
      verifiedReusableBlobObjectIds: null,
    })).toBe(4)

    expect(countPendingImportUploads({
      reusableUploadResults,
      hasSkillsFile: true,
      hasSpriteSheetFile: true,
      verifiedReusableBlobObjectIds: new Set(['0xchar', '0xmemory', '0xskills', '0xsprite']),
    })).toBe(0)
  })
})
