import { parseSuiPriceToMist } from '@web/lib/souls/pricing-input'

interface SoulPublishPriceStateInput {
  price: string
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

const PRICE_ERROR = 'Enter a positive SUI amount with at most 9 decimal places'

export function getSoulPublishPriceState(
  input: SoulPublishPriceStateInput,
): SoulPublishPriceState {
  const fieldErrors: SoulPublishPriceFieldErrors = {
    price: null,
  }

  if (!input.price.trim()) {
    fieldErrors.price = 'Required'
  } else if (parseSuiPriceToMist(input.price) == null) {
    fieldErrors.price = PRICE_ERROR
  }

  return {
    helperText: 'Primary sale uses a single fixed SUI price.',
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
