import { assertPublicCommunityDeployment } from '@soulidity/sdk'
import { getBrowserCommunityPublishWritesEnabled } from './publish-config'

/** Acceptance is chain-only: no vote registry or storage service is required. */
export function getBrowserCommunityAcceptDeployment() {
  return assertPublicCommunityDeployment({ profile: {
    originalPackageId: process.env.NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID ?? '',
    callablePackageId: process.env.NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID ?? '',
    registryId: process.env.NEXT_PUBLIC_SOULIDITY_PROFILE_REGISTRY_ID ?? '',
    chainIdentifier: process.env.NEXT_PUBLIC_SUI_CHAIN_IDENTIFIER ?? '',
  }, registryId: process.env.NEXT_PUBLIC_SOULIDITY_COMMUNITY_REGISTRY_ID ?? '' })
}
export const getBrowserCommunityAcceptWritesEnabled = getBrowserCommunityPublishWritesEnabled
