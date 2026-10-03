'use client'

import { useCallback, useLayoutEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CANONICAL_MEMORY_NAME, KIND_SPRITE, NO_DOWNLOAD_POLICY, READ_GRANT, READ_OWNER, READ_PUBLIC } from '@soulidity/sdk'
import type { ChainSoulDetail, ChainSoulContentVersion } from '@/lib/soulidity/soul-detail-model'
import { useSoulContentRead } from './use-soul-content-read'
import { useSoulContentAppend } from './use-soul-content-append'
import { useSoulContentMutations } from './use-soul-content-mutations'

export interface UseSoulContentActionsState {
  pendingAction: 'append' | 'open' | 'delete' | 'purge' | 'set-active' | 'clear-active' | 'recovery' | null
  contentActionError: string | null
}
interface UseSoulContentActionsParams {
  soul: ChainSoulDetail; role: 'owner' | 'grantee' | 'visitor'; detailQueryId: string; viewerId?: string | null
}
function defaultSlotReadModeFor(kind: number, visibility?: 'public' | 'private') {
  return READ_OWNER | READ_GRANT | (kind === KIND_SPRITE && visibility === 'public' ? READ_PUBLIC : 0)
}
export function useSoulContentActions({ soul, role, detailQueryId }: UseSoulContentActionsParams) {
  const queryClient = useQueryClient(), readOrAppendPending = useRef(false)
  const invalidateSoul = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['soul', detailQueryId] })
    void queryClient.invalidateQueries({ queryKey: ['soul', soul.onChainId] })
  }, [detailQueryId, queryClient, soul.onChainId])
  const mutations = useSoulContentMutations(soul, invalidateSoul, () => readOrAppendPending.current)
  const contentAppend = useSoulContentAppend(soul, role, mutations.pending, invalidateSoul)
  const contentRead = useSoulContentRead(soul, mutations.pending || contentAppend.pending)
  useLayoutEffect(() => {
    readOrAppendPending.current = contentAppend.pending || contentRead.pending
  }, [contentAppend.pending, contentRead.pending])
  const target = (version: ChainSoulContentVersion) => ({ name: version.name, versionIndex: version.versionIndex })
  return {
    pendingAction: mutations.pendingAction ?? (contentAppend.pending ? 'append' as const : contentRead.pending ? 'open' as const : null),
    contentActionError: mutations.error ?? contentAppend.error ?? contentRead.error,
    contentAppend, contentMutations: mutations, privacyKey: contentRead.privacyKey, defaultSlotReadModeFor,
    appendContentVersion: contentAppend.append, openContentVersion: contentRead.openContentVersion, decryptContentVersion: contentRead.decryptContentVersion,
    deleteContentVersion: (version: ChainSoulContentVersion) => mutations.mutate('delete', version.kind, target(version)),
    purgeContentVersion: (version: ChainSoulContentVersion) => mutations.mutate('purge', version.kind, target(version)),
    setActiveContent: (kind: number, name: string, versionIndex: string) => mutations.mutate('set-active', kind, { name, versionIndex }),
    clearActiveContent: (kind: number) => mutations.mutate('clear-active', kind, null),
    canUseContentActions: role === 'owner' || role === 'grantee', canonicalMemoryName: CANONICAL_MEMORY_NAME, noDownloadPolicy: NO_DOWNLOAD_POLICY,
  }
}
