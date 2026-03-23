import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

describe('buildCreateSeriesTx', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = {
      ...ORIGINAL_ENV,
      NEXT_PUBLIC_SOUL_PACKAGE_ID: '0xsoul',
    }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('rejects create-series payloads that exceed the on-chain tag limit', async () => {
    const { buildCreateSeriesTx } = await import('../../web/lib/souls/tx-builder.ts')

    expect(() => buildCreateSeriesTx({
      name: 'Soul name',
      description: 'Soul description',
      category: 'Research',
      tags: Array.from({ length: 11 }, (_, index) => `tag-${index}`),
      previewImages: [],
    })).toThrow('Soul tags exceed the 10-tag limit')
  })

  it('rejects preview image references that exceed the on-chain byte limit', async () => {
    const { buildCreateSeriesTx } = await import('../../web/lib/souls/tx-builder.ts')

    expect(() => buildCreateSeriesTx({
      name: 'Soul name',
      description: 'Soul description',
      category: 'Research',
      tags: ['alpha'],
      previewImages: ['x'.repeat(513)],
    })).toThrow('Soul preview image reference exceeds the 512-byte limit')
  })
})
