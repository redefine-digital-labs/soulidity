import { describe, expect, it } from 'vitest'

import {
  selectReusableUploadResults,
  type UploadResults,
} from '@/components/providers/create-soul-provider'

const baseUploadResults: UploadResults = {
  ownerAddress: '0xold',
  coverImage: {
    blobId: 'cover-blob',
    blobObjectId: '0xcover',
    contentHash: 'cover-hash',
    blobUrl: 'https://example.com/cover',
  },
  charFile: {
    blobId: 'char-blob',
    blobObjectId: '0xchar',
    contentHash: 'char-hash',
    blobUrl: 'https://example.com/char',
    sealDekEnvelope: 'char-envelope',
  },
  memorySeed: {
    blobId: 'memory-blob',
    blobObjectId: '0xmemory',
    contentHash: 'memory-hash',
    blobUrl: 'https://example.com/memory',
    sealDekEnvelope: 'memory-envelope',
  },
  skillsFile: {
    blobId: 'skills-blob',
    blobObjectId: '0xskills',
    contentHash: 'skills-hash',
    blobUrl: 'https://example.com/skills',
    sealDekEnvelope: 'skills-envelope',
  },
}

describe('selectReusableUploadResults', () => {
  it('reuses all uploads when the signer wallet is unchanged', () => {
    expect(selectReusableUploadResults(baseUploadResults, '0xold')).toEqual(baseUploadResults)
  })

  it('drops tx-bound blob uploads when the signer wallet changes', () => {
    expect(selectReusableUploadResults(baseUploadResults, '0xnew')).toEqual({
      ownerAddress: '0xnew',
      coverImage: baseUploadResults.coverImage,
      charFile: undefined,
      memorySeed: undefined,
      skillsFile: undefined,
    })
  })

  it('treats legacy upload state without ownerAddress as non-reusable for tx-bound blobs', () => {
    const legacyResults: UploadResults = {
      coverImage: baseUploadResults.coverImage,
      charFile: baseUploadResults.charFile,
      memorySeed: baseUploadResults.memorySeed,
    }

    expect(selectReusableUploadResults(legacyResults, '0xcurrent')).toEqual({
      ownerAddress: '0xcurrent',
      coverImage: baseUploadResults.coverImage,
      charFile: undefined,
      memorySeed: undefined,
      skillsFile: undefined,
    })
  })
})
