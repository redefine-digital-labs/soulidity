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
    }

    expect(txBoundImportUploadObjectIds(reusableUploadResults)).toEqual([
      '0xchar',
      '0xmemory',
      '0xskills',
    ])

    expect(countPendingImportUploads({
      reusableUploadResults,
      hasSkillsFile: true,
      verifiedReusableBlobObjectIds: null,
    })).toBe(3)

    expect(countPendingImportUploads({
      reusableUploadResults,
      hasSkillsFile: true,
      verifiedReusableBlobObjectIds: new Set(['0xchar', '0xmemory', '0xskills']),
    })).toBe(0)
  })
})
