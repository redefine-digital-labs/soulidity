import { describe, expect, it } from 'vitest'

import {
  SOUL_PUBLISH_DRAFT_STORAGE_KEY,
  createSoulPublishDraft,
  patchSoulPublishDraft,
  readSoulPublishDraft,
  syncSoulPublishDraftForSubmit,
  writeSoulPublishDraft,
} from '@web/lib/souls/publish-draft'

const NORMALIZED_ABC = `0x${'0'.repeat(61)}abc`

class MemoryStorage {
  private store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.store.set(key, value)
  }

  removeItem(key: string) {
    this.store.delete(key)
  }
}

describe('soul publish draft', () => {
  it('restores only unfinished drafts for the same wallet', () => {
    const storage = new MemoryStorage()
    const draft = createSoulPublishDraft({
      walletAddress: '0xabc',
      name: 'Signal Soul',
      description: 'Recovered draft',
      category: 'Research',
      tags: ['alpha', 'beta'],
      imageUrl: 'https://example.com/soul.png',
      priceSui: '1000000000',
      readme: 'README',
    })

    writeSoulPublishDraft(storage, patchSoulPublishDraft(draft, {
      contentBlobObjectId: '0xblob',
      metadataRef: 'walrus://metadata',
      publishTxDigest: '0xdigest',
    }))

    expect(readSoulPublishDraft(storage, '0xabc')?.contentBlobObjectId).toBe('0xblob')
    expect(readSoulPublishDraft(storage, '0xdef')).toBeNull()
    expect(storage.getItem(`${SOUL_PUBLISH_DRAFT_STORAGE_KEY}:${NORMALIZED_ABC}`)).not.toBeNull()

    writeSoulPublishDraft(storage, patchSoulPublishDraft(draft, {
      dbMirroredAt: '2026-03-22T10:00:00.000Z',
    }))

    expect(readSoulPublishDraft(storage, '0xabc')).toBeNull()
  })

  it('ignores the legacy global draft key entirely', () => {
    const storage = new MemoryStorage()
    storage.setItem(SOUL_PUBLISH_DRAFT_STORAGE_KEY, JSON.stringify(createSoulPublishDraft({
      walletAddress: '0xabc',
      name: 'Signal Soul',
      description: 'Recovered draft',
      category: 'Research',
      tags: [],
      imageUrl: 'https://example.com/soul.png',
      priceSui: '1000000000',
      readme: '',
    })))

    expect(readSoulPublishDraft(storage, '0xabc')).toBeNull()
    expect(storage.getItem(SOUL_PUBLISH_DRAFT_STORAGE_KEY)).not.toBeNull()
    expect(storage.getItem(`${SOUL_PUBLISH_DRAFT_STORAGE_KEY}:${NORMALIZED_ABC}`)).toBeNull()
  })

  it('sanitizes stale recovered drafts that have a seller kiosk id without a soul object id', () => {
    const storage = new MemoryStorage()
    const draft = createSoulPublishDraft({
      walletAddress: '0xabc',
      name: 'Scoped draft',
      description: 'Recovered draft',
      category: 'Research',
      tags: [],
      imageUrl: 'https://example.com/soul.png',
      priceSui: '1000000000',
      readme: '',
    })

    writeSoulPublishDraft(storage, patchSoulPublishDraft(draft, {
      sellerKioskId: '0xkiosk',
      publishTxDigest: '0xtx',
    }))

    expect(readSoulPublishDraft(storage, '0xabc')).toMatchObject({
      walletAddress: '0xabc',
      sellerKioskId: null,
      publishTxDigest: null,
    })
  })

  it('refreshes editable form fields for a local-only draft before submit', () => {
    const originalDraft = createSoulPublishDraft({
      walletAddress: '0xabc',
      name: 'Signal Soul',
      description: '',
      category: 'Research',
      tags: ['alpha'],
      imageUrl: 'https://example.com/old.png',
      priceSui: '1000000000',
      readme: '',
    })
    const hydratedDraft = patchSoulPublishDraft(originalDraft, {
      previewBlobId: 'blob-1',
      previewFileKey: 'preview.png:100:200',
    })

    const refreshedDraft = syncSoulPublishDraftForSubmit(hydratedDraft, {
      walletAddress: '0xabc',
      name: 'Updated Soul',
      description: 'Now filled in',
      category: 'Trading',
      tags: ['momentum', 'signals'],
      imageUrl: 'https://example.com/new.png',
      priceSui: '1200000000',
      readme: 'Updated readme',
    })

    expect(refreshedDraft).toMatchObject({
      walletAddress: '0xabc',
      name: 'Updated Soul',
      description: 'Now filled in',
      category: 'Trading',
      tags: ['momentum', 'signals'],
      imageUrl: 'https://example.com/new.png',
      priceSui: '1200000000',
      readme: 'Updated readme',
      previewBlobId: 'blob-1',
      previewFileKey: 'preview.png:100:200',
      soulObjectId: null,
    })
  })

  it('does not overwrite recovered drafts that already have on-chain progress', () => {
    const originalDraft = patchSoulPublishDraft(createSoulPublishDraft({
      walletAddress: '0xabc',
      name: 'Original Soul',
      description: 'Original description',
      category: 'Research',
      tags: ['alpha'],
      imageUrl: 'https://example.com/original.png',
      priceSui: '1000000000',
      readme: '',
    }), {
      soulObjectId: '0xsoul',
      sellerKioskId: '0xkiosk',
      publishTxDigest: '0xpublish',
    })

    const refreshedDraft = syncSoulPublishDraftForSubmit(originalDraft, {
      walletAddress: '0xabc',
      name: 'Edited Soul',
      description: 'Edited description',
      category: 'Trading',
      tags: ['beta'],
      imageUrl: 'https://example.com/edited.png',
      priceSui: '2000000000',
      readme: 'Edited readme',
    })

    expect(refreshedDraft).toMatchObject({
      name: 'Original Soul',
      description: 'Original description',
      category: 'Research',
      tags: ['alpha'],
      imageUrl: 'https://example.com/original.png',
      priceSui: '1000000000',
      soulObjectId: '0xsoul',
      sellerKioskId: '0xkiosk',
      publishTxDigest: '0xpublish',
    })
  })
})
