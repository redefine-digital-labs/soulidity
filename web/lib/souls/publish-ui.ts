import { parseSoulPaymentAmountToAtomic } from '@web/lib/souls/pricing-input'

interface SoulPublishPriceStateInput {
  price: string
  listForSale: boolean
}

interface SoulPublishPriceFieldErrors {
  price: string | null
}

export interface SoulPublishPriceState {
  helperText: string
  fieldErrors: SoulPublishPriceFieldErrors
  isComplete: boolean
}

export interface SoulPublishPriceErrorVisibility {
  submitAttempted: boolean
  touched: { price: boolean }
}

const PRICE_ERROR = 'Enter a USDC amount of at least 0.001 with at most 6 decimal places'
export const INCOMPLETE_PUBLISH_PROGRESS_ERROR = 'Publish progress is incomplete. Clear the draft and try again.'

export function getSoulPublishPriceState(
  input: SoulPublishPriceStateInput,
): SoulPublishPriceState {
  if (!input.listForSale) {
    return {
      helperText: 'Your Soul will be minted and held in your kiosk. You can list it for sale later.',
      fieldErrors: { price: null },
      isComplete: true,
    }
  }

  const fieldErrors: SoulPublishPriceFieldErrors = {
    price: null,
  }

  if (!input.price.trim()) {
    fieldErrors.price = 'Required'
  } else if (parseSoulPaymentAmountToAtomic(input.price) == null) {
    fieldErrors.price = PRICE_ERROR
  }

  return {
    helperText: 'Each Soul uses a single fixed USDC listing price.',
    fieldErrors,
    isComplete: fieldErrors.price == null,
  }
}

export function getVisibleSoulPublishPriceErrors(
  state: Pick<SoulPublishPriceState, 'fieldErrors'>,
  visibility: SoulPublishPriceErrorVisibility,
): SoulPublishPriceFieldErrors {
  return {
    price: visibility.submitAttempted || visibility.touched.price
      ? state.fieldErrors.price
      : null,
  }
}
