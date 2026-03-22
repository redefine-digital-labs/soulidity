import { describe, expect, it } from 'vitest'

import {
  clearSoulPublishDraft,
  createSoulPublishDraft,
  patchSoulPublishDraft,
  readSoulPublishDraft,
  writeSoulPublishDraft,
} from '@web/lib/souls/publish-draft'

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

    writeSoulPublishDraft(storage, patchSoulPublishDraft(draft, {
      dbMirroredAt: '2026-03-22T10:00:00.000Z',
    }))

    expect(readSoulPublishDraft(storage, '0xabc')).toBeNull()
  })

  it('drops malformed persisted payloads instead of reviving them', () => {
    const storage = new MemoryStorage()
    storage.setItem('soul-publish-draft', '{"walletAddress":42}')

    expect(readSoulPublishDraft(storage, '0xabc')).toBeNull()
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

    clearSoulPublishDraft(storage)

    expect(readSoulPublishDraft(storage, '0xabc')).toBeNull()
  })
})
