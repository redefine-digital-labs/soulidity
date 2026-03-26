import { parseSubscriptionPeriodDaysToMs, parseUsdPriceToAtomic } from '@web/lib/souls/pricing-input'

export type SoulPublishPricingType = 'onetime' | 'subscription' | 'both'

interface SoulPublishPricingStateInput {
  pricingType: SoulPublishPricingType
  oneTimePrice: string
  subPrice: string
  subPeriodDays: string
}

interface SoulPublishPricingFieldErrors {
  oneTimePrice: string | null
  subPrice: string | null
  subPeriodDays: string | null
}

interface SoulPublishPricingRequiredFields {
  oneTimePrice: boolean
  subPrice: boolean
  subPeriodDays: boolean
}

export interface SoulPublishPricingState {
  requiredFields: SoulPublishPricingRequiredFields
  helperText: string
  fieldErrors: SoulPublishPricingFieldErrors
  isComplete: boolean
}

export interface SoulPublishPricingErrorVisibility {
  submitAttempted: boolean
  touched: SoulPublishPricingRequiredFields
}

const USD_PRICE_ERROR = 'Enter a positive USD amount with at most 6 decimal places'
const SUBSCRIPTION_PERIOD_ERROR = 'Enter a whole number of days greater than zero'

function getHelperText(pricingType: SoulPublishPricingType): string {
  switch (pricingType) {
    case 'onetime':
      return 'One-time pricing requires a one-time price.'
    case 'subscription':
      return 'Subscription pricing requires both a subscription price and a billing period.'
    case 'both':
      return 'Combined pricing requires one-time price, subscription price, and billing period.'
  }
}

function getRequiredFields(pricingType: SoulPublishPricingType): SoulPublishPricingRequiredFields {
  return {
    oneTimePrice: pricingType === 'onetime' || pricingType === 'both',
    subPrice: pricingType === 'subscription' || pricingType === 'both',
    subPeriodDays: pricingType === 'subscription' || pricingType === 'both',
  }
}

export function getSoulPublishPricingState(
  input: SoulPublishPricingStateInput,
): SoulPublishPricingState {
  const requiredFields = getRequiredFields(input.pricingType)
  const fieldErrors: SoulPublishPricingFieldErrors = {
    oneTimePrice: null,
    subPrice: null,
    subPeriodDays: null,
  }

  if (requiredFields.oneTimePrice) {
    if (!input.oneTimePrice.trim()) {
      fieldErrors.oneTimePrice = 'Required for one-time pricing'
    } else if (parseUsdPriceToAtomic(input.oneTimePrice) == null) {
      fieldErrors.oneTimePrice = USD_PRICE_ERROR
    }
  }

  if (requiredFields.subPrice) {
    if (!input.subPrice.trim()) {
      fieldErrors.subPrice = 'Required for subscription pricing'
    } else if (parseUsdPriceToAtomic(input.subPrice) == null) {
      fieldErrors.subPrice = USD_PRICE_ERROR
    }
  }

  if (requiredFields.subPeriodDays) {
    if (!input.subPeriodDays.trim()) {
      fieldErrors.subPeriodDays = 'Required for subscription pricing'
    } else if (parseSubscriptionPeriodDaysToMs(input.subPeriodDays) == null) {
      fieldErrors.subPeriodDays = SUBSCRIPTION_PERIOD_ERROR
    }
  }

  return {
    requiredFields,
    helperText: getHelperText(input.pricingType),
    fieldErrors,
    isComplete: Object.values(fieldErrors).every((value) => value == null),
  }
}

export function getVisibleSoulPublishPricingErrors(
  state: Pick<SoulPublishPricingState, 'fieldErrors'>,
  visibility: SoulPublishPricingErrorVisibility,
): SoulPublishPricingFieldErrors {
  return {
    oneTimePrice:
      visibility.submitAttempted || visibility.touched.oneTimePrice
        ? state.fieldErrors.oneTimePrice
        : null,
    subPrice:
      visibility.submitAttempted || visibility.touched.subPrice
        ? state.fieldErrors.subPrice
        : null,
    subPeriodDays:
      visibility.submitAttempted || visibility.touched.subPeriodDays
        ? state.fieldErrors.subPeriodDays
        : null,
  }
}
