'use client'

import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/components/providers/auth-provider'
import { getBrowserCommunityVoteConfig } from '@/lib/community/public-post-vote-read'
import { readBrowserCommunityPostDetail } from '@/lib/community/post-detail-read'
import { useWalletSign } from './use-wallet-sign'

/** Full release/storage/viewer in the cache key: neither SQL IDs nor another
 * wallet's vote selection can be reused by the new detail page. */
export function useCommunityPostDetail(postId: string | null) {
  const { walletAddress } = useAuth(), { suiGrpcClient } = useWalletSign()
  let config: ReturnType<typeof getBrowserCommunityVoteConfig> | null = null, configError: unknown
  try { config = structuredClone(getBrowserCommunityVoteConfig()) } catch (error) { configError = error }
  return useQuery({
    queryKey: ['community-chain-post', config, postId, walletAddress],
    enabled: !!postId,
    queryFn: async ({ signal }) => {
      if (!config) throw configError
      if (!postId || !/^0x[0-9a-f]{64}$/.test(postId) || /^0x0+$/.test(postId)) throw new Error('COMMUNITY_CHAIN_POST_ID_REQUIRED')
      return readBrowserCommunityPostDetail({ client: suiGrpcClient, config, postId, viewerAddress: walletAddress, signal })
    },
  })
}
