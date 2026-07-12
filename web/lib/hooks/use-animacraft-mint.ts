'use client'

import { useEffect, useRef, useState } from 'react'
import { strToU8, zipSync } from 'fflate'
import { normalizeStructTag } from '@mysten/sui/utils'
import {
  appendAnimacraftSoulMintAuthorization,
  attachSoulidityDeploymentSignature,
  assertObjectInputsExist,
  assertSoulidityTxSucceeded,
  buildMintAnimacraftSoulTx,
  equalAnimacraftRecipeHash,
  extractAllContentVersionAppendedEvents,
  extractAllSoulMintedToKioskEvents,
  getRequiredSoulidityEnv,
  hasCurrentSoulidityDeploymentSignature,
  hashAnimacraftRecipe,
  normalizeTags,
  parseAnimacraftRecipeHashHex,
  selectCoinObjectIdsForAmountAcrossPages,
} from '@soulidity/sdk'
import { useAuth } from '@/components/providers/auth-provider'
import { useUploadCostReview } from '@/components/upload/upload-cost-review'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { prepareSoulBlobsForBatchPublish } from '@/lib/upload/client-upload'
import {
  buildContentSidecarsForVersionsWithSuiClient,
  buildPendingMintSlots,
  buildPhase2InitialContent,
  type ContentSidecarRequestEntry,
} from '@/lib/hooks/phase2-mint-helpers'
import type { PendingSealMaterial } from '@/lib/upload/client-seal'
import type {
  AnimacraftIntegrationConfig,
  AnimacraftMakerState,
  ParsedAnimacraftHandoff,
} from '@/lib/animacraft/handoff'

export type AnimacraftMintStatus =
  | 'idle'
  | 'preflight'
  | 'uploading'
  | 'signing'
  | 'syncing'
  | 'done'
  | 'error'

export interface AnimacraftMintInput {
  config: AnimacraftIntegrationConfig
  handoff: ParsedAnimacraftHandoff
  maker: AnimacraftMakerState
  profileJsonBlobId: string
  imageBlobId: string
  imageUrl: string
  recipeHashHex: string
}

interface MintResult {
  txDigest: string
  soulOnChainId: string
}

const ANIMACRAFT_MINT_RECOVERY_KEY = 'animacraft-soul-mint-recovery'

interface AnimacraftSyncBody {
  txDigest: string
  soulOnChainId: string
  tags: string[]
  previewImages: string[]
  readme: string
  contentSidecars: ContentSidecarRequestEntry[]
  currentKioskCapOnChainId: string | null
}

interface AnimacraftPendingSync {
  tags: string[]
  previewImages: string[]
  readme: string
  currentKioskCapOnChainId: string | null
  soulMaterial: PendingSealMaterial
  memoryMaterial: PendingSealMaterial
  skillsMaterial: PendingSealMaterial
  skillName: string
}

interface AnimacraftMintRecovery {
  userId: string
  txDigest: string
  soulOnChainId: string
  pendingSync: AnimacraftPendingSync | null
  syncBody: AnimacraftSyncBody | null
  deploymentSignature: string
}

function isSealMaterial(value: unknown): value is PendingSealMaterial {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PendingSealMaterial>
  return candidate.version === 1
    && typeof candidate.dek === 'string'
    && typeof candidate.iv === 'string'
    && typeof candidate.contentHash === 'string'
    && typeof candidate.mimeType === 'string'
    && typeof candidate.fileName === 'string'
}

function isPendingSync(value: unknown): value is AnimacraftPendingSync {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AnimacraftPendingSync>
  return Array.isArray(candidate.tags)
    && candidate.tags.every((tag) => typeof tag === 'string')
    && Array.isArray(candidate.previewImages)
    && candidate.previewImages.every((url) => typeof url === 'string')
    && typeof candidate.readme === 'string'
    && (candidate.currentKioskCapOnChainId == null || typeof candidate.currentKioskCapOnChainId === 'string')
    && isSealMaterial(candidate.soulMaterial)
    && isSealMaterial(candidate.memoryMaterial)
    && isSealMaterial(candidate.skillsMaterial)
    && typeof candidate.skillName === 'string'
}

function isSyncBody(value: unknown): value is AnimacraftSyncBody {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AnimacraftSyncBody>
  return typeof candidate.txDigest === 'string'
    && typeof candidate.soulOnChainId === 'string'
    && Array.isArray(candidate.tags)
    && Array.isArray(candidate.previewImages)
    && typeof candidate.readme === 'string'
    && Array.isArray(candidate.contentSidecars)
    && (candidate.currentKioskCapOnChainId == null || typeof candidate.currentKioskCapOnChainId === 'string')
}

function persistRecovery(recovery: AnimacraftMintRecovery | null) {
  if (typeof window === 'undefined') return
  try {
    if (recovery) sessionStorage.setItem(ANIMACRAFT_MINT_RECOVERY_KEY, JSON.stringify(recovery))
    else sessionStorage.removeItem(ANIMACRAFT_MINT_RECOVERY_KEY)
  } catch {}
}

async function buildSyncBody(params: {
  txDigest: string
  soulOnChainId: string
  txResult: unknown
  pendingSync: AnimacraftPendingSync
  suiClient: unknown
}): Promise<AnimacraftSyncBody> {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const minted = extractAllSoulMintedToKioskEvents(params.txResult as never, packageId)
    .find((event) => event.soulId === params.soulOnChainId)
  if (!minted) throw new Error('Canonical mint transaction is missing the expected Soul event')
  const versions = extractAllContentVersionAppendedEvents(params.txResult as never, packageId)
    .filter((version) => version.soulId === minted.soulId)
  if (versions.length === 0) throw new Error('Canonical mint transaction is missing Living Content events')
  const contentSidecars = await buildContentSidecarsForVersionsWithSuiClient({
    suiClient: params.suiClient as never,
    packageId,
    contentObjectId: minted.contentId,
    pendingByKindName: buildPendingMintSlots({
      soulMaterial: params.pendingSync.soulMaterial,
      memoryMaterial: params.pendingSync.memoryMaterial,
      skillsMaterial: params.pendingSync.skillsMaterial,
      skillsName: params.pendingSync.skillName,
    }),
    versions: versions.map((version) => ({
      kind: version.kind,
      name: version.name,
      versionIndex: version.versionIndex,
      sealEncrypted: version.sealEncrypted,
    })),
  })
  return {
    txDigest: params.txDigest,
    soulOnChainId: minted.soulId,
    tags: normalizeTags(params.pendingSync.tags),
    previewImages: params.pendingSync.previewImages,
    readme: params.pendingSync.readme,
    contentSidecars,
    currentKioskCapOnChainId: params.pendingSync.currentKioskCapOnChainId,
  }
}

async function resolvePersonalKiosk(
  headers: Record<string, string>,
  walletAddress: string,
) {
  const response = await fetch(
    `/api/souls/personal-kiosk?walletAddress=${encodeURIComponent(walletAddress)}`,
    { cache: 'no-store', headers },
  )
  if (response.status === 404) return null
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error ?? 'Failed to resolve the Soulidity personal kiosk')
  }
  return response.json() as Promise<{
    currentKioskId: string
    currentKioskCapOnChainId: string
  }>
}

function livingContentFiles(
  handoff: ParsedAnimacraftHandoff,
  walletAddress: string,
  profileJsonBlobId: string,
) {
  const uniqueMarker = `\n\n<!-- animacraft-owner:${walletAddress}; profile:${profileJsonBlobId} -->\n`
  const skillZip = zipSync({
    'SKILL.md': strToU8(`${handoff.skillMd}${uniqueMarker}`),
  }, { level: 6 })
  const skillZipBytes = Uint8Array.from(skillZip)
  return [
    {
      file: new File([`${handoff.soulMd}${uniqueMarker}`], 'soul.md', { type: 'text/markdown' }),
      uploadType: 'encrypted' as const,
      kind: 'soul-content' as const,
      sendObjectTo: walletAddress,
    },
    {
      file: new File([`${handoff.memoryMd}${uniqueMarker}`], 'memory.md', { type: 'text/markdown' }),
      uploadType: 'encrypted' as const,
      kind: 'soul-content' as const,
      sendObjectTo: walletAddress,
    },
    {
      file: new File([skillZipBytes.buffer], 'skills.zip', { type: 'application/zip' }),
      uploadType: 'encrypted' as const,
      kind: 'soul-content' as const,
      sendObjectTo: walletAddress,
      extractSkillMetadata: true,
    },
  ]
}

export function useAnimacraftMint() {
  const [status, setStatus] = useState<AnimacraftMintStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MintResult | null>(null)
  const [recoveryDigest, setRecoveryDigest] = useState<string | null>(null)
  const { user, getAuthHeaders } = useAuth()
  const { suiWallet, suiClient, signAndExecute } = useWalletSign()
  const { requestUploadCostApproval } = useUploadCostReview()
  const recoveryRef = useRef<AnimacraftMintRecovery | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      try {
        const raw = sessionStorage.getItem(ANIMACRAFT_MINT_RECOVERY_KEY)
        if (!raw) return
        const parsed = JSON.parse(raw) as AnimacraftMintRecovery
        const pendingSync = isPendingSync(parsed.pendingSync) ? parsed.pendingSync : null
        const syncBody = isSyncBody(parsed.syncBody) ? parsed.syncBody : null
        if (
          parsed.userId === user?.id
          && parsed.txDigest
          && parsed.soulOnChainId
          && (pendingSync || syncBody)
          && hasCurrentSoulidityDeploymentSignature(parsed)
        ) {
          const recovery = { ...parsed, pendingSync, syncBody }
          recoveryRef.current = recovery
          setRecoveryDigest(recovery.txDigest)
        } else if (user?.id) {
          persistRecovery(null)
        }
      } catch {
        persistRecovery(null)
      }
    })
    return () => { cancelled = true }
  }, [user?.id])

  async function resume(): Promise<void> {
    if (!user || !suiWallet) {
      setStatus('error')
      setError('Connect and sign in with the original Sui wallet before resuming sync')
      return
    }
    const existingRecovery = recoveryRef.current
    if (!existingRecovery) {
      setStatus('error')
      setError('No recoverable Animacraft mint was found for this wallet and deployment')
      return
    }
    try {
      setError(null)
      setResult(null)
      setStatus('syncing')
      const authHeaders = await getAuthHeaders()
      let syncBody = existingRecovery.syncBody
      if (!syncBody) {
        if (!existingRecovery.pendingSync) throw new Error('Animacraft mint recovery is incomplete')
        syncBody = await buildSyncBody({
          txDigest: existingRecovery.txDigest,
          soulOnChainId: existingRecovery.soulOnChainId,
          txResult: await suiClient.getTransactionBlock({
            digest: existingRecovery.txDigest,
            options: { showEvents: true, showObjectChanges: true, showEffects: true, showInput: true },
          }),
          pendingSync: existingRecovery.pendingSync,
          suiClient,
        })
        const nextRecovery = { ...existingRecovery, syncBody }
        recoveryRef.current = nextRecovery
        persistRecovery(nextRecovery)
      }
      const response = await fetch('/api/souls/publish', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(syncBody),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error ?? 'Soul is on-chain, but Soulidity sync still needs to be retried')
      }
      setResult({ txDigest: existingRecovery.txDigest, soulOnChainId: existingRecovery.soulOnChainId })
      recoveryRef.current = null
      setRecoveryDigest(null)
      persistRecovery(null)
      setStatus('done')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Animacraft Soul sync failed')
      setStatus('error')
    }
  }

  async function mint(input: AnimacraftMintInput): Promise<void> {
    if (!user || !suiWallet) {
      setStatus('error')
      setError('Connect and sign in with a Sui wallet before minting')
      return
    }
    if (!input.config.ready) {
      setStatus('error')
      setError(`Canonical Animacraft mint is not activated: ${input.config.missing.join(', ')}`)
      return
    }
    if (recoveryRef.current) {
      await resume()
      return
    }
    if (!recoveryRef.current && (!input.maker.mintingEnabled || !input.maker.published || input.maker.archived)) {
      setStatus('error')
      setError('This Animacraft Maker is not open for minting')
      return
    }

    let prepared: Awaited<ReturnType<typeof prepareSoulBlobsForBatchPublish>> | null = null
    try {
      setError(null)
      setResult(null)
      const authHeaders = await getAuthHeaders()
      setStatus('preflight')
      const recipeHashBytes = parseAnimacraftRecipeHashHex(input.recipeHashHex)
      const computedHash = await hashAnimacraftRecipe(input.handoff.recipe)
      if (!equalAnimacraftRecipeHash(recipeHashBytes, computedHash)) {
        throw new Error('Animacraft recipe hash does not match the certified OC profile')
      }

      const paymentCoinType = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE')
      if (normalizeStructTag(input.maker.paymentCoinType) !== normalizeStructTag(paymentCoinType)) {
        throw new Error('Animacraft Maker payment coin does not match Soulidity native Sui USDC')
      }
      const personalKiosk = await resolvePersonalKiosk(authHeaders, suiWallet.address)
      await assertObjectInputsExist(suiClient, {
        'Animacraft Maker': input.maker.objectId,
        'Animacraft Maker treasury': input.maker.treasuryId,
        'Animacraft protocol fee config': input.config.protocolFeeConfigId,
        'Animacraft protocol treasury': input.config.protocolTreasuryId,
        'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
        'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
      })

      let paymentCoinObjectIds: string[] = []
      if (input.maker.mintFeeEnabled) {
        const selected = await selectCoinObjectIdsForAmountAcrossPages(suiClient, {
          owner: suiWallet.address,
          coinType: paymentCoinType,
          requiredAmount: input.maker.mintPriceAtomic,
        })
        if (!selected?.length) throw new Error('Insufficient USDC balance for this Maker mint')
        paymentCoinObjectIds = selected
      }

      setStatus('uploading')
      prepared = await prepareSoulBlobsForBatchPublish({
        files: livingContentFiles(input.handoff, suiWallet.address, input.profileJsonBlobId),
        walletAddress: suiWallet.address,
        suiClient,
        signAndExecute,
        authHeaders,
        confirmQuote: requestUploadCostApproval,
      })
      const [soulFile, memoryFile, skillsFile] = prepared.files
      if (!soulFile?.blobObjectId || !memoryFile?.blobObjectId || !skillsFile?.blobObjectId) {
        throw new Error('Walrus did not return all required owned Blob objects')
      }
      if (!soulFile.sealMaterial || !memoryFile.sealMaterial || !skillsFile.sealMaterial) {
        throw new Error('Walrus upload is missing Seal recovery material')
      }
      const { initialContent, initialStateConfig } = buildPhase2InitialContent({
        protectedBlobObjectId: soulFile.blobObjectId,
        foundingMemoryBlobObjectId: memoryFile.blobObjectId,
        skillsBlobObjectId: skillsFile.blobObjectId,
        initialSkillName: input.handoff.skillName,
        initialSkillVisibility: 'private',
      })

      const tx = await buildMintAnimacraftSoulTx({
        currentKioskId: personalKiosk?.currentKioskId ?? null,
        currentKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
        description: input.handoff.description,
        initialContent,
        initialStateConfig,
        attachBeforeMint: prepared.attachCertifyCalls,
        createAuthorization: (authorizationTx) => appendAnimacraftSoulMintAuthorization(
          authorizationTx,
          {
            animacraftPackageId: input.config.packageId,
            makerObjectId: input.maker.objectId,
            makerTreasuryObjectId: input.maker.treasuryId,
            protocolFeeConfigId: input.config.protocolFeeConfigId,
            protocolTreasuryId: input.config.protocolTreasuryId,
            paymentCoinType,
            paymentCoinObjectIds,
            mintFeeEnabled: input.maker.mintFeeEnabled,
            mintPriceAtomic: input.maker.mintPriceAtomic,
            name: input.handoff.name,
            profileJsonBlobId: input.profileJsonBlobId,
            imageBlobId: input.imageBlobId,
            imageUrl: input.imageUrl,
            recipeHashBytes,
            recipe: input.handoff.recipe,
          },
        ),
      })

      setStatus('signing')
      const txResult = await signAndExecute(tx)
      assertSoulidityTxSucceeded(txResult, 'Animacraft canonical Soul mint')

      const soulidityPackageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
      const minted = extractAllSoulMintedToKioskEvents(txResult as never, soulidityPackageId)[0]
      if (!minted) throw new Error('Canonical mint transaction is missing SoulMintedToKiosk')
      const pendingSync: AnimacraftPendingSync = {
        tags: input.handoff.tags,
        previewImages: [input.imageUrl],
        readme: `Created with Animacraft Maker ${input.maker.objectId}.`,
        currentKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
        soulMaterial: soulFile.sealMaterial,
        memoryMaterial: memoryFile.sealMaterial,
        skillsMaterial: skillsFile.sealMaterial,
        skillName: input.handoff.skillName,
      }
      const recovery: AnimacraftMintRecovery = attachSoulidityDeploymentSignature({
        userId: user.id,
        txDigest: txResult.digest,
        soulOnChainId: minted.soulId,
        pendingSync,
        syncBody: null,
      })
      recoveryRef.current = recovery
      setRecoveryDigest(recovery.txDigest)
      persistRecovery(recovery)
      const syncBody = await buildSyncBody({
        txDigest: txResult.digest,
        soulOnChainId: minted.soulId,
        txResult,
        pendingSync,
        suiClient,
      })
      const recoveryWithBody = { ...recovery, syncBody }
      recoveryRef.current = recoveryWithBody
      persistRecovery(recoveryWithBody)

      setStatus('syncing')
      const syncResponse = await fetch('/api/souls/publish', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(syncBody),
      })
      if (!syncResponse.ok) {
        const body = await syncResponse.json().catch(() => ({}))
        throw new Error(body.error ?? 'Soul minted, but Soulidity projection sync failed')
      }

      prepared.clearBatchRecovery()
      recoveryRef.current = null
      setRecoveryDigest(null)
      persistRecovery(null)
      setResult({ txDigest: txResult.digest, soulOnChainId: minted.soulId })
      setStatus('done')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Animacraft Soul mint failed')
      setStatus('error')
    }
  }

  return { status, error, result, hasRecovery: Boolean(recoveryDigest), mint, resume }
}
