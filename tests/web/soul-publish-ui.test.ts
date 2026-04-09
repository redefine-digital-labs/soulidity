import { describe, expect, it } from 'vitest'

import {
  INCOMPLETE_PUBLISH_PROGRESS_ERROR,
  getSoulPublishPriceState,
  getVisibleSoulPublishPriceErrors,
} from '../../web/lib/souls/publish-ui.ts'

describe('soul publish price state', () => {
  it('requires a single USDC price for Soul publishing', () => {
    expect(getSoulPublishPriceState({ price: '', listForSale: true })).toEqual({
      helperText: 'Each Soul uses a single fixed USDC listing price.',
      fieldErrors: {
        price: 'Required',
      },
      isComplete: false,
    })
  })

  it('rejects malformed, zero, or sub-minimum USDC prices', () => {
    expect(getSoulPublishPriceState({ price: '0.000001', listForSale: true })).toEqual({
      helperText: 'Each Soul uses a single fixed USDC listing price.',
      fieldErrors: {
        price: 'Enter a USDC amount of at least 0.001 with at most 6 decimal places',
      },
      isComplete: false,
    })
  })

  it('becomes complete once the USDC price is valid', () => {
    expect(getSoulPublishPriceState({ price: '1.25', listForSale: true })).toEqual({
      helperText: 'Each Soul uses a single fixed USDC listing price.',
      fieldErrors: {
        price: null,
      },
      isComplete: true,
    })
  })

  it('only reveals price errors after touch or submit', () => {
    const state = getSoulPublishPriceState({ price: '', listForSale: true })

    expect(getVisibleSoulPublishPriceErrors(state, {
      submitAttempted: false,
      touched: { price: false },
    })).toEqual({ price: null })

    expect(getVisibleSoulPublishPriceErrors(state, {
      submitAttempted: false,
      touched: { price: true },
    })).toEqual({ price: 'Required' })
  })

  it('keeps the publish progress recovery error copy in English', () => {
    expect(INCOMPLETE_PUBLISH_PROGRESS_ERROR).toBe(
      'Publish progress is incomplete. Clear the draft and try again.',
    )
  })
})
