import { describe, expect, it } from 'vitest'

import {
  SOUL_PUBLISH_DRAFT_STORAGE_KEY,
  clearSoulPublishDraft,
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
      pricingType: 'both',
      oneTimePrice: '10.00',
      subPrice: '5.00',
      subPeriodDays: '30',
    })

    writeSoulPublishDraft(storage, patchSoulPublishDraft(draft, {
      seriesId: '0xseries',
      authorCapId: '0xcap',
      createTxDigest: '0xdigest',
    }))

    expect(readSoulPublishDraft(storage, '0xabc')?.seriesId).toBe('0xseries')
    expect(readSoulPublishDraft(storage, '0xdef')).toBeNull()
    expect(storage.getItem(`${SOUL_PUBLISH_DRAFT_STORAGE_KEY}:${NORMALIZED_ABC}`)).not.toBeNull()

    writeSoulPublishDraft(storage, patchSoulPublishDraft(draft, {
      dbMirroredAt: '2026-03-22T10:00:00.000Z',
    }))

    expect(readSoulPublishDraft(storage, '0xabc')).toBeNull()
  })

  it('restores wallet-scoped drafts regardless of address casing', () => {
    const storage = new MemoryStorage()
    const draft = createSoulPublishDraft({
      walletAddress: '0xAbC',
      name: 'Signal Soul',
      description: 'Recovered draft',
      category: 'Research',
      tags: ['alpha'],
      pricingType: 'onetime',
      oneTimePrice: '10.00',
      subPrice: '',
      subPeriodDays: '30',
    })

    writeSoulPublishDraft(storage, draft)

    expect(readSoulPublishDraft(storage, '0xabc')?.walletAddress).toBe('0xAbC')
    expect(readSoulPublishDraft(storage, '0xABC')?.walletAddress).toBe('0xAbC')
  })

  it('treats short-form and padded Sui addresses as the same wallet draft key', () => {
    const storage = new MemoryStorage()
    const draft = createSoulPublishDraft({
      walletAddress: '0x1',
      name: 'Signal Soul',
      description: 'Recovered draft',
      category: 'Research',
      tags: ['alpha'],
      pricingType: 'onetime',
      oneTimePrice: '10.00',
      subPrice: '',
      subPeriodDays: '30',
    })

    writeSoulPublishDraft(storage, draft)

    expect(readSoulPublishDraft(storage, `0x${'0'.repeat(63)}1`)?.walletAddress).toBe('0x1')
  })

  it('drops malformed persisted payloads instead of reviving them', () => {
    const storage = new MemoryStorage()
    storage.setItem(`${SOUL_PUBLISH_DRAFT_STORAGE_KEY}:${NORMALIZED_ABC}`, '{"walletAddress":42}')

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
      pricingType: 'onetime',
      oneTimePrice: '10.00',
      subPrice: '',
      subPeriodDays: '30',
    })))

    expect(readSoulPublishDraft(storage, '0xabc')).toBeNull()
    expect(storage.getItem(SOUL_PUBLISH_DRAFT_STORAGE_KEY)).not.toBeNull()
    expect(storage.getItem(`${SOUL_PUBLISH_DRAFT_STORAGE_KEY}:${NORMALIZED_ABC}`)).toBeNull()
  })

  it('sanitizes stale recovered drafts that have a release id without a release tx digest', () => {
    const storage = new MemoryStorage()
    const draft = createSoulPublishDraft({
      walletAddress: '0xabc',
      name: 'Scoped draft',
      description: 'Recovered draft',
      category: 'Research',
      tags: [],
      pricingType: 'onetime',
      oneTimePrice: '10.00',
      subPrice: '',
      subPeriodDays: '30',
    })

    writeSoulPublishDraft(storage, patchSoulPublishDraft(draft, {
      seriesId: '0xseries',
      releaseId: '0xrelease',
      sealDekEnvelope: 'stale-envelope',
    }))

    expect(readSoulPublishDraft(storage, '0xabc')).toMatchObject({
      walletAddress: '0xabc',
      seriesId: '0xseries',
      releaseId: null,
      releaseTxDigest: null,
      sealDekEnvelope: null,
    })
  })

  it('merges successful on-chain steps without losing prior progress', () => {
    const draft = createSoulPublishDraft({
      walletAddress: '0xabc',
      name: 'Signal Soul',
      description: 'Recovered draft',
      category: 'Research',
      tags: [],
      pricingType: 'both',
      oneTimePrice: '10.00',
      subPrice: '5.00',
      subPeriodDays: '30',
    })

    const afterSeries = patchSoulPublishDraft(draft, {
      previewBlobId: 'blob-1',
      previewFileKey: 'preview.png:100:200',
      createTxDigest: '0xcreate',
      seriesId: '0xseries',
      authorCapId: '0xcap',
    })
    const afterPlan = patchSoulPublishDraft(afterSeries, {
      oneTimePlanId: '0xplan',
      oneTimePlanTxDigest: '0xplan-digest',
    })

    expect(afterPlan.previewBlobId).toBe('blob-1')
    expect(afterPlan.seriesId).toBe('0xseries')
    expect(afterPlan.authorCapId).toBe('0xcap')
    expect(afterPlan.oneTimePlanId).toBe('0xplan')
    expect(afterPlan.subPlanId).toBeNull()
    expect(Date.parse(afterPlan.updatedAt)).not.toBeNaN()
  })

  it('refreshes editable form fields for a local-only draft before submit', () => {
    const originalDraft = createSoulPublishDraft({
      walletAddress: '0xabc',
      name: 'Signal Soul',
      description: '',
      category: 'Research',
      tags: ['alpha'],
      pricingType: 'onetime',
      oneTimePrice: '10.00',
      subPrice: '',
      subPeriodDays: '30',
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
      pricingType: 'both',
      oneTimePrice: '12.00',
      subPrice: '3.50',
      subPeriodDays: '14',
    })

    expect(refreshedDraft).toMatchObject({
      walletAddress: '0xabc',
      name: 'Updated Soul',
      description: 'Now filled in',
      category: 'Trading',
      tags: ['momentum', 'signals'],
      pricingType: 'both',
      oneTimePrice: '12.00',
      subPrice: '3.50',
      subPeriodDays: '14',
      previewBlobId: 'blob-1',
      previewFileKey: 'preview.png:100:200',
      seriesId: null,
    })
  })

  it('does not overwrite recovered drafts that already have on-chain progress', () => {
    const originalDraft = patchSoulPublishDraft(createSoulPublishDraft({
      walletAddress: '0xabc',
      name: 'Original Soul',
      description: 'Original description',
      category: 'Research',
      tags: ['alpha'],
      pricingType: 'onetime',
      oneTimePrice: '10.00',
      subPrice: '',
      subPeriodDays: '30',
    }), {
      createTxDigest: '0xcreate',
      seriesId: '0xseries',
      authorCapId: '0xcap',
    })

    const refreshedDraft = syncSoulPublishDraftForSubmit(originalDraft, {
      walletAddress: '0xabc',
      name: 'Edited Soul',
      description: 'Edited description',
      category: 'Trading',
      tags: ['beta'],
      pricingType: 'subscription',
      oneTimePrice: '',
      subPrice: '4.00',
      subPeriodDays: '7',
    })

    expect(refreshedDraft).toMatchObject({
      walletAddress: '0xabc',
      name: 'Original Soul',
      description: 'Original description',
      category: 'Research',
      tags: ['alpha'],
      pricingType: 'onetime',
      oneTimePrice: '10.00',
      subPrice: '',
      subPeriodDays: '30',
      createTxDigest: '0xcreate',
      seriesId: '0xseries',
      authorCapId: '0xcap',
    })
  })

  it('clears the persisted draft explicitly', () => {
    const storage = new MemoryStorage()
    writeSoulPublishDraft(storage, createSoulPublishDraft({
      walletAddress: '0xabc',
      name: 'Signal Soul',
      description: 'Recovered draft',
      category: 'Research',
      tags: [],
      pricingType: 'onetime',
      oneTimePrice: '10.00',
      subPrice: '',
      subPeriodDays: '30',
    }))

    clearSoulPublishDraft(storage, '0xabc')

    expect(storage.getItem(`${SOUL_PUBLISH_DRAFT_STORAGE_KEY}:${NORMALIZED_ABC}`)).toBeNull()
    expect(readSoulPublishDraft(storage, '0xabc')).toBeNull()
  })
})
