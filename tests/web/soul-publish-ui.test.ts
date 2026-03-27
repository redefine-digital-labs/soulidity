import { describe, expect, it } from 'vitest'

import {
  getSoulPublishPriceState,
  getVisibleSoulPublishPriceErrors,
} from '../../web/lib/souls/publish-ui.ts'

describe('soul publish price state', () => {
  it('requires a single SUI price for primary sale publishing', () => {
    expect(getSoulPublishPriceState({ price: '' })).toEqual({
      helperText: 'Primary sale uses a single fixed SUI price.',
      fieldErrors: {
        price: 'Required',
      },
      isComplete: false,
    })
  })

  it('rejects malformed or below-floor SUI prices', () => {
    expect(getSoulPublishPriceState({ price: '0.000000001' })).toEqual({
      helperText: 'Primary sale uses a single fixed SUI price.',
      fieldErrors: {
        price: 'Enter a positive SUI amount with at most 9 decimal places',
      },
      isComplete: false,
    })
  })

  it('becomes complete once the SUI price is valid', () => {
    expect(getSoulPublishPriceState({ price: '1.25' })).toEqual({
      helperText: 'Primary sale uses a single fixed SUI price.',
      fieldErrors: {
        price: null,
      },
      isComplete: true,
    })
  })

  it('only reveals price errors after touch or submit', () => {
    const state = getSoulPublishPriceState({ price: '' })

    expect(getVisibleSoulPublishPriceErrors(state, {
      submitAttempted: false,
      touched: { price: false },
    })).toEqual({ price: null })

    expect(getVisibleSoulPublishPriceErrors(state, {
      submitAttempted: false,
      touched: { price: true },
    })).toEqual({ price: 'Required' })
  })
})
