import { describe, expect, it } from 'vitest'

import {
  SOUL_PUBLISH_DRAFT_STORAGE_KEY,
  clearSoulPublishDraft,
  createSoulPublishDraft,
  patchSoulPublishDraft,
  readSoulPublishDraft,
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
    storage.setItem(SOUL_PUBLISH_DRAFT_STORAGE_KEY, '{"walletAddress":42}')

    expect(readSoulPublishDraft(storage, '0xabc')).toBeNull()
  })

  it('migrates a legacy global draft into a wallet-scoped key on first read', () => {
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

    expect(readSoulPublishDraft(storage, '0xabc')?.walletAddress).toBe('0xabc')
    expect(storage.getItem(SOUL_PUBLISH_DRAFT_STORAGE_KEY)).toBeNull()
    expect(storage.getItem(`${SOUL_PUBLISH_DRAFT_STORAGE_KEY}:${NORMALIZED_ABC}`)).not.toBeNull()
  })

  it('does not overwrite a newer wallet-scoped draft while migrating a legacy draft', () => {
    const walletKey = `${SOUL_PUBLISH_DRAFT_STORAGE_KEY}:${NORMALIZED_ABC}`
    const storage = new MemoryStorage()
    const legacyDraft = createSoulPublishDraft({
      walletAddress: '0xabc',
      name: 'Legacy draft',
      description: 'Recovered draft',
      category: 'Research',
      tags: [],
      pricingType: 'onetime',
      oneTimePrice: '10.00',
      subPrice: '',
      subPeriodDays: '30',
    })
    const newerDraft = patchSoulPublishDraft(legacyDraft, {
      name: 'Newer scoped draft',
      updatedAt: '2026-03-23T12:00:00.000Z',
    })

    storage.setItem(SOUL_PUBLISH_DRAFT_STORAGE_KEY, JSON.stringify(legacyDraft))

    const originalGetItem = storage.getItem.bind(storage)
    let insertedScopedDraft = false
    storage.getItem = (key: string) => {
      const value = originalGetItem(key)
      if (key === SOUL_PUBLISH_DRAFT_STORAGE_KEY && !insertedScopedDraft) {
        insertedScopedDraft = true
        storage.setItem(walletKey, JSON.stringify(newerDraft))
      }
      return value
    }

    expect(readSoulPublishDraft(storage, '0xabc')?.name).toBe('Legacy draft')
    expect(JSON.parse(storage.getItem(walletKey) ?? '{}').name).toBe('Newer scoped draft')
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

    clearSoulPublishDraft(storage, '0xabc')

    expect(readSoulPublishDraft(storage, '0xabc')).toBeNull()
  })

  it('does not delete a different wallet legacy draft while clearing the scoped key', () => {
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
    storage.setItem(SOUL_PUBLISH_DRAFT_STORAGE_KEY, JSON.stringify(createSoulPublishDraft({
      walletAddress: '0xdef',
      name: 'Other wallet draft',
      description: 'Recovered draft',
      category: 'Research',
      tags: [],
      pricingType: 'onetime',
      oneTimePrice: '10.00',
      subPrice: '',
      subPeriodDays: '30',
    })))

    clearSoulPublishDraft(storage, '0xabc')

    expect(storage.getItem(SOUL_PUBLISH_DRAFT_STORAGE_KEY)).not.toBeNull()
  })
})
