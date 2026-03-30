export function getRequiredE2EPaymentCoinType(): string {
  const value = process.env.NEXT_PUBLIC_SOUL_PAYMENT_COIN_TYPE?.trim()
  if (!value) {
    throw new Error('NEXT_PUBLIC_SOUL_PAYMENT_COIN_TYPE is required for web/scripts/e2e-agent-purchase.ts')
  }

  return value
}
