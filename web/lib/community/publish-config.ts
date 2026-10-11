import { getBrowserCommunityReadConfig } from './public-post-read'

/** Inspection/query never needs the paid-write switch enabled. */
export const getBrowserCommunityPublishReadConfig = getBrowserCommunityReadConfig
export function getBrowserCommunityPublishWritesEnabled(): boolean {
  const value = process.env.NEXT_PUBLIC_SOULIDITY_COMMUNITY_WRITES_ENABLED
  if (value !== 'true' && value !== 'false') throw new Error('COMMUNITY_PUBLISH_WRITE_CONFIGURATION_REQUIRED')
  return value === 'true'
}
