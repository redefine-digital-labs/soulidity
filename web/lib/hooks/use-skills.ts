'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { SoulAssetDetail, SoulSkillVersionRecord, SoulSkillVersionsPageResponse } from '@/lib/soulidity/types'
import { assertObjectInputsExist } from '@/lib/soulidity/object-inputs'
import { fetchSkillAccess, loadDecryptedPrivateSkillVersion } from '@/lib/soulidity/skill-access'
import { buildAppendSkillVersionTx, buildDeleteSkillVersionTx } from '@/lib/soulidity/tx/skills'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'
import { uploadSoulPayload } from '@/lib/upload/client-upload'
import { createSkillSealSidecarFromMaterial, type PendingSealMaterial } from '@/lib/upload/client-seal'
import { useUploadCostReview } from '@/components/upload/upload-cost-review'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { extractSkillVersionAppendedEvent } from '@/lib/soulidity/events'
import {
  attachSoulidityDeploymentSignature,
  hasCurrentSoulidityDeploymentSignature,
} from '@/lib/soulidity/client-session'
import type { SealEnvelopeSidecar } from '@/lib/services/seal-crypto'

type PendingSkillAction = 'append' | 'delete' | 'read' | 'recovering' | null

const SKILL_APPEND_RECOVERY_KEY_PREFIX = 'soul-skill-append-recovery:'

type UploadedSkillPayload = {
  blobId: string
  blobObjectId: string | null
  sealMaterial?: PendingSealMaterial | null
  skillName?: string | null
}

interface SkillAppendSyncBody {
  txDigest: string
  skillsSealSidecar: SealEnvelopeSidecar | null
}

interface SkillAppendSyncMaterial {
  txDigest: string
  sealMaterial?: PendingSealMaterial | null
}

interface SkillAppendRecoveryState {
  userId: string
  soulOnChainId: string
  syncBody?: SkillAppendSyncBody | null
  pendingSync?: SkillAppendSyncMaterial | null
  deploymentSignature: string
}

function skillAppendRecoveryStorageKey(soulOnChainId: string) {
  return `${SKILL_APPEND_RECOVERY_KEY_PREFIX}${soulOnChainId}`
}

function isSkillAppendSyncBody(value: unknown): value is SkillAppendSyncBody {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SkillAppendSyncBody>
  return typeof candidate.txDigest === 'string'
    && candidate.txDigest.length > 0
    && (candidate.skillsSealSidecar === null || typeof candidate.skillsSealSidecar === 'object')
}

function isPendingSealMaterial(value: unknown): value is PendingSealMaterial {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PendingSealMaterial>
  return candidate.version === 1
    && typeof candidate.dek === 'string'
    && typeof candidate.iv === 'string'
    && typeof candidate.contentHash === 'string'
    && typeof candidate.mimeType === 'string'
    && typeof candidate.fileName === 'string'
}

function isSkillAppendSyncMaterial(value: unknown): value is SkillAppendSyncMaterial {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SkillAppendSyncMaterial>
  return typeof candidate.txDigest === 'string'
    && candidate.txDigest.length > 0
    && (candidate.sealMaterial == null || isPendingSealMaterial(candidate.sealMaterial))
}

export function sanitizeSkillAppendRecoveryState(
  raw: string | null,
  userId: string | null | undefined,
  soulOnChainId: string | null | undefined,
): SkillAppendRecoveryState | null {
  if (!raw || !userId || !soulOnChainId) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SkillAppendRecoveryState>
    if (
      parsed.userId !== userId
      || parsed.soulOnChainId !== soulOnChainId
      || (!isSkillAppendSyncBody(parsed.syncBody) && !isSkillAppendSyncMaterial(parsed.pendingSync))
      || !hasCurrentSoulidityDeploymentSignature(parsed)
    ) {
      return null
    }
    return {
      userId,
      soulOnChainId,
      syncBody: isSkillAppendSyncBody(parsed.syncBody) ? parsed.syncBody : null,
      pendingSync: isSkillAppendSyncMaterial(parsed.pendingSync) ? parsed.pendingSync : null,
      deploymentSignature: parsed.deploymentSignature,
    }
  } catch {
    return null
  }
}

function persistSkillAppendRecovery(storageKey: string, recovery: SkillAppendRecoveryState | null) {
  if (typeof window === 'undefined') return
  try {
    if (recovery) {
      sessionStorage.setItem(storageKey, JSON.stringify(recovery))
    } else {
      sessionStorage.removeItem(storageKey)
    }
  } catch {}
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
  const { getAuthHeaders, user } = useAuth()
  const { requestUploadCostApproval } = useUploadCostReview()
  const pendingRecoveryRef = useRef<Record<string, boolean>>({})
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

  const postAppendMirror = useCallback(async (
    soulOnChainId: string,
    syncBody: SkillAppendSyncBody,
  ) => {
    const authHeaders = await getAuthHeaders()
    const response = await fetch(`/api/souls/${encodeURIComponent(soulOnChainId)}/skills`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(syncBody),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(
        payload && typeof payload === 'object' && typeof payload.error === 'string'
          ? payload.error
          : 'Failed to mirror skill append transaction',
      )
    }
    return payload
  }, [getAuthHeaders])

  const buildSkillAppendSyncBody = useCallback(async (params: {
    txDigest: string
    txResult: unknown
    sealMaterial?: PendingSealMaterial | null
  }): Promise<SkillAppendSyncBody> => {
    let skillsSealSidecar: SealEnvelopeSidecar | null = null
    if (params.sealMaterial) {
      const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
      const appended = extractSkillVersionAppendedEvent(params.txResult as never, packageId)
      skillsSealSidecar = await createSkillSealSidecarFromMaterial({
        suiClient: suiClient as never,
        packageId,
        skillsObjectId: appended.skillsId,
        skillName: appended.skillName,
        versionIndex: appended.versionIndex,
        material: params.sealMaterial,
      })
    }
    return {
      txDigest: params.txDigest,
      skillsSealSidecar,
    }
  }, [suiClient])

  // Auto-resume effect: if a previous append signed the on-chain TX but the
  // Seal sidecar build or mirror POST failed (incl. across page reload), the
  // pending recovery row carries the txDigest plus raw Seal material so we
  // can rebuild the sidecar from material and complete the mirror without
  // re-uploading or re-signing a new skill version.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const soulOnChainId = soul?.onChainId
    const userId = user?.id
    if (!soulOnChainId || !userId) return
    if (pendingRecoveryRef.current[soulOnChainId]) return

    const storageKey = skillAppendRecoveryStorageKey(soulOnChainId)
    const recovery = sanitizeSkillAppendRecoveryState(
      sessionStorage.getItem(storageKey),
      userId,
      soulOnChainId,
    )
    if (!recovery) {
      try { sessionStorage.removeItem(storageKey) } catch {}
      return
    }

    pendingRecoveryRef.current[soulOnChainId] = true
    void (async () => {
      setPending('recovering')
      setError(null)
      try {
        let syncBody = recovery.syncBody ?? null
        if (!syncBody && recovery.pendingSync) {
          const txResult = await suiClient.getTransactionBlock({
            digest: recovery.pendingSync.txDigest,
            options: { showEvents: true, showObjectChanges: true, showEffects: true, showInput: true },
          })
          syncBody = await buildSkillAppendSyncBody({
            txDigest: recovery.pendingSync.txDigest,
            txResult,
            sealMaterial: recovery.pendingSync.sealMaterial,
          })
          recovery.syncBody = syncBody
          persistSkillAppendRecovery(storageKey, recovery)
        }
        if (!syncBody) {
          throw new Error('Pending skill append recovery is missing sync data')
        }
        await postAppendMirror(soulOnChainId, syncBody)
        persistSkillAppendRecovery(storageKey, null)
        await queryClient.invalidateQueries({ queryKey: ['soul', soulOnChainId] })
        await queryClient.invalidateQueries({ queryKey: ['soul-skill-versions', soulOnChainId] })
      } catch (nextError) {
        // Leave the recovery row so the user can retry on a subsequent mount.
        setError(
          nextError instanceof Error
            ? `Pending skill append mirror failed: ${nextError.message}`
            : 'Pending skill append mirror failed',
        )
      } finally {
        pendingRecoveryRef.current[soulOnChainId] = false
        setPending(null)
      }
    })()
  }, [soul?.onChainId, user?.id, postAppendMirror, queryClient, suiClient, buildSkillAppendSyncBody])

  async function uploadSkillFile(file: File, visibility: 'public' | 'private') {
    const authHeaders = await getAuthHeaders()
    const result = await uploadSoulPayload({
      file,
      uploadType: visibility === 'public' ? 'public' : 'encrypted',
      kind: 'soul-content',
      authHeaders,
      sendObjectTo: suiWallet?.address ?? null,
      walletAddress: suiWallet?.address ?? '',
      suiClient,
      signAndExecute,
      confirmQuote: requestUploadCostApproval,
    })
    const uploaded: UploadedSkillPayload = {
      blobId: result.blobId,
      blobObjectId: result.blobObjectId,
      sealMaterial: result.sealMaterial ?? null,
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
      if (visibility === 'private' && !uploaded.sealMaterial) {
        throw new Error('Private skill upload is missing Seal material')
      }
      const pendingSync: SkillAppendSyncMaterial = {
        txDigest: result.digest,
        sealMaterial: visibility === 'private' ? uploaded.sealMaterial : null,
      }

      // Persist raw Seal material + tx digest BEFORE calling Seal key servers
      // and BEFORE the mirror POST. If sidecar creation or the mirror fails
      // (incl. page reload), the auto-resume effect can rebuild the sidecar
      // from the persisted material and complete the mirror without minting
      // a new skill version on chain.
      const storageKey = skillAppendRecoveryStorageKey(soul.onChainId)
      let recovery: SkillAppendRecoveryState | null = null
      if (user?.id && typeof window !== 'undefined') {
        recovery = attachSoulidityDeploymentSignature({
          userId: user.id,
          soulOnChainId: soul.onChainId,
          pendingSync,
          syncBody: null,
        })
        persistSkillAppendRecovery(storageKey, recovery)
      }

      const syncBody = await buildSkillAppendSyncBody({
        txDigest: result.digest,
        txResult: result,
        sealMaterial: pendingSync.sealMaterial,
      })
      if (recovery) {
        recovery.syncBody = syncBody
        persistSkillAppendRecovery(storageKey, recovery)
      }

      const payload = await postAppendMirror(soul.onChainId, syncBody)
      persistSkillAppendRecovery(storageKey, null)

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
