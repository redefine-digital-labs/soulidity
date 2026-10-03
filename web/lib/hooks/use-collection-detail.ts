'use client'

import { usePublicCollectionDetailSource, usePublicCollectionMembersSource } from './use-public-market'
import { projectCollectionDetail } from '../collections/collection-detail-model'

export function useCollectionDetail(id: string, page = 1) {
  const detail = usePublicCollectionDetailSource(id), members = usePublicCollectionMembersSource(id)
  let data: ReturnType<typeof projectCollectionDetail> | undefined, projectionError: Error | null = null
  if (detail.page?.collection && detail.config) {
    try { data = projectCollectionDetail({ snapshot: detail.page.collection, souls: members.page?.souls ?? [],
      coverage: members.coverage, viewerAddress: detail.viewerAddress,
      originalPackageId: detail.config.native.soulidityOriginalPackageId, page }) }
    catch (cause) { projectionError = cause instanceof Error ? cause : new Error('Collection observations unavailable.') }
  }
  return { data, isLoading: detail.isLoading || !data && !projectionError && !detail.error && detail.progress.busy,
    error: projectionError ?? detail.error,
    identityKey: detail.identityKey, detail, members }
}
