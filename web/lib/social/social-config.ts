import { assertWalletSocialDeployment, type WalletSocialDeployment } from '@soulidity/sdk'

export interface BrowserSocialConfig { deployment: WalletSocialDeployment; writesEnabled: boolean }

/** Social reads do not require Walrus upload configuration. No old registry or
 * network fallback is permitted when the fresh release is not configured. */
export function getBrowserSocialConfig(): BrowserSocialConfig {
  const deployment = assertWalletSocialDeployment({
    profile: {
      originalPackageId: process.env.NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID ?? '',
      callablePackageId: process.env.NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID ?? '',
      registryId: process.env.NEXT_PUBLIC_SOULIDITY_PROFILE_REGISTRY_ID ?? '',
      chainIdentifier: process.env.NEXT_PUBLIC_SUI_CHAIN_IDENTIFIER ?? '',
    },
    registryId: process.env.NEXT_PUBLIC_SOULIDITY_SOCIAL_REGISTRY_ID ?? '',
  })
  const writes = process.env.NEXT_PUBLIC_SOULIDITY_SOCIAL_WRITES_ENABLED
  if (writes !== 'true' && writes !== 'false') throw new Error('SOCIAL_WRITE_CONFIGURATION_REQUIRED')
  return { deployment, writesEnabled: writes === 'true' }
}
