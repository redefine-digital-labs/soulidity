import { describe, expect, it } from 'vitest'

import {
  getSoulPublishPricingState,
  getVisibleSoulPublishPricingErrors,
} from '../../web/lib/souls/publish-ui.ts'

describe('soul publish pricing state', () => {
  it('marks only the one-time price as required for one-time pricing', () => {
    expect(
      getSoulPublishPricingState({
        pricingType: 'onetime',
        oneTimePrice: '',
        subPrice: '',
        subPeriodDays: '',
      }),
    ).toEqual({
      requiredFields: {
        oneTimePrice: true,
        subPrice: false,
        subPeriodDays: false,
      },
      helperText: 'One-time pricing requires a one-time price.',
      fieldErrors: {
        oneTimePrice: 'Required for one-time pricing',
        subPrice: null,
        subPeriodDays: null,
      },
      isComplete: false,
    })
  })

  it('requires subscription price and period for subscription pricing', () => {
    expect(
      getSoulPublishPricingState({
        pricingType: 'subscription',
        oneTimePrice: '',
        subPrice: '5.00',
        subPeriodDays: '',
      }),
    ).toEqual({
      requiredFields: {
        oneTimePrice: false,
        subPrice: true,
        subPeriodDays: true,
      },
      helperText: 'Subscription pricing requires both a subscription price and a billing period.',
      fieldErrors: {
        oneTimePrice: null,
        subPrice: null,
        subPeriodDays: 'Required for subscription pricing',
      },
      isComplete: false,
    })
  })

  it('stays incomplete when both pricing modes are enabled but one field is invalid', () => {
    expect(
      getSoulPublishPricingState({
        pricingType: 'both',
        oneTimePrice: '10.00',
        subPrice: '0',
        subPeriodDays: '30',
      }),
    ).toEqual({
      requiredFields: {
        oneTimePrice: true,
        subPrice: true,
        subPeriodDays: true,
      },
      helperText: 'Combined pricing requires one-time price, subscription price, and billing period.',
      fieldErrors: {
        oneTimePrice: null,
        subPrice: 'Enter a positive USD amount with at most 6 decimal places',
        subPeriodDays: null,
      },
      isComplete: false,
    })
  })

  it('returns a complete state once all required values are valid', () => {
    expect(
      getSoulPublishPricingState({
        pricingType: 'both',
        oneTimePrice: '10.00',
        subPrice: '5.00',
        subPeriodDays: '30',
      }),
    ).toEqual({
      requiredFields: {
        oneTimePrice: true,
        subPrice: true,
        subPeriodDays: true,
      },
      helperText: 'Combined pricing requires one-time price, subscription price, and billing period.',
      fieldErrors: {
        oneTimePrice: null,
        subPrice: null,
        subPeriodDays: null,
      },
      isComplete: true,
    })
  })

  it('hides required-field errors for untouched inputs', () => {
    const state = getSoulPublishPricingState({
      pricingType: 'subscription',
      oneTimePrice: '',
      subPrice: '',
      subPeriodDays: '',
    })

    expect(
      getVisibleSoulPublishPricingErrors(state, {
        submitAttempted: false,
        touched: {
          oneTimePrice: false,
          subPrice: false,
          subPeriodDays: false,
        },
      }),
    ).toEqual({
      oneTimePrice: null,
      subPrice: null,
      subPeriodDays: null,
    })
  })

  it('reveals only the touched invalid field before submit', () => {
    const state = getSoulPublishPricingState({
      pricingType: 'both',
      oneTimePrice: '10.00',
      subPrice: '0',
      subPeriodDays: '',
    })

    expect(
      getVisibleSoulPublishPricingErrors(state, {
        submitAttempted: false,
        touched: {
          oneTimePrice: true,
          subPrice: true,
          subPeriodDays: false,
        },
      }),
    ).toEqual({
      oneTimePrice: null,
      subPrice: 'Enter a positive USD amount with at most 6 decimal places',
      subPeriodDays: null,
    })
  })

  it('reveals all current validation errors after submit attempt', () => {
    const state = getSoulPublishPricingState({
      pricingType: 'subscription',
      oneTimePrice: '',
      subPrice: '',
      subPeriodDays: '',
    })

    expect(
      getVisibleSoulPublishPricingErrors(state, {
        submitAttempted: true,
        touched: {
          oneTimePrice: false,
          subPrice: false,
          subPeriodDays: false,
        },
      }),
    ).toEqual({
      oneTimePrice: null,
      subPrice: 'Required for subscription pricing',
      subPeriodDays: 'Required for subscription pricing',
    })
  })
})
