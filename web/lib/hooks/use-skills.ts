'use client'

import { useMemo, useState } from 'react'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { SoulAssetDetail, SoulSkillVersionRecord, SoulSkillVersionsPageResponse } from '@/lib/soulidity/types'
import { assertObjectInputsExist } from '@/lib/soulidity/object-inputs'
import { fetchSkillAccess, loadDecryptedPrivateSkillVersion } from '@/lib/soulidity/skill-access'
import { buildAppendSkillVersionTx, buildDeleteSkillVersionTx } from '@/lib/soulidity/tx/skills'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'
import { uploadSoulPayload } from '@/lib/upload/client-upload'

type PendingSkillAction = 'append' | 'delete' | 'read' | null

type UploadedSkillPayload = {
  blobId: string
  blobObjectId: string | null
  sealDekEnvelope?: string | null
  skillName?: string | null
}

function sameSuiAddress(left: string, right: string) {
  try {
    return normalizeSuiAddress(left) === normalizeSuiAddress(right)
  } catch {
    return false
  }
}

function createDownloadLink(blob: Blob, fileName: string) {
  const blobUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = blobUrl
  anchor.download = fileName
  document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
  }
}

export function useSkills(soul: SoulAssetDetail | null) {
  const [pending, setPending] = useState<PendingSkillAction>(null)
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const { suiWallet, signAndExecute, signPersonalMessage, suiClient } = useWalletSign()
  const { getAuthHeaders } = useAuth()
  const skillVersionsQuery = useInfiniteQuery<SoulSkillVersionsPageResponse>({
    queryKey: ['soul-skill-versions', soul?.onChainId ?? null],
    enabled: Boolean(soul?.onChainId),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      if (!soul?.onChainId) {
        throw new Error('Soul is required to fetch skill versions')
      }
      const searchParams = new URLSearchParams({ limit: '50' })
      if (typeof pageParam === 'string' && pageParam.length > 0) {
        searchParams.set('cursor', pageParam)
      }
      const response = await fetch(
        `/api/souls/${encodeURIComponent(soul.onChainId)}/skills?${searchParams.toString()}`,
        { cache: 'no-store' },
      )
      if (!response.ok) {
        throw new Error('Failed to fetch skill versions')
      }
      return response.json()
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

  const skillGrant = useMemo(() => {
    if (!soul || !suiWallet) return null
    return soul.activeGrants.find((grant) =>
      grant.status === 'active'
      && grant.scopes.includes('skills')
      && sameSuiAddress(grant.granteeAddress, suiWallet.address),
    ) ?? null
  }, [soul, suiWallet])

  const canManageSkills = Boolean(soul?.skillsOnChainId) && (soul?.isOwner || skillGrant != null)
  const skillVersions = skillVersionsQuery.data?.pages.length
    ? skillVersionsQuery.data.pages.flatMap((page) => page.items)
    : soul?.skillVersions ?? []
  const skillVersionCount = skillVersionsQuery.data?.pages[0]?.total ?? soul?.skillVersionCount ?? skillVersions.length

  async function uploadSkillFile(file: File, visibility: 'public' | 'private') {
    const authHeaders = await getAuthHeaders()
    const result = await uploadSoulPayload({
      file,
      uploadType: visibility === 'public' ? 'public' : 'encrypted',
      kind: 'soul-content',
      authHeaders,
      sendObjectTo: suiWallet?.address ?? null,
    })
    const uploaded: UploadedSkillPayload = {
      blobId: result.blobId,
      blobObjectId: result.blobObjectId,
      sealDekEnvelope: result.sealDekEnvelope ?? null,
      skillName: result.skillName ?? null,
    }
    if (!uploaded.blobObjectId) {
      throw new Error('Uploaded skill payload is missing blobObjectId')
    }
    return uploaded
  }

  async function appendSkillVersion(file: File, visibility: 'public' | 'private') {
    if (!soul || !suiWallet) {
      throw new Error('Sign in and load the Soul before appending a skill version')
    }
    if (!soul.skillsOnChainId) {
      throw new Error('This Soul was minted without a skills root')
    }
    if (!soul.isOwner && !skillGrant) {
      throw new Error('Only the owner or a skills-granted wallet can append versions')
    }

    setPending('append')
    setError(null)
    try {
      const uploaded = await uploadSkillFile(file, visibility)
      const blobObjectId = uploaded.blobObjectId
      if (!blobObjectId) {
        throw new Error('Uploaded skill payload is missing blobObjectId')
      }
      const skillName = typeof uploaded.skillName === 'string' ? uploaded.skillName.trim() : ''
      if (!skillName) {
        throw new Error('Uploaded skill bundle is missing skillName')
      }
      await assertObjectInputsExist(suiClient, {
        'Soul state': soul.stateOnChainId,
        'Skills root': soul.skillsOnChainId,
        'Uploaded skill bundle': blobObjectId,
        'Skills grant': soul.isOwner ? null : skillGrant?.onChainId ?? null,
      })
      const tx = buildAppendSkillVersionTx({
        stateObjectId: soul.stateOnChainId,
        skillsObjectId: soul.skillsOnChainId,
        skillName,
        blobObjectId,
        visibility,
        grantObjectId: soul.isOwner ? null : skillGrant?.onChainId ?? null,
      })
      const result = await signAndExecute(tx)
      const authHeaders = await getAuthHeaders()
      const response = await fetch(`/api/souls/${encodeURIComponent(soul.onChainId)}/skills`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txDigest: result.digest,
          rawSkillsEnvelope: visibility === 'private' ? uploaded.sealDekEnvelope ?? null : null,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(
          payload && typeof payload === 'object' && typeof payload.error === 'string'
            ? payload.error
            : 'Failed to mirror skill append transaction',
        )
      }

      await queryClient.invalidateQueries({ queryKey: ['soul', soul.onChainId] })
      await queryClient.invalidateQueries({ queryKey: ['soul-skill-versions', soul.onChainId] })
      return payload
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : 'Failed to append skill version'
      setError(nextMessage)
      throw nextError
    } finally {
      setPending(null)
    }
  }

  async function deleteSkillVersion(version: SoulSkillVersionRecord) {
    if (!soul || !suiWallet) {
      throw new Error('Sign in and load the Soul before deleting a skill version')
    }
    if (!soul.skillsOnChainId) {
      throw new Error('This Soul does not have a skills root')
    }
    if (!soul.isOwner && !skillGrant) {
      throw new Error('Only the owner or a skills-granted wallet can delete versions')
    }

    setPending('delete')
    setError(null)
    try {
      await assertObjectInputsExist(suiClient, {
        'Soul state': soul.stateOnChainId,
        'Skills root': soul.skillsOnChainId,
        'Skills grant': soul.isOwner ? null : skillGrant?.onChainId ?? null,
      })
      const tx = buildDeleteSkillVersionTx({
        stateObjectId: soul.stateOnChainId,
        skillsObjectId: soul.skillsOnChainId,
        skillName: version.skillName,
        versionIndex: version.versionIndex,
        grantObjectId: soul.isOwner ? null : skillGrant?.onChainId ?? null,
      })
      const result = await signAndExecute(tx)
      const authHeaders = await getAuthHeaders()
      const response = await fetch(
        `/api/souls/${encodeURIComponent(soul.onChainId)}/skills/${encodeURIComponent(version.skillName)}/versions/${encodeURIComponent(String(version.versionIndex))}/delete`,
        {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ txDigest: result.digest }),
        },
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(
          payload && typeof payload === 'object' && typeof payload.error === 'string'
            ? payload.error
            : 'Failed to mirror skill delete transaction',
        )
      }

      await queryClient.invalidateQueries({ queryKey: ['soul', soul.onChainId] })
      await queryClient.invalidateQueries({ queryKey: ['soul-skill-versions', soul.onChainId] })
      return payload
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : 'Failed to delete skill version'
      setError(nextMessage)
      throw nextError
    } finally {
      setPending(null)
    }
  }

  async function openSkillVersion(version: SoulSkillVersionRecord) {
    if (!soul) {
      throw new Error('Load the Soul before opening a skill version')
    }

    setPending('read')
    setError(null)
    try {
      const access = await fetchSkillAccess({
        soulObjectId: soul.onChainId,
        skillName: version.skillName,
        versionIndex: version.versionIndex,
        getAuthHeaders,
      })

      if (access.visibility === 'public') {
        if (!access.artifact.walrusBlobUrl) {
          throw new Error('Public skill blob URL is missing')
        }
        window.open(access.artifact.walrusBlobUrl, '_blank', 'noopener,noreferrer')
        return access
      }

      if (!suiWallet) {
        throw new Error('Bind a Sui wallet before decrypting a private skill version')
      }

      const decrypted = await loadDecryptedPrivateSkillVersion({
        access,
        signPersonalMessage,
        suiClient,
      })
      try {
        createDownloadLink(
          new Blob([decrypted.bytes], { type: decrypted.mimeType || 'application/octet-stream' }),
          decrypted.fileName || `soul-skill-${version.skillName}-v${version.versionIndex}.bin`,
        )
      } finally {
        decrypted.bytes.fill(0)
      }

      return access
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : 'Failed to open skill version'
      setError(nextMessage)
      throw nextError
    } finally {
      setPending(null)
    }
  }

  return {
    pending,
    error,
    canManageSkills,
    skillGrant,
    skillVersions,
    skillVersionCount,
    skillsLoading: skillVersionsQuery.isLoading,
    hasMoreSkillVersions: Boolean(skillVersionsQuery.hasNextPage),
    loadingMoreSkillVersions: skillVersionsQuery.isFetchingNextPage,
    loadMoreSkillVersions: () => skillVersionsQuery.fetchNextPage(),
    appendSkillVersion,
    deleteSkillVersion,
    openSkillVersion,
  }
}
