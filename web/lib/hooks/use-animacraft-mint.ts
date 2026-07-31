'use client'

import { useEffect, useRef, useState } from 'react'
import { strToU8, zipSync } from 'fflate'
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils'
import {
  appendAnimacraftCommerceV5Authorization,
  appendAnimacraftSoulMintAuthorization,
  ANIMACRAFT_V5_PROTOCOL_FEE_BPS,
  MAX_ANIMACRAFT_V5_ADD_ON_BPS,
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
  hashAnimacraftCompleteSelectionV5,
  normalizeTags,
  parseAnimacraftRecipeHashHex,
  selectCoinObjectIdsForAmountAcrossPages,
  simulateAnimacraftCompleteQuoteV5,
  tryExtractAnimacraftOutputProvenanceV5CreatedEvent,
  type AnimacraftCompleteQuoteV5,
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
  AnimacraftCommerceV5State,
  ParsedAnimacraftHandoff,
} from '@/lib/animacraft/handoff'
import {
  animacraftMintRecoveryContextsMatch,
  normalizeAnimacraftMintRecoveryContext,
  normalizeAnimacraftRecoveryHash,
  normalizeAnimacraftRecoveryObjectId,
  type AnimacraftMintRecoveryContext,
} from '@/lib/animacraft/mint-recovery-context'

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
  commerceV5: AnimacraftCommerceV5State | null
  recoveryContext: AnimacraftMintRecoveryContext
  profileJsonBlobId: string
  imageBlobId: string
  imageUrl: string
  recipeHashHex: string
  outputSealIdHex: string
  outputNonceHex: string
  outputDigestHex: string
}

interface MintResult {
  txDigest: string
  soulOnChainId: string
  provenanceObjectId: string
  outputProvenanceObjectId: string | null
  recoveryContext: AnimacraftMintRecoveryContext
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
  provenanceObjectId: string
  animacraftProtocolVersion?: 4 | 5
  outputProvenanceObjectId?: string | null
  recoveryContext: AnimacraftMintRecoveryContext
  pendingSync: AnimacraftPendingSync | null
  syncBody: AnimacraftSyncBody | null
  deploymentSignature: string
}

function animacraftProvenanceObjectId(
  txResult: unknown,
  expectedSoulId: string,
): string {
  const events = Array.isArray((txResult as { events?: unknown[] } | null)?.events)
    ? (txResult as { events: Array<{ type?: unknown; parsedJson?: unknown }> }).events
    : []
  const event = events.find((candidate) => {
    if (!String(candidate?.type || '').endsWith(
      '::animacraft_provenance::AnimacraftProvenanceCreated',
    )) return false
    const fields = candidate?.parsedJson as
      | { soul_id?: unknown; soulId?: unknown }
      | null
    return String(fields?.soul_id ?? fields?.soulId ?? '') === expectedSoulId
  })
  const fields = event?.parsedJson as
    | { provenance_id?: unknown; provenanceId?: unknown }
    | null
  const objectId = String(
    fields?.provenance_id ?? fields?.provenanceId ?? '',
  ).trim()
  if (!/^0x[0-9a-f]+$/i.test(objectId)) {
    throw new Error(
      'Canonical mint transaction is missing the expected Animacraft provenance event',
    )
  }
  return objectId
}

function animacraftOutputProvenanceObjectId(
  txResult: unknown,
  packageId: string,
  expected: {
    soulId: string
    stateId: string
    baseProvenanceId: string
    makerRootId: string
    completeOutputSealId: Uint8Array
  },
): string | null {
  const event = tryExtractAnimacraftOutputProvenanceV5CreatedEvent(
    txResult as never,
    packageId,
  )
  if (!event) return null

  const sameId = (left: string, right: string) =>
    normalizeSuiAddress(left) === normalizeSuiAddress(right)
  if (
    !sameId(event.soulId, expected.soulId)
    || !sameId(event.stateId, expected.stateId)
    || !sameId(event.baseProvenanceId, expected.baseProvenanceId)
    || !sameId(event.makerRootId, expected.makerRootId)
    || !equalAnimacraftRecipeHash(
      event.completeOutputSealId,
      expected.completeOutputSealId,
    )
  ) {
    throw new Error(
      'Canonical commerce v5 mint emitted mismatched completed-output provenance',
    )
  }
  return event.outputProvenanceId
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
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID')
  const minted = extractAllSoulMintedToKioskEvents(params.txResult as never, packageId)
    .find((event) => event.soulId === params.soulOnChainId)
  if (!minted) throw new Error('Canonical mint transaction is missing the expected Soul event')
  const versions = extractAllContentVersionAppendedEvents(params.txResult as never, packageId)
    .filter((version) => version.soulId === minted.soulId)
  if (versions.length === 0) throw new Error('Canonical mint transaction is missing Living Content events')
  const contentSidecars = await buildContentSidecarsForVersionsWithSuiClient({
    suiClient: params.suiClient as never,
    packageId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID'),
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

export function useAnimacraftMint(
  currentRecoveryContext: AnimacraftMintRecoveryContext | null,
) {
  const [status, setStatus] = useState<AnimacraftMintStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MintResult | null>(null)
  const [completeQuoteV5, setCompleteQuoteV5] =
    useState<AnimacraftCompleteQuoteV5 | null>(null)
  const [recoveryDigest, setRecoveryDigest] = useState<string | null>(null)
  const { user, getAuthHeaders } = useAuth()
  const { suiWallet, suiClient, signAndExecute } = useWalletSign()
  const { requestUploadCostApproval } = useUploadCostReview()
  const recoveryRef = useRef<AnimacraftMintRecovery | null>(null)
  const normalizedCurrentRecoveryContext =
    normalizeAnimacraftMintRecoveryContext(currentRecoveryContext)
  const currentRecoveryContextKey = normalizedCurrentRecoveryContext
    ? JSON.stringify(normalizedCurrentRecoveryContext)
    : ''

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      recoveryRef.current = null
      setRecoveryDigest(null)
      try {
        const raw = sessionStorage.getItem(ANIMACRAFT_MINT_RECOVERY_KEY)
        if (!raw) return
        const parsed = JSON.parse(raw) as AnimacraftMintRecovery
        const pendingSync = isPendingSync(parsed.pendingSync) ? parsed.pendingSync : null
        const syncBody = isSyncBody(parsed.syncBody) ? parsed.syncBody : null
        const recoveryContext =
          normalizeAnimacraftMintRecoveryContext(parsed.recoveryContext)
        if (
          typeof parsed.userId === 'string'
          && parsed.txDigest
          && parsed.soulOnChainId
          && parsed.provenanceObjectId
          && recoveryContext
          && (pendingSync || syncBody)
          && hasCurrentSoulidityDeploymentSignature(parsed)
        ) {
          const recovery = {
            ...parsed,
            recoveryContext,
            pendingSync,
            syncBody,
          }
          recoveryRef.current = recovery
          if (
            parsed.userId === user?.id
            && animacraftMintRecoveryContextsMatch(
              recoveryContext,
              normalizedCurrentRecoveryContext,
            )
          ) {
            setRecoveryDigest(recovery.txDigest)
          }
        } else {
          persistRecovery(null)
        }
      } catch {
        persistRecovery(null)
      }
    })
    return () => { cancelled = true }
  }, [currentRecoveryContextKey, user?.id])

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
    if (
      existingRecovery.userId !== user.id
      || !animacraftMintRecoveryContextsMatch(
        existingRecovery.recoveryContext,
        normalizedCurrentRecoveryContext,
      )
    ) {
      setStatus('error')
      setError(
        'The recoverable Animacraft mint belongs to a different Maker or completion handoff',
      )
      return
    }
    try {
      setError(null)
      setResult(null)
      setStatus('syncing')
      const recoveryProtocolVersion =
        existingRecovery.animacraftProtocolVersion ?? 4
      if (
        recoveryProtocolVersion === 5
        && !existingRecovery.outputProvenanceObjectId
      ) {
        throw new Error(
          'Recoverable commerce v5 mint is missing its completed-output provenance',
        )
      }
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
      setResult({
        txDigest: existingRecovery.txDigest,
        soulOnChainId: existingRecovery.soulOnChainId,
        provenanceObjectId: existingRecovery.provenanceObjectId,
        outputProvenanceObjectId:
          existingRecovery.outputProvenanceObjectId ?? null,
        recoveryContext: existingRecovery.recoveryContext,
      })
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
    const integrationReady = input.handoff.protocolVersion === 5
      ? input.config.commerceV5Ready
      : input.config.ready
    const integrationMissing = input.handoff.protocolVersion === 5
      ? input.config.commerceV5Missing
      : input.config.missing
    if (!integrationReady) {
      setStatus('error')
      setError(`Canonical Animacraft mint is not activated: ${integrationMissing.join(', ')}`)
      return
    }
    const inputRecoveryContext =
      normalizeAnimacraftMintRecoveryContext(input.recoveryContext)
    if (
      !inputRecoveryContext
      || inputRecoveryContext.protocolVersion !== input.handoff.protocolVersion
      || normalizeAnimacraftRecoveryObjectId(input.maker.objectId)
        !== inputRecoveryContext.makerId
      || normalizeAnimacraftRecoveryObjectId(input.handoff.makerId)
        !== inputRecoveryContext.makerId
      || normalizeAnimacraftRecoveryHash(input.recipeHashHex)
        !== inputRecoveryContext.recipeHashHex
      || (
        input.handoff.protocolVersion === 5
        && (
          normalizeAnimacraftRecoveryObjectId(
            input.commerceV5?.root.objectId ?? '',
          )
            !== inputRecoveryContext.makerRootId
          || normalizeAnimacraftRecoveryHash(input.outputSealIdHex)
            !== inputRecoveryContext.outputSealIdHex
          || normalizeAnimacraftRecoveryHash(input.outputNonceHex)
            !== inputRecoveryContext.outputNonceHex
          || normalizeAnimacraftRecoveryHash(input.outputDigestHex)
            !== inputRecoveryContext.outputDigestHex
        )
      )
    ) {
      setStatus('error')
      setError(
        'The Animacraft completion handoff does not match its recovery context',
      )
      return
    }
    if (recoveryRef.current) {
      if (
        recoveryRef.current.userId === user.id
        && animacraftMintRecoveryContextsMatch(
          recoveryRef.current.recoveryContext,
          inputRecoveryContext,
        )
      ) {
        await resume()
      } else {
        setStatus('error')
        setError(
          'Another Animacraft completion is awaiting recovery; reopen its original Maker before starting a new mint',
        )
      }
      return
    }
    if (!recoveryRef.current) {
      const makerReadyForProtocol = input.handoff.protocolVersion === 5
        ? (
            input.maker.published
            && input.maker.archived
            && !input.maker.mintingEnabled
            && !input.maker.mintFeeEnabled
            && input.maker.mintPriceAtomic === 0n
          )
        : (
            input.maker.published
            && !input.maker.archived
            && input.maker.mintingEnabled
          )
      if (!makerReadyForProtocol) {
        setStatus('error')
        setError(
          input.handoff.protocolVersion === 5
            ? 'The legacy OCMaker has not been safely migrated to commerce v5'
            : 'This Animacraft Maker is not open for minting',
        )
        return
      }
    }

    let prepared: Awaited<ReturnType<typeof prepareSoulBlobsForBatchPublish>> | null = null
    try {
      setError(null)
      setResult(null)
      setCompleteQuoteV5(null)
      const authHeaders = await getAuthHeaders()
      setStatus('preflight')
      const recipeHashBytes = parseAnimacraftRecipeHashHex(input.recipeHashHex)
      const outputSealIdBytes = input.handoff.protocolVersion === 5
        ? parseAnimacraftRecipeHashHex(input.outputSealIdHex)
        : new Uint8Array()
      const outputNonceBytes = input.handoff.protocolVersion === 5
        ? parseAnimacraftRecipeHashHex(input.outputNonceHex)
        : new Uint8Array()
      const outputDigestBytes = input.handoff.protocolVersion === 5
        ? parseAnimacraftRecipeHashHex(input.outputDigestHex)
        : new Uint8Array()
      const computedHash = input.handoff.protocolVersion === 5
        ? await hashAnimacraftCompleteSelectionV5(
            input.handoff.recipe,
            input.handoff.styleSelections,
          )
        : await hashAnimacraftRecipe(input.handoff.recipe)
      if (!equalAnimacraftRecipeHash(recipeHashBytes, computedHash)) {
        throw new Error('Animacraft recipe hash does not match the certified OC profile')
      }
      if (input.handoff.protocolVersion === 5 && !input.commerceV5) {
        throw new Error('Animacraft commerce v5 state has not been verified')
      }
      if (
        input.handoff.protocolVersion === 5
        && (
          ANIMACRAFT_V5_PROTOCOL_FEE_BPS
            + input.maker.royaltyBps
            + input.commerceV5!.root.soulCreatorRoyaltyBps
          > MAX_ANIMACRAFT_V5_ADD_ON_BPS
        )
      ) {
        throw new Error(
          'Animacraft v5 resale shares exceed the 10% rights pool plus 2.5% protocol ceiling',
        )
      }

      const paymentCoinType = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE')
      if (normalizeStructTag(input.maker.paymentCoinType) !== normalizeStructTag(paymentCoinType)) {
        throw new Error('Animacraft Maker payment coin does not match Soulidity native Sui USDC')
      }
      const personalKiosk = await resolvePersonalKiosk(authHeaders, suiWallet.address)
      await assertObjectInputsExist(suiClient, {
        'Animacraft Maker': input.maker.objectId,
        'Animacraft Maker treasury': input.handoff.protocolVersion === 5
          ? input.commerceV5!.makerTreasury.objectId
          : input.maker.treasuryId,
        'Animacraft protocol fee config': input.handoff.protocolVersion === 5
          ? input.commerceV5!.protocol.objectId
          : input.config.protocolFeeConfigId,
        'Animacraft protocol treasury': input.handoff.protocolVersion === 5
          ? input.commerceV5!.protocolTreasury.objectId
          : input.config.protocolTreasuryId,
        'Animacraft MakerRootV5': input.commerceV5?.root.objectId ?? null,
        'Your personal kiosk': personalKiosk?.currentKioskId ?? null,
        'Your personal kiosk capability': personalKiosk?.currentKioskCapOnChainId ?? null,
      })

      let paymentCoinObjectIds: string[] = []
      if (input.handoff.protocolVersion === 4 && input.maker.mintFeeEnabled) {
        const selected = await selectCoinObjectIdsForAmountAcrossPages(suiClient, {
          owner: suiWallet.address,
          coinType: paymentCoinType,
          requiredAmount: input.maker.mintPriceAtomic,
        })
        if (!selected?.length) throw new Error('Insufficient USDC balance for this Maker mint')
        paymentCoinObjectIds = selected
      }

      // Fail before any Walrus upload/certification cost if the current
      // wallet cannot use this exact Base/Pack/Style composition or cannot
      // cover its authoritative on-chain Complete quote.
      let commerceQuoteParams:
        Parameters<typeof simulateAnimacraftCompleteQuoteV5>[1] | null = null
      if (input.handoff.protocolVersion === 5) {
        const commerce = input.commerceV5!
        commerceQuoteParams = {
          runtime: {
            callablePackageId: input.config.commerceV5PackageId,
            typeOriginPackageId: input.config.commerceV5TypeOriginPackageId,
            originalPackageId: input.config.originalPackageId,
            paymentCoinType,
          },
          rootObjectId: commerce.root.objectId,
          rootOwnershipEpoch: commerce.root.ownershipEpoch,
          legacyMakerObjectId: input.maker.objectId,
          makerTreasuryObjectId: commerce.makerTreasury.objectId,
          protocolConfigObjectId: commerce.protocol.objectId,
          protocolTreasuryObjectId: commerce.protocolTreasury.objectId,
          protocolFixedCompleteFeeAtomic:
            commerce.protocol.fixedCompleteFeeAtomic,
          wallet: suiWallet.address,
          recipe: input.handoff.recipe,
          styleSelections: input.handoff.styleSelections,
        }
        const preUploadQuoteV5 = await simulateAnimacraftCompleteQuoteV5(
          suiClient,
          commerceQuoteParams,
        )
        if (!equalAnimacraftRecipeHash(recipeHashBytes, preUploadQuoteV5.recipeHashBytes)) {
          throw new Error('Commerce v5 quote does not match the certified OC package')
        }
        setCompleteQuoteV5(preUploadQuoteV5)
        if (preUploadQuoteV5.totalDueAtomic > 0n) {
          const selected = await selectCoinObjectIdsForAmountAcrossPages(suiClient, {
            owner: suiWallet.address,
            coinType: paymentCoinType,
            requiredAmount: preUploadQuoteV5.totalDueAtomic,
          })
          if (!selected?.length) {
            throw new Error('Insufficient USDC balance for this Animacraft Complete')
          }
        }
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

      let freshQuoteV5: AnimacraftCompleteQuoteV5 | null = null
      if (input.handoff.protocolVersion === 5) {
        if (!commerceQuoteParams) {
          throw new Error('Animacraft commerce v5 quote context is missing')
        }
        freshQuoteV5 = await simulateAnimacraftCompleteQuoteV5(
          suiClient,
          commerceQuoteParams,
        )
        if (!equalAnimacraftRecipeHash(recipeHashBytes, freshQuoteV5.recipeHashBytes)) {
          throw new Error('Fresh commerce v5 quote does not match the certified OC package')
        }
        setCompleteQuoteV5(freshQuoteV5)
        if (freshQuoteV5.totalDueAtomic > 0n) {
          const selected = await selectCoinObjectIdsForAmountAcrossPages(suiClient, {
            owner: suiWallet.address,
            coinType: paymentCoinType,
            requiredAmount: freshQuoteV5.totalDueAtomic,
          })
          if (!selected?.length) {
            throw new Error('Insufficient USDC balance for this Animacraft Complete')
          }
          paymentCoinObjectIds = selected
        }
      }

      const tx = await buildMintAnimacraftSoulTx({
        currentKioskId: personalKiosk?.currentKioskId ?? null,
        currentKioskCapOnChainId: personalKiosk?.currentKioskCapOnChainId ?? null,
        animacraftProtocolVersion: input.handoff.protocolVersion,
        makerRootV5ObjectId: input.handoff.protocolVersion === 5
          ? input.commerceV5!.root.objectId
          : null,
        commerceV5ProtocolConfigObjectId:
          input.handoff.protocolVersion === 5
            ? input.commerceV5!.protocol.objectId
            : null,
        description: input.handoff.description,
        initialContent,
        initialStateConfig,
        attachBeforeMint: prepared.attachCertifyCalls,
        createAuthorization: (authorizationTx) => {
          if (input.handoff.protocolVersion === 5) {
            const commerce = input.commerceV5!
            if (!freshQuoteV5) throw new Error('Fresh Animacraft v5 quote is missing')
            return appendAnimacraftCommerceV5Authorization(
              authorizationTx,
              {
                runtime: {
                  callablePackageId: input.config.commerceV5PackageId,
                  typeOriginPackageId: input.config.commerceV5TypeOriginPackageId,
                  originalPackageId: input.config.originalPackageId,
                  paymentCoinType,
                },
                rootObjectId: commerce.root.objectId,
                rootOwnershipEpoch: commerce.root.ownershipEpoch,
                legacyMakerObjectId: input.maker.objectId,
                makerTreasuryObjectId: commerce.makerTreasury.objectId,
                protocolConfigObjectId: commerce.protocol.objectId,
                protocolTreasuryObjectId: commerce.protocolTreasury.objectId,
                protocolFixedCompleteFeeAtomic:
                  commerce.protocol.fixedCompleteFeeAtomic,
                wallet: suiWallet.address,
                quote: freshQuoteV5,
                paymentCoinObjectIds,
                name: input.handoff.name,
                profileJsonBlobId: input.profileJsonBlobId,
                imageBlobId: input.imageBlobId,
                imageUrl: input.imageUrl,
                outputSealId: outputSealIdBytes,
                outputNonce: outputNonceBytes,
                outputDigest: outputDigestBytes,
                recipe: input.handoff.recipe,
                styleSelections: input.handoff.styleSelections,
              },
            )
          }
          return appendAnimacraftSoulMintAuthorization(authorizationTx, {
            animacraftPackageId: input.config.packageId,
            animacraftOriginalPackageId: input.config.originalPackageId,
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
          })
        },
      })

      setStatus('signing')
      // Allow the exact on-chain v5 quote to render before opening the wallet
      // signature prompt. The final PTB re-quotes atomically and aborts if any
      // quota, Pack entitlement, fee, or ownership state changed meanwhile.
      if (freshQuoteV5 && typeof window !== 'undefined') {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      }
      const txResult = await signAndExecute(tx)
      assertSoulidityTxSucceeded(txResult, 'Animacraft canonical Soul mint')

      const soulidityPackageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID')
      const minted = extractAllSoulMintedToKioskEvents(txResult as never, soulidityPackageId)[0]
      if (!minted) throw new Error('Canonical mint transaction is missing SoulMintedToKiosk')
      const provenanceObjectId = animacraftProvenanceObjectId(
        txResult,
        minted.soulId,
      )
      const outputProvenanceObjectId =
        animacraftOutputProvenanceObjectId(
          txResult,
          soulidityPackageId,
          {
            soulId: minted.soulId,
            stateId: minted.stateId,
            baseProvenanceId: provenanceObjectId,
            makerRootId: input.commerceV5?.root.objectId ?? '',
            completeOutputSealId: outputSealIdBytes,
          },
        )
      if (
        input.handoff.protocolVersion === 5
        && !outputProvenanceObjectId
      ) {
        throw new Error(
          'Canonical commerce v5 mint is missing its completed-output provenance event',
        )
      }
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
        provenanceObjectId,
        animacraftProtocolVersion: input.handoff.protocolVersion,
        outputProvenanceObjectId,
        recoveryContext: inputRecoveryContext,
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
      setResult({
        txDigest: txResult.digest,
        soulOnChainId: minted.soulId,
        provenanceObjectId,
        outputProvenanceObjectId,
        recoveryContext: inputRecoveryContext,
      })
      setStatus('done')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Animacraft Soul mint failed')
      setStatus('error')
    }
  }

  return {
    status,
    error,
    result,
    completeQuoteV5,
    hasRecovery: Boolean(
      recoveryDigest
      && recoveryRef.current?.userId === user?.id
      && animacraftMintRecoveryContextsMatch(
        recoveryRef.current?.recoveryContext,
        normalizedCurrentRecoveryContext,
      ),
    ),
    mint,
    resume,
  }
}
