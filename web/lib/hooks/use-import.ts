'use client'

import { useEffect, useRef, useState } from 'react'
import posthog from 'posthog-js'
import type { Transaction } from '@mysten/sui/transactions'
import { assertObjectInputsExist } from '@/lib/soulidity/object-inputs'
import { buildImportSoulTx } from '@/lib/soulidity/tx/import'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useAuth } from '@/components/providers/auth-provider'
import {
  attachSoulidityDeploymentSignature,
  hasCurrentSoulidityDeploymentSignature,
} from '@/lib/soulidity/client-session'
import { normalizeTags } from '@/lib/soulidity/tags'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { extractAllContentVersionAppendedEvents } from '@/lib/soulidity/events'
import { type PendingSealMaterial } from '@/lib/upload/client-seal'
import { assertSoulidityTxSucceeded } from '@/lib/soulidity/market-errors'
import {
  buildContentSidecarsForVersionsWithSuiClient,
  buildPendingMintSlots,
  buildPhase2InitialContent,
  type ContentSidecarRequestEntry,
} from '@/lib/hooks/phase2-mint-helpers'

const IMPORT_RECOVERY_KEY = 'soul-import-recovery'

interface ImportRecoveryState {
  userId: string
  txDigest: string
  syncBody?: ImportSyncBody | null
  pendingSync?: ImportSyncMaterial | null
  deploymentSignature: string
}

export type ImportStatus = 'idle' | 'building' | 'signing' | 'syncing' | 'done' | 'error'

export interface ImportSyncResponse {
  txDigest: string
  soulOnChainId: string
  provenanceKind: string
  originRef: string
}

interface ImportSyncBody {
  txDigest: string
  tags: string[]
  previewImages: string[]
  readme: string | null
  contentSidecars: ContentSidecarRequestEntry[]
}

type ImportSyncMaterial = Pick<
  ImportParams,
  | 'tags'
  | 'previewImages'
  | 'readme'
  | 'sealMaterial'
  | 'memorySealMaterial'
  | 'skillsSealMaterial'
  | 'initialSkillName'
>

export interface ImportParams {
  name: string
  description: string
  tags: string[]
  imageUrl: string
  previewImages: string[]
  readme?: string | null
  protectedBlobObjectId: string
  /** Required on first call. May be omitted only on the resume path, where the
   *  PTB has already been signed and `buildPhase2InitialContent` is skipped. */
  foundingMemoryBlobObjectId?: string | null
  skillsBlobObjectId?: string | null
  initialSkillName?: string | null
  skillsVisibility?: 'public' | 'private'
  originRef: string
  creatorRoyaltyBps: number
  sealMaterial?: PendingSealMaterial | null
  memorySealMaterial?: PendingSealMaterial | null
  skillsSealMaterial?: PendingSealMaterial | null
}

async function resolvePersonalKiosk(headers: Record<string, string>, walletAddress: string) {
  const url = `/api/souls/personal-kiosk?walletAddress=${encodeURIComponent(walletAddress)}`
  const res = await fetch(url, { cache: 'no-store', headers })
  if (res.status === 404) return null
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Failed to resolve personal kiosk')
  }
  return res.json()
}

function isImportSyncBody(value: unknown): value is ImportSyncBody {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ImportSyncBody>
  return typeof candidate.txDigest === 'string'
    && Array.isArray(candidate.tags)
    && Array.isArray(candidate.previewImages)
    && (candidate.readme === null || typeof candidate.readme === 'string')
    && Array.isArray(candidate.contentSidecars)
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

function isOptionalPendingSealMaterial(value: unknown): value is PendingSealMaterial | null | undefined {
  return value == null || isPendingSealMaterial(value)
}

function isImportSyncMaterial(value: unknown): value is ImportSyncMaterial {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ImportSyncMaterial>
  return Array.isArray(candidate.tags)
    && candidate.tags.every((tag) => typeof tag === 'string')
    && Array.isArray(candidate.previewImages)
    && candidate.previewImages.every((image) => typeof image === 'string')
    && (candidate.readme == null || typeof candidate.readme === 'string')
    && isOptionalPendingSealMaterial(candidate.sealMaterial)
    && isOptionalPendingSealMaterial(candidate.memorySealMaterial)
    && isOptionalPendingSealMaterial(candidate.skillsSealMaterial)
}

function buildImportSyncMaterial(params: ImportParams): ImportSyncMaterial {
  return {
    tags: params.tags,
    previewImages: params.previewImages,
    readme: params.readme ?? null,
    sealMaterial: params.sealMaterial ?? null,
    memorySealMaterial: params.memorySealMaterial ?? null,
    skillsSealMaterial: params.skillsSealMaterial ?? null,
    initialSkillName: params.initialSkillName ?? null,
  }
}

function persistImportRecovery(recovery: ImportRecoveryState | null) {
  if (typeof window === 'undefined') return
  try {
    if (recovery) {
      sessionStorage.setItem(IMPORT_RECOVERY_KEY, JSON.stringify(recovery))
    } else {
      sessionStorage.removeItem(IMPORT_RECOVERY_KEY)
    }
  } catch {}
}

async function buildImportSyncBody(params: {
  txDigest: string
  txResult: unknown
  importParams: ImportSyncMaterial
  suiClient: unknown
}): Promise<ImportSyncBody> {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const versions = extractAllContentVersionAppendedEvents(params.txResult as never, packageId)
  const contentObjectId = versions.length > 0 ? versions[0].contentId : null
  if (!contentObjectId) {
    throw new Error('Soul import transaction is missing ContentVersionAppended events')
  }

  const pendingByKindName = buildPendingMintSlots({
    soulMaterial: params.importParams.sealMaterial ?? null,
    memoryMaterial: params.importParams.memorySealMaterial ?? null,
    skillsMaterial: params.importParams.skillsSealMaterial ?? null,
    skillsName: params.importParams.initialSkillName,
  })

  const contentSidecars = await buildContentSidecarsForVersionsWithSuiClient({
    suiClient: params.suiClient as never,
    packageId,
    contentObjectId,
    pendingByKindName,
    versions: versions.map((v) => ({
      kind: v.kind,
      name: v.name,
      versionIndex: v.versionIndex,
      sealEncrypted: v.sealEncrypted,
    })),
  })

  return {
    txDigest: params.txDigest,
    tags: normalizeTags(params.importParams.tags),
    previewImages: params.importParams.previewImages,
    readme: params.importParams.readme ?? null,
    contentSidecars,
  }
}

export function useImport() {
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txDigest, setTxDigest] = useState<string | null>(null)
  const [importData, setImportData] = useState<ImportSyncResponse | null>(null)
  const { suiWallet, signAndExecute, suiClient } = useWalletSign()
  const { getAuthHeaders, user } = useAuth()
  const recoveryRef = useRef<ImportRecoveryState | null>(null)

  // Hydrate pending recovery state from sessionStorage
  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      try {
        const raw = sessionStorage.getItem(IMPORT_RECOVERY_KEY)
        if (raw) {
          const recovery: ImportRecoveryState = JSON.parse(raw)
          const hasRecoverablePayload = isImportSyncBody(recovery.syncBody) || isImportSyncMaterial(recovery.pendingSync)
          if (recovery.txDigest && hasRecoverablePayload && recovery.userId === user?.id && hasCurrentSoulidityDeploymentSignature(recovery)) {
            recoveryRef.current = recovery
            setTxDigest(recovery.txDigest)
          } else if (user?.id) {
            sessionStorage.removeItem(IMPORT_RECOVERY_KEY)
          }
        }
      } catch { /* ignore */ }
    })
    return () => { cancelled = true }
  }, [user?.id])

  async function importSoul(params: ImportParams) {
    if (!suiWallet) {
      setError('Please sign in first')
      setStatus('error')
      return
    }

    const startedAt = Date.now()
    posthog.capture('soul_import_started', { resumed: Boolean(txDigest) })
    try {
      setError(null)
      const authHeaders = await getAuthHeaders()

      let digest = txDigest
      if (!digest) {
        setStatus('building')
        if (!params.foundingMemoryBlobObjectId) {
          throw new Error('foundingMemoryBlobObjectId is required for a fresh import (Phase 2 mints must seed at least one MEMORY entry)')
        }
        const personalKiosk = await resolvePersonalKiosk(authHeaders, suiWallet.address)
        await assertObjectInputsExist(suiClient, {
          'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
          'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
          'Soul character blob': params.protectedBlobObjectId,
          'Founding memory blob': params.foundingMemoryBlobObjectId,
          'Skills blob': params.skillsBlobObjectId ?? null,
        })
        const { initialContent, initialStateConfig } = buildPhase2InitialContent({
          protectedBlobObjectId: params.protectedBlobObjectId,
          foundingMemoryBlobObjectId: params.foundingMemoryBlobObjectId,
          skillsBlobObjectId: params.skillsBlobObjectId,
          initialSkillName: params.initialSkillName,
          initialSkillVisibility: params.skillsVisibility ?? null,
        })
        const tx: Transaction = buildImportSoulTx({
          currentKioskId: personalKiosk?.currentKioskId ?? null,
          currentKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
          name: params.name,
          description: params.description,
          imageUrl: params.imageUrl,
          initialContent,
          initialStateConfig,
          originRef: params.originRef,
          creatorRoyaltyBps: params.creatorRoyaltyBps,
        })

        setStatus('signing')
        const result = await signAndExecute(tx)
        const executedDigest = result.digest
        assertSoulidityTxSucceeded(result, 'Soul import transaction')
        digest = executedDigest
        setTxDigest(executedDigest)
        posthog.capture('soul_import_sui_signed', {
          txDigest: executedDigest,
          elapsedMs: Date.now() - startedAt,
        })

        const pendingSync = buildImportSyncMaterial(params)
        const recovery: ImportRecoveryState = attachSoulidityDeploymentSignature({
          userId: user?.id ?? '',
          txDigest: executedDigest,
          pendingSync,
          syncBody: null,
        })
        recoveryRef.current = recovery
        persistImportRecovery(recovery)

        const syncBody = await buildImportSyncBody({
          txDigest: executedDigest,
          txResult: result,
          importParams: pendingSync,
          suiClient,
        })
        const recoveryWithSyncBody = { ...recovery, syncBody }
        recoveryRef.current = recoveryWithSyncBody
        persistImportRecovery(recoveryWithSyncBody)
      }

      // Use recovered sync body when available
      if (!digest) {
        throw new Error('Import transaction digest is missing')
      }
      const recovery = recoveryRef.current?.txDigest === digest ? recoveryRef.current : null
      let syncBody = recovery?.syncBody ?? null
      if (!syncBody) {
        const pendingSync = recovery?.pendingSync ?? buildImportSyncMaterial(params)
        syncBody = await buildImportSyncBody({
          txDigest: digest,
          txResult: await suiClient.getTransactionBlock({
            digest,
            options: { showEvents: true, showObjectChanges: true, showEffects: true, showInput: true },
          }),
          importParams: pendingSync,
          suiClient,
        })
        if (recovery) {
          const recoveryWithSyncBody = { ...recovery, syncBody }
          recoveryRef.current = recoveryWithSyncBody
          persistImportRecovery(recoveryWithSyncBody)
        }
      }

      setStatus('syncing')
      const syncRes = await fetch('/api/import', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(syncBody),
      })
      if (!syncRes.ok) {
        const body = await syncRes.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to mirror import')
      }

      const syncData: ImportSyncResponse = await syncRes.json()
      setImportData(syncData)
      setStatus('done')
      posthog.capture('soul_import_completed', {
        txDigest: digest,
        elapsedMs: Date.now() - startedAt,
      })

      // Clear recovery on success
      recoveryRef.current = null
      persistImportRecovery(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Import failed')
      setStatus('error')
      posthog.captureException(
        nextError instanceof Error ? nextError : new Error(String(nextError)),
        {
          scope: 'soul_import',
          phase: status,
          txDigest,
          elapsedMs: Date.now() - startedAt,
        },
      )
    }
  }

  return { status, error, txDigest, importData, importSoul, suiWallet }
}
