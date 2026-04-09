import { OnChainVerificationError } from '@web/lib/souls/on-chain-verification'

const UNSAFE_ON_CHAIN_VERIFICATION_MESSAGE_PATTERNS = [
  / is missing on chain$/,
  / is malformed on chain$/,
  / exceeds the supported /,
  / is not a valid integer on chain$/,
  / is not a Move object$/,
  /^Referenced object is not /,
  /^Soul allowlist_address nesting exceeds /,
  /^Unable to determine transaction sender for verification$/,
  /^Pricing plan type is invalid on chain$/,
  / is out of valid range on chain$/,
  /^Personal kiosk cap /,
]

export function toSafeErrorDetails(error: unknown): { name: string; message: string } {
  return {
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : 'Unknown error',
  }
}

export function getClientSafeOnChainVerificationErrorMessage(error: OnChainVerificationError): string {
  const message = error.message.trim()
  if (UNSAFE_ON_CHAIN_VERIFICATION_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'On-chain verification failed'
  }

  return message
}
