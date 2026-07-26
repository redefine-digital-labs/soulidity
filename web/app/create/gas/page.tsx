'use client'

import { useEffect, useRef, useState } from 'react'
import { useAutoConnectWallet, useCurrentWallet, useSuiClient } from '@mysten/dapp-kit'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { buttonStyles } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { usePublish, type PublishParams } from '@/lib/hooks/use-publish'
import { useAuth } from '@/components/providers/auth-provider'
import {
  prepareSoulBlobsForBatchPublish,
  reclaimWalrusOrphanBlobs,
  uploadSoulPayload,
  WalrusUploadCancelledError,
  type BatchSoulUploadFile,
  type PreparedSoulBlobs,
} from '@/lib/upload/client-upload'
import {
  WalrusUploadResumeMismatchError,
  type WalrusOrphanBlob,
} from '@/lib/upload/walrus-recovery'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { useLogin } from '@/lib/hooks/use-login'
import { getWalletActionState } from '@/lib/wallet/wallet-action-state'
import { useUploadCostReview } from '@/components/upload/upload-cost-review'
import { captureFrontendException } from '@/lib/observability/posthog-client-errors'
import { getSuiTxErrorProperties } from '@soulidity/sdk'
import { assertListingPriceAtomic } from '@soulidity/sdk'
import { buildListSoulTx } from '@soulidity/sdk'
import { buildIssueGrantTx, buildRevokeGrantTx } from '@soulidity/sdk'
import { hasCurrentSoulidityDeploymentSignature } from '@soulidity/sdk'
import { validateSoulPublishArgs } from '@soulidity/sdk'
import { assertObjectInputsExist } from '@soulidity/sdk'
import { preflightCollectionBindTarget } from '@soulidity/sdk'
import { getRequiredSoulidityEnv } from '@soulidity/sdk'
import {
  useCreateSoul,
  type UploadResults,
} from '@/components/providers/create-soul-provider'
import { TxRow } from '@/components/shared/tx-row'
import {
  MIN_SUI_BALANCE,
  formatBalance,
  useWalletBalances,
} from '@/lib/hooks/use-wallet-balances'

const steps = [
  { label: 'Basic Info' },
  { label: 'Living Content' },
  { label: 'Preview & Confirm' },
  { label: 'Pay Gas' },
  { label: 'On-chain' },
]

const royaltyLabels: Record<number, string> = {
  0: 'Off · 0% (locked on-chain)',
  250: 'Low · 2.5% (locked on-chain)',
  500: 'Standard · 5% (locked on-chain)',
  1000: 'High · 10% (locked on-chain)',
}

type UploadPhase =
  | 'idle'
  | 'preflight'
  | 'preparing-uploads'
  | 'awaiting-register-signature'
  | 'uploading-to-relay'
  | 'done'

const uploadPhaseLabels: Record<UploadPhase, string> = {
  'idle': '',
  'preflight': 'Verifying kiosk and publish requirements…',
  'preparing-uploads': 'Encrypting & encoding files…',
  'awaiting-register-signature': 'Awaiting wallet signature for batched register…',
  'uploading-to-relay': 'Uploading encoded payloads to Walrus…',
  'done': 'Uploads complete',
}


const MIME_MAP: Record<string, string> = {
  '.md': 'text/markdown', '.txt': 'text/plain',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
  '.json': 'application/json', '.zip': 'application/zip',
}

function withMime(file: File): File {
  const ext = file.name.includes('.') ? '.' + file.name.split('.').pop()!.toLowerCase() : ''
  const expected = MIME_MAP[ext]
  if (!expected || file.type === expected) return file
  return new File([file], file.name, { type: expected })
}

// Stable fingerprint over the batch inputs. Used to keep the prepared batch
// across mint-signature retries (so the same paid PTB1 + uploaded certificates
// are reused) without holding stale state when the user actually changes a
// file. Encryption regenerates AES-GCM keys on every preparePayload(), so any
// re-call of `prepareSoulBlobsForBatchPublish` for an unchanged draft would
// produce different blobIds than the persisted recovery and force the
// orphan-mismatch branch.
function buildBatchFingerprint(walletAddress: string, files: BatchSoulUploadFile[]): string {
  return JSON.stringify({
    walletAddress: walletAddress.toLowerCase(),
    files: files.map((f) => ({
      name: f.file.name,
      size: f.file.size,
      lastModified: f.file.lastModified,
      type: f.file.type,
      uploadType: f.uploadType,
      kind: f.kind,
      sendObjectTo: f.sendObjectTo?.trim().toLowerCase() ?? null,
    })),
  })
}

function checkMintRecovery(userId: string | undefined): boolean {
  if (typeof window === 'undefined' || !userId) return false
  try {
    const raw = sessionStorage.getItem('soul-mint-recovery')
    if (raw) {
      const recovery = JSON.parse(raw)
      return !!recovery.txDigest && recovery.userId === userId && hasCurrentSoulidityDeploymentSignature(recovery)
    }
  } catch {}
  return false
}

export default function CreateGasPage() {
  const router = useRouter()
  const suiClient = useSuiClient()
  const ctx = useCreateSoul()
  const { setPublishResult } = ctx
  const { status, error, txDigest, publishData, publish, suiWallet } = usePublish()
  const { getAuthHeaders, user } = useAuth()
  const { showToast } = useToast()
  const openWalletLogin = useLogin()
  const { signAndExecute } = useWalletSign()
  const walletConnection = useCurrentWallet()
  const autoConnectStatus = useAutoConnectWallet()
  const { requestUploadCostApproval } = useUploadCostReview()
  const publishRef = useRef(publish)
  const getAuthHeadersRef = useRef(getAuthHeaders)
  const signAndExecuteRef = useRef(signAndExecute)
  const suiClientRef = useRef(suiClient)
  const walletRef = useRef(suiWallet)
  const requestUploadCostApprovalRef = useRef(requestUploadCostApproval)
  useEffect(() => {
    publishRef.current = publish
    getAuthHeadersRef.current = getAuthHeaders
    signAndExecuteRef.current = signAndExecute
    suiClientRef.current = suiClient
    walletRef.current = suiWallet
    requestUploadCostApprovalRef.current = requestUploadCostApproval
  })

  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle')
  const [deployError, setDeployError] = useState<string | null>(null)
  const [walrusOrphanRecovery, setWalrusOrphanRecovery] = useState<{
    orphanTxDigest: string
    orphanBlobs: WalrusOrphanBlob[]
  } | null>(null)
  const [reclaimingOrphans, setReclaimingOrphans] = useState(false)
  const [copied, setCopied] = useState(false)
  const completedDigestRef = useRef<string | null>(null)
  // Cache for the prepared batch (PTB1 digest + uploaded certificates +
  // attachCertifyCalls closure) so a mint-signature rejection or transient
  // mint-PTB failure can retry the SAME mint signature without re-running
  // `prepareSoulBlobsForBatchPublish` — that re-encrypts every payload with
  // fresh AES-GCM keys, produces different blobIds than the persisted PTB1
  // recovery, and forces the orphan-mismatch branch. Keyed by wallet +
  // file fingerprint; cleared on successful mint and when files change.
  const preparedBatchRef = useRef<{
    walletAddress: string
    fingerprint: string
    prepared: PreparedSoulBlobs
  } | null>(null)

  // ── Balance checking ──
  const balances = useWalletBalances(suiWallet?.address ?? null)
  const suiInsufficient = balances.sui !== null && balances.sui < MIN_SUI_BALANCE
  const balanceBlocked = suiInsufficient

  // Guard: redirect to earliest incomplete step when required data is missing
  const missingStep1 = !ctx.name || !ctx.description || !ctx.coverImageFile
  const missingStep2 = !ctx.charFile || !ctx.memoryFile

  // Detect pending mint recovery: on-chain TX succeeded but sync was interrupted.
  // useState initializer reads sessionStorage synchronously to avoid race with redirect effect.
  const [hasMintRecovery] = useState(() => checkMintRecovery(user?.id))
  const inRecovery = hasMintRecovery && status !== 'done'

  useEffect(() => {
    if (status === 'done' || checkMintRecovery(user?.id)) return
    if (missingStep1) {
      router.replace('/create')
    } else if (missingStep2) {
      router.replace('/create/content')
    }
  }, [missingStep1, missingStep2, status, router, user?.id])

  // Store publish result in context when done
  useEffect(() => {
    if (status === 'done' && publishData) {
      if (completedDigestRef.current === publishData.txDigest) return
      completedDigestRef.current = publishData.txDigest
      setPublishResult(publishData)
      showToast('Soul minted successfully!', 'success')

      // Notify the desktop app if this mint originated from a Mint By Web
      // hand-off. The /create page hydration step stashes the hand-off token
      // in sessionStorage; here we fire `soulidity://mint-completed?token=...`
      // so the desktop's protocol handler clears its local draft and resets
      // ExtractTab. Browsers raise an OS-level "Open Soulidity?" prompt for
      // soulidity:// URLs instead of navigating, so this is safe to fire
      // before the router.replace below.
      try {
        const handoffToken = sessionStorage.getItem('soulidity-desktop-handoff-token')
        if (handoffToken) {
          sessionStorage.removeItem('soulidity-desktop-handoff-token')
          window.location.href = `soulidity://mint-completed?token=${encodeURIComponent(handoffToken)}`
        }
      } catch { /* sessionStorage / scheme handler may be unavailable */ }

      router.replace('/create/success')
    }
  }, [status, publishData, setPublishResult, router, showToast])

  // Toast on mint error
  useEffect(() => {
    if (status === 'error' && error) {
      showToast(`Mint failed: ${error}`, 'danger')
    }
  }, [status, error, showToast])

  // Expose publish + authenticated upload + list for E2E testing.
  // Gated to development so the helpers (notably __e2eUpload, which auto-approves
  // wallet-paid Walrus quotes) cannot be invoked from production pages.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const w = window as any
    w.__e2ePublish = (params: PublishParams) => publishRef.current(params)
    w.__e2eUpload = async (fileContent: string, fileName: string, type: 'public' | 'encrypted' = 'encrypted') => {
      const headers = await getAuthHeadersRef.current()
      const blob = new Blob([fileContent], { type: 'text/markdown' })
      const file = new File([blob], fileName, { type: 'text/markdown' })
      const wallet = walletRef.current
      if (!wallet) {
        throw new Error('Connect a Sui wallet before uploading')
      }
      return uploadSoulPayload({
        file: withMime(file),
        uploadType: type,
        kind: 'soul-content',
        authHeaders: headers,
        sendObjectTo: type === 'encrypted' ? wallet.address : null,
        walletAddress: wallet.address,
        suiClient: suiClientRef.current,
        signAndExecute: signAndExecuteRef.current,
        confirmQuote: async () => true,
      })
    }
    w.__e2eListSoul = async (params: {
      currentKioskId: string; currentKioskCapOnChainId: string;
      stateObjectId: string; soulObjectId: string; priceAtomic: string;
    }) => {
      // soulObjectId is no longer needed by the new ABI (Move derives it
      // from the state argument), but keep it in the test helper signature
      // so existing E2E callers don't have to be edited.
      const tx = buildListSoulTx({
        currentKioskId: params.currentKioskId,
        currentKioskCapOnChainId: params.currentKioskCapOnChainId,
        stateObjectId: params.stateObjectId,
        priceAtomic: BigInt(params.priceAtomic),
      })
      const result = await signAndExecuteRef.current(tx)
      const headers = await getAuthHeadersRef.current()
      const syncRes = await fetch(`/api/souls/${params.soulObjectId}/list`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest }),
      })
      if (!syncRes.ok) {
        const err = await syncRes.json().catch(() => ({}))
        throw new Error(err.error || `List sync failed: ${syncRes.status}`)
      }
      return { digest: result.digest, ...(await syncRes.json()) }
    }
    w.__e2eGetAuthHeaders = () => getAuthHeadersRef.current()
    w.__e2eIssueGrant = async (params: { stateObjectId: string; granteeAddress: string; scopeMask: number; soulObjectId: string }) => {
      const tx = buildIssueGrantTx({ stateObjectId: params.stateObjectId, granteeAddress: params.granteeAddress, scopeMask: params.scopeMask })
      const result = await signAndExecuteRef.current(tx)
      const headers = await getAuthHeadersRef.current()
      const syncRes = await fetch(`/api/souls/${params.soulObjectId}/grant`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest }),
      })
      if (!syncRes.ok) {
        const err = await syncRes.json().catch(() => ({}))
        throw new Error(err.error || `Grant sync failed: ${syncRes.status}`)
      }
      return { digest: result.digest, ...(await syncRes.json()) }
    }
    w.__e2eRevokeGrant = async (params: { stateObjectId: string; granteeAddress: string; soulObjectId: string }) => {
      const tx = buildRevokeGrantTx({ stateObjectId: params.stateObjectId, granteeAddress: params.granteeAddress })
      const result = await signAndExecuteRef.current(tx)
      const headers = await getAuthHeadersRef.current()
      const syncRes = await fetch(`/api/souls/${params.soulObjectId}/grant`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txDigest: result.digest, action: 'revoke', granteeAddress: params.granteeAddress }),
      })
      if (!syncRes.ok) {
        const err = await syncRes.json().catch(() => ({}))
        return { digest: result.digest, synced: false, error: err.error }
      }
      return { digest: result.digest, synced: true, ...(await syncRes.json()) }
    }
    return () => {
      delete w.__e2ePublish; delete w.__e2eUpload; delete w.__e2eListSoul
      delete w.__e2eGetAuthHeaders; delete w.__e2eIssueGrant; delete w.__e2eRevokeGrant
      delete w.__e2eLastSealMaterial
    }
  }, [])

  async function handleDeploy() {
    if (!ctx.coverImageFile || !ctx.charFile || !ctx.memoryFile || !suiWallet) return

    setDeployError(null)
    setWalrusOrphanRecovery(null)
    ctx.setPublishResult(null)
    const walletAddress = suiWallet.address

    try {
      // Build a single batch: cover (public) + char/memory/skills (encrypted)
      // files. The batch publishes via 1 register PTB + parallel
      // HTTP uploads, then mint+certify lands in 1 more PTB inside `publish`,
      // for 2 wallet signatures total regardless of how many files.
      const fileIndex = { cover: -1, char: -1, memory: -1, skills: -1 }
      const batchFiles: BatchSoulUploadFile[] = []

      fileIndex.cover = batchFiles.length
      batchFiles.push({
        file: withMime(ctx.coverImageFile),
        uploadType: 'public',
        kind: 'soul-content',
      })

      fileIndex.char = batchFiles.length
      batchFiles.push({
        file: withMime(ctx.charFile),
        uploadType: 'encrypted',
        kind: 'soul-content',
        sendObjectTo: walletAddress,
      })

      fileIndex.memory = batchFiles.length
      batchFiles.push({
        file: withMime(ctx.memoryFile),
        uploadType: 'encrypted',
        kind: 'soul-content',
        sendObjectTo: walletAddress,
      })

      if (ctx.skillsFile) {
        fileIndex.skills = batchFiles.length
        batchFiles.push({
          file: withMime(ctx.skillsFile),
          uploadType: 'encrypted',
          kind: 'soul-content',
          sendObjectTo: walletAddress,
          // Skills bundle requires SKILL.md frontmatter parsing; other batch
          // entries (cover image, char file, memory file) do not.
          extractSkillMetadata: true,
        })
      }

      // Preflight: anything that can fail without consulting a freshly-paid
      // register PTB runs BEFORE `prepareSoulBlobsForBatchPublish`. If a
      // transient HTTP/RPC error or a missing env trips here, the user has
      // not yet signed PTB1 and the next Deploy click does not have to
      // mismatch a freshly re-encrypted payload against an already-paid
      // register. Tags / kiosk / required envs / publish-arg shape are all
      // resolved up-front; the only thing left to fail after PTB1 is the
      // mint+certify PTB itself.
      setUploadPhase('preflight')
      const preflightAuthHeaders = await getAuthHeaders()
      const preflightKioskRes = await fetch(
        `/api/souls/personal-kiosk?walletAddress=${encodeURIComponent(walletAddress)}`,
        { cache: 'no-store', headers: preflightAuthHeaders },
      )
      let prefetchedPersonalKiosk: { currentKioskId: string | null; currentKioskCapOnChainId: string | null } | null = null
      if (preflightKioskRes.status !== 404) {
        if (!preflightKioskRes.ok) {
          const body = await preflightKioskRes.json().catch(() => ({}))
          throw new Error(body.error || 'Failed to resolve personal kiosk')
        }
        prefetchedPersonalKiosk = await preflightKioskRes.json()
      }
      await assertObjectInputsExist(suiClient, {
        'Your personal kiosk': prefetchedPersonalKiosk?.currentKioskId ?? null,
        'Your personal kiosk capability': prefetchedPersonalKiosk?.currentKioskCapOnChainId ?? null,
      })
      if (ctx.collectionBindTarget?.collectionOnChainId) {
        await preflightCollectionBindTarget(preflightAuthHeaders, ctx.collectionBindTarget.collectionOnChainId)
      }
      // The real imageUrl is filled in after PTB1 succeeds; use a placeholder
      // that satisfies the non-empty + ≤1024-byte byte-length guards so the
      // rest of `validateSoulPublishArgs` can still trip on bad name /
      // description / royalty before any wallet signature.
      validateSoulPublishArgs({
        name: ctx.name,
        description: ctx.description,
        imageUrl: 'preflight://placeholder',
        creatorRoyaltyBps: ctx.royalty,
      })
      // List-on-publish price must parse before any paid Walrus register PTB.
      // The preview page already blocks navigation on bad input; this is the
      // back-button / direct-nav safety net so a creator never signs PTB1
      // and then has `usePublish.assertListingPriceAtomic` reject the value.
      if (ctx.listOnPublish === true) {
        assertListingPriceAtomic(ctx.listingPriceAtomic)
      }
      // Surface a missing env ahead of the paid PTB rather than after.
      getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID')
      getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID')
      getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
      getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID')

      // Reuse the prepared batch when the user retries the SAME draft (e.g.
      // closed the mint wallet popup, or hit a transient SDK/RPC error after
      // PTB1 paid). prepareSoulBlobsForBatchPublish re-encrypts every payload
      // with fresh AES-GCM keys, so calling it from scratch on retry yields
      // different blobIds than the persisted PTB1 recovery — which trips the
      // orphan-mismatch branch even though the user only wanted to re-sign
      // mint. Cache lives in `preparedBatchRef`; cleared on successful mint
      // (via wrapped onMintTxExecuted) and on draft changes (fingerprint).
      const fingerprint = buildBatchFingerprint(walletAddress, batchFiles)
      const cachedBatch = preparedBatchRef.current
      const reusable =
        !!cachedBatch
        && cachedBatch.walletAddress === walletAddress
        && cachedBatch.fingerprint === fingerprint
      let prepared: PreparedSoulBlobs
      if (reusable) {
        prepared = cachedBatch.prepared
      } else {
        if (cachedBatch) preparedBatchRef.current = null
        setUploadPhase('preparing-uploads')
        prepared = await prepareSoulBlobsForBatchPublish({
          files: batchFiles,
          walletAddress,
          suiClient,
          signAndExecute,
          authHeaders: preflightAuthHeaders,
          confirmQuote: async (quote) => {
            setUploadPhase('awaiting-register-signature')
            const approved = await requestUploadCostApproval(quote)
            if (approved) setUploadPhase('uploading-to-relay')
            return approved
          },
        })
        preparedBatchRef.current = { walletAddress, fingerprint, prepared }
      }

      const cover = prepared.files[fileIndex.cover]
      const char = prepared.files[fileIndex.char]
      const memory = prepared.files[fileIndex.memory]
      const skills = fileIndex.skills >= 0 ? prepared.files[fileIndex.skills] : null

      if (!char.sealMaterial) {
        throw new Error('Character file upload is missing Seal recovery data. Please retry.')
      }
      if (!memory.sealMaterial) {
        throw new Error('Memory file upload is missing Seal recovery data. Please retry.')
      }
      if (skills && !skills.sealMaterial) {
        throw new Error('Skills bundle upload is missing Seal recovery data. Please retry.')
      }
      if (!char.blobObjectId) {
        throw new Error('Character file upload was deduplicated by Walrus and no owned Blob object was created. Please modify your character file slightly and retry.')
      }
      if (!memory.blobObjectId) {
        throw new Error('This exact memory text already exists on Walrus. Please add a unique detail to your memory so it can be stored as a distinct on-chain founding memory.')
      }
      if (skills && !skills.blobObjectId) {
        throw new Error('Skills bundle upload was deduplicated by Walrus and no owned Blob object was created. Please modify your skills file slightly and retry.')
      }

      const results: UploadResults = {
        ownerAddress: walletAddress,
        coverImage: {
          blobId: cover.blobId,
          blobObjectId: cover.blobObjectId,
          contentHash: cover.contentHash,
          blobUrl: cover.blobUrl,
        },
        charFile: {
          blobId: char.blobId,
          blobObjectId: char.blobObjectId,
          contentHash: char.contentHash,
          blobUrl: char.blobUrl,
          sealMaterial: char.sealMaterial,
          skillName: char.skillName ?? null,
        },
        memorySeed: {
          blobId: memory.blobId,
          blobObjectId: memory.blobObjectId,
          contentHash: memory.contentHash,
          blobUrl: memory.blobUrl,
          sealMaterial: memory.sealMaterial,
        },
        skillsFile: skills && skills.sealMaterial
          ? {
              blobId: skills.blobId,
              blobObjectId: skills.blobObjectId,
              contentHash: skills.contentHash,
              blobUrl: skills.blobUrl,
              sealMaterial: skills.sealMaterial,
              skillName: skills.skillName ?? null,
            }
          : undefined,
      }
      ctx.setUploadResults(results)
      setUploadPhase('done')

      if (process.env.NODE_ENV === 'development') {
        ;(window as any).__e2eLastSealMaterial = {
          char: char.sealMaterial,
          memory: memory.sealMaterial,
          skills: skills?.sealMaterial ?? null,
        }
      }

      const parsedTags = ctx.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)

      await publish({
        name: ctx.name,
        description: ctx.description,
        tags: parsedTags,
        imageUrl: cover.blobUrl,
        previewImages: [cover.blobUrl],
        prefetchedPersonalKiosk,
        protectedBlobObjectId: char.blobObjectId,
        foundingMemoryBlobObjectId: memory.blobObjectId,
        skillsBlobObjectId: skills?.blobObjectId ?? null,
        initialSkillName: skills?.skillName ?? null,
        skillsVisibility: 'private',
        creatorRoyaltyBps: ctx.royalty,
        sealMaterial: char.sealMaterial,
        memorySealMaterial: memory.sealMaterial,
        skillsSealMaterial: skills?.sealMaterial ?? null,
        attachBeforeMint: prepared.attachCertifyCalls,
        onMintTxExecuted: () => {
          prepared.clearBatchRecovery()
          preparedBatchRef.current = null
        },
        collectionBindTarget: ctx.collectionBindTarget,
        listOnPublish: ctx.listOnPublish === true,
        listingPriceAtomic: ctx.listOnPublish === true ? (ctx.listingPriceAtomic ?? null) : null,
      })
    } catch (err) {
      if (err instanceof WalrusUploadResumeMismatchError) {
        preparedBatchRef.current = null
        setWalrusOrphanRecovery({
          orphanTxDigest: err.orphanTxDigest,
          orphanBlobs: [...err.orphanBlobs],
        })
        setDeployError(
          'A previous Walrus register transaction can no longer be resumed because the encrypted payload changed. '
          + 'The stale local recovery was cleared; reclaim the orphaned blobs, or click Sign & Deploy again to start from a clean register.',
        )
        setUploadPhase('idle')
        return
      }
      if (!(err instanceof WalrusUploadCancelledError)) {
        captureFrontendException(err, {
          scope: 'create_soul_deploy',
          phase: uploadPhase,
          ...getSuiTxErrorProperties(err),
        })
      }
      setDeployError(err instanceof Error ? err.message : 'Deploy failed')
      setUploadPhase('idle')
    }
  }

  async function handleReclaimWalrusOrphans() {
    if (!suiWallet || !walrusOrphanRecovery || reclaimingOrphans) return

    setReclaimingOrphans(true)
    setDeployError(null)
    try {
      const result = await reclaimWalrusOrphanBlobs({
        orphanBlobs: walrusOrphanRecovery.orphanBlobs,
        walletAddress: suiWallet.address,
        suiClient,
        signAndExecute,
      })
      setWalrusOrphanRecovery(null)
      preparedBatchRef.current = null
      showToast(`Reclaimed ${result.reclaimedCount} Walrus blob(s).`, 'success')
    } catch (err) {
      captureFrontendException(err, {
        scope: 'create_soul_walrus_orphan_reclaim',
        txDigest: walrusOrphanRecovery.orphanTxDigest,
        ...getSuiTxErrorProperties(err),
      })
      setDeployError(err instanceof Error ? err.message : 'Failed to reclaim Walrus blobs')
    } finally {
      setReclaimingOrphans(false)
    }
  }

  // Resume sync for a pending mint recovery (on-chain TX succeeded, sync failed/interrupted)
  async function handleResume() {
    if (!suiWallet || !txDigest) return
    setDeployError(null)
    try {
      // Recovery path in usePublish skips build+sign and uses stored sync body
      await publish({
        name: '', description: '', tags: [], imageUrl: '',
        previewImages: [], protectedBlobObjectId: '', creatorRoyaltyBps: 0,
        listOnPublish: false,
      })
    } catch (err) {
      captureFrontendException(err, {
        scope: 'create_soul_resume_sync',
        txDigest,
        ...getSuiTxErrorProperties(err),
      })
      setDeployError(err instanceof Error ? err.message : 'Resume failed')
    }
  }

  function handleAbandonRecovery() {
    ctx.reset()
    router.replace('/create')
  }

  if (!inRecovery && status !== 'done' && (!ctx.name || !ctx.description || !ctx.coverImageFile || !ctx.charFile || !ctx.memoryFile)) return null

  const network = process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet'
  const networkLabel = network === 'mainnet' ? 'Sui Mainnet' : `Sui ${network.charAt(0).toUpperCase() + network.slice(1)}`
  const isBusy = reclaimingOrphans || uploadPhase !== 'idle' && uploadPhase !== 'done' || status === 'building' || status === 'signing' || status === 'syncing'
  const combinedError = deployError || error
  const walletRestoring = !suiWallet && (walletConnection.isConnecting || autoConnectStatus === 'idle')
  const walletActionState = getWalletActionState({
    hasActiveWallet: !!suiWallet,
    hasSessionWallet: !!user?.primarySuiAddress,
    walletRestoring,
    busy: isBusy,
    busyLabel: uploadPhaseLabels[uploadPhase] || `${status}...`,
    balanceBlocked,
    recovery: inRecovery,
    txDigest,
    readyLabel: '✓ Sign & Deploy',
  })

  function handleWalletAction(action: () => void | Promise<void>) {
    if (walletActionState.needsWalletReconnect) {
      openWalletLogin()
      return
    }
    void action()
  }

  return (
    <div className="relative z-10 border-t border-purple/20">
      <FlowBar steps={steps} currentStep={3} />

      <PageContainer size="sm" className="space-y-5 pt-7 sm:pt-9">
        <SectionHeader
          label="Create Soul"
          title={inRecovery ? 'Step 4 — Resume Sync' : 'Step 4 — Pay Gas'}
          subtitle={inRecovery
            ? 'Your previous mint transaction succeeded. Complete the sync to finish creating your Soul.'
            : 'Your Soul will be minted as a Soul object on Sui. Review the transaction before signing.'}
          className="mb-1"
        />

        {inRecovery ? (
          <div className="rounded-2xl border border-[#F59E0B]/40 bg-[#F59E0B]/8 p-5 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#F59E0B]">
              Pending Soul Mint
            </div>
            <p className="text-sm text-muted leading-relaxed">
              A previous mint transaction succeeded on-chain but the mirror sync was interrupted.
              Resume to complete the process, or start over to create a new Soul.
            </p>
            {txDigest && (
              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-black/20 px-3 py-2">
                <span className="text-[10px] text-muted">TX Digest</span>
                <span className="font-mono text-xs text-teal">{txDigest.slice(0, 16)}…</span>
              </div>
            )}
          </div>
        ) : (
          <>
        {/* Transaction Preview card */}
        <div className="rounded-2xl border border-purple/30 bg-card p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#F59E0B] mb-4">
            Transaction Preview
          </div>

          <div className="divide-y divide-border/50">
            <TxRow label="Contract">
              <span className="font-mono text-teal">market::mint_native_in_personal_kiosk</span>
            </TxRow>
            <TxRow label="Network">
              <span className="font-semibold text-foreground">{networkLabel}</span>
            </TxRow>
            <TxRow label="Soul Name">
              <span className="font-semibold text-foreground">{ctx.name}</span>
            </TxRow>
            <TxRow label="Soul Character">
              <span className="text-foreground">{ctx.charFile?.name}</span>
              <span className="text-muted ml-1.5">(encrypted via Seal)</span>
            </TxRow>
            <TxRow label="Memory">
              <span className="text-foreground">{ctx.memoryFile?.name}</span>
              <span className="text-muted ml-1.5">(encrypted founding entry)</span>
            </TxRow>
            {ctx.skillsFile && (
              <TxRow label="Skills & Docs">
                <span className="text-foreground">{ctx.skillsFile.name}</span>
                <span className="text-muted ml-1.5">(Seal encrypted)</span>
              </TxRow>
            )}
            <TxRow label="Creator Royalty">
              <span className="font-semibold text-[#F59E0B]">
                {royaltyLabels[ctx.royalty] ?? `${ctx.royalty / 100}% (locked on-chain)`}
              </span>
            </TxRow>
            <TxRow label="Soul Policy" align="top">
              <span className="text-muted leading-relaxed">
                Character locked after mint · Grant-gated memory writes · Skills private by default · Revocable
              </span>
            </TxRow>
            <TxRow label="Estimated Gas">
              <span className="text-foreground">~0.005 SUI</span>
            </TxRow>
            <TxRow label="Walrus Storage">
              <span className="text-muted">Paid by connected wallet after cost review</span>
            </TxRow>
          </div>
        </div>

        {/* Balance warning */}
        {!balances.loading && balanceBlocked && (
          <div className="rounded-2xl border border-danger/40 bg-danger/8 p-4 space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-danger">
              Insufficient Balance
            </div>
            {suiInsufficient && (
              <p className="text-xs text-danger/90">
                SUI balance: <span className="font-mono font-semibold">{formatBalance(balances.sui!, 9)} SUI</span>
                {' '}— need at least <span className="font-semibold">0.04 SUI</span> for gas fees.
              </p>
            )}
            {suiWallet && (
              <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-black/20 px-3 py-2">
                <span className="text-[10px] text-muted shrink-0">Your address:</span>
                <code className="min-w-0 text-[11px] font-mono text-foreground">{suiWallet.address.slice(0, 20)}…{suiWallet.address.slice(-20)}</code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(suiWallet.address)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                  className={`shrink-0 rounded p-1 transition-colors ${copied ? 'text-success' : 'text-muted/60 hover:text-foreground'}`}
                  aria-label="Copy address"
                >
                  {copied ? (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="m3.5 8.25 2.5 2.5L12.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <rect x="5.5" y="5.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  )}
                </button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <p className="text-[11px] text-muted">
                Top up with SUI before deploying.
              </p>
              <button
                type="button"
                disabled={balances.loading}
                onClick={() => balances.refresh()}
                className={`shrink-0 rounded p-1 text-muted/60 transition-colors hover:text-foreground ${balances.loading ? 'animate-spin' : ''}`}
                aria-label="Refresh balance"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M2.5 8a5.5 5.5 0 0 1 9.95-3.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M10 2l2.75 2.75L10 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M13.5 8a5.5 5.5 0 0 1-9.95 3.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        )}
          </>
        )}

        {/* Publish status (hidden until active) */}
        {(status !== 'idle' || combinedError) && (
          <div className="card px-5 py-4 space-y-3" data-testid="publish-status">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Status</span>
              <span className={`text-sm font-semibold ${
                status === 'done' ? 'text-success' :
                status === 'error' || combinedError ? 'text-danger' : 'text-purple'
              }`}>
                {uploadPhase !== 'idle' && uploadPhase !== 'done' && uploadPhaseLabels[uploadPhase]}
                {uploadPhase === 'done' && status === 'building' && '⟳ Building TX…'}
                {status === 'signing' && '⟳ Signing…'}
                {status === 'syncing' && '⟳ Syncing…'}
                {status === 'done' && '✓ Published'}
                {status === 'error' && '✗ Failed'}
              </span>
            </div>
            {txDigest && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted">TX Digest</span>
                <span className="text-sm font-mono text-foreground">{txDigest.slice(0, 16)}…</span>
              </div>
            )}
            {combinedError && (
              <div className="text-sm text-danger bg-danger/10 border border-danger/30 rounded-lg px-4 py-3">
                {combinedError}
              </div>
            )}
            {walrusOrphanRecovery && (
              <div className="space-y-3 rounded-lg border border-[#F59E0B]/30 bg-[#F59E0B]/8 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#F59E0B]">
                      Walrus Orphan Recovery
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      Previous register: <span className="font-mono text-foreground">{walrusOrphanRecovery.orphanTxDigest.slice(0, 16)}…</span>
                      {' '}· {walrusOrphanRecovery.orphanBlobs.length} blob(s)
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={walletActionState.disabled || reclaimingOrphans}
                    onClick={() => handleWalletAction(handleReclaimWalrusOrphans)}
                    className={buttonStyles({
                      variant: 'outline',
                      size: 'sm',
                      className:
                        `shrink-0 rounded-[10px] border-[#F59E0B]/40 px-3 py-1.5 text-[12px] text-[#F59E0B] hover:border-[#F59E0B]/70 ${walletActionState.disabled || reclaimingOrphans ? 'opacity-50 cursor-not-allowed' : ''}`,
                    })}
                  >
                    {reclaimingOrphans ? 'Reclaiming…' : 'Reclaim'}
                  </button>
                </div>
                <p className="text-[11px] leading-relaxed text-muted">
                  Reclaim signs a Walrus delete transaction for the stale deletable Blob objects.
                  You can also deploy again from a clean register if you choose to leave them orphaned.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Deploying overlay */}
        {isBusy && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="rounded-2xl border border-purple/30 bg-card2 p-10 text-center max-w-sm mx-4 shadow-[0_24px_60px_rgba(124,58,237,0.25)]">
              <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-2 border-purple/30 border-t-purple" />
              <h2 className="text-lg font-bold mb-2">
                {uploadPhase !== 'idle' && uploadPhase !== 'done'
                  ? 'Uploading to Walrus…'
                  : 'Deploying Soul…'}
              </h2>
              <p className="text-sm text-muted">
                {uploadPhase !== 'idle' && uploadPhase !== 'done'
                  ? uploadPhaseLabels[uploadPhase]
                  : `Writing to ${networkLabel} · Registering Seal policy`}
              </p>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex flex-col-reverse gap-2.5 sm:flex-row">
          {inRecovery ? (
            <button
              type="button"
              onClick={handleAbandonRecovery}
              className={buttonStyles({
                variant: 'outline',
                size: 'lg',
                className:
                  'w-full rounded-[10px] border-purple/20 bg-transparent px-4 py-2.5 text-[13px] text-foreground hover:border-purple/45 hover:text-foreground sm:w-auto sm:min-w-[76px]',
              })}
            >
              Start Over
            </button>
          ) : (
            <Link
              href="/create/preview"
              className={buttonStyles({
                variant: 'outline',
                size: 'lg',
                className:
                  'w-full rounded-[10px] border-purple/20 bg-transparent px-4 py-2.5 text-[13px] text-foreground hover:border-purple/45 hover:text-foreground sm:w-auto sm:min-w-[76px]',
              })}
            >
              ← Back
            </Link>
          )}
          {status === 'done' ? (
            <Link
              href="/create/success"
              className={buttonStyles({ variant: 'gold', size: 'lg', full: true, className: 'rounded-[10px] px-4 py-2.5 text-[13px]' })}
            >
              Continue <span aria-hidden="true">→</span>
            </Link>
          ) : inRecovery ? (
            <button
              type="button"
              disabled={walletActionState.disabled}
              onClick={() => handleWalletAction(handleResume)}
              className={buttonStyles({
                variant: 'gold',
                size: 'lg',
                full: true,
                className: `rounded-[10px] px-4 py-2.5 text-[13px] ${isBusy ? 'opacity-60 cursor-wait' : ''} ${walletActionState.disabled ? 'opacity-50 cursor-not-allowed' : ''}`,
              })}
            >
              {walletActionState.label}
            </button>
          ) : (
            <button
              type="button"
              disabled={walletActionState.disabled}
              onClick={() => handleWalletAction(handleDeploy)}
              className={buttonStyles({
                variant: 'gold',
                size: 'lg',
                full: true,
                className: `rounded-[10px] px-4 py-2.5 text-[13px] ${isBusy ? 'opacity-60 cursor-wait' : ''} ${walletActionState.disabled ? 'opacity-50 cursor-not-allowed' : ''}`,
              })}
            >
              {walletActionState.label}
            </button>
          )}
        </div>
      </PageContainer>
    </div>
  )
}
