'use client'

import { useCallback, useState } from 'react'
import { SessionKey } from '@mysten/seal'
import { Transaction } from '@mysten/sui/transactions'
import { useQueryClient } from '@tanstack/react-query'
import {
  CANONICAL_MEMORY_NAME,
  KIND_MEMORY,
  KIND_SKILL,
  KIND_SPRITE,
  NO_DOWNLOAD_POLICY,
  READ_GRANT,
  READ_OWNER,
  READ_PUBLIC,
  SOUL_GRANT_SCOPE_ASSETS,
  SOUL_GRANT_SCOPE_MEMORY,
  SOUL_GRANT_SCOPE_SKILLS,
  addAppendContentVersionAsGrantedAgentCalls,
  addAppendContentVersionAsOwnerCalls,
  addSetActiveContentCalls,
  addSetStateConfigCalls,
  assertObjectInputsExist,
  extractSkillBundleMetadata,
  hasZipSignature,
  buildClearActiveContentTx,
  buildDeleteContentVersionAsGrantedAgentTx,
  buildDeleteContentVersionAsOwnerTx,
  buildPurgeContentVersionAsOwnerTx,
  buildSetActiveContentTx,
  buildSetStateConfigTx,
  extractContentVersionAppendedEvent,
  getRequiredSoulidityEnv,
  sameSuiValue,
  type ContentAccessResponse,
  type SealEnvelopeSidecar,
  type SoulAssetDetail,
  type SoulContentVersionRecord,
  type SoulDownloadPolicy,
  type SoulGrantRecord,
} from '@soulidity/sdk'
import { useAuth } from '@/components/providers/auth-provider'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { buildContentSidecarsForVersionsWithSuiClient } from '@/lib/hooks/phase2-mint-helpers'
import { base64ToBytes, createBrowserSealClient, sha256Hex } from '@/lib/upload/client-seal'
import { uploadSoulPayload, type SoulUploadType } from '@/lib/upload/client-upload'

export interface UseSoulContentActionsState {
  pendingAction: 'append' | 'open' | 'delete' | 'purge' | 'set-active' | 'clear-active' | null
  contentActionError: string | null
}

interface UseSoulContentActionsParams {
  soul: SoulAssetDetail
  role: 'owner' | 'grantee' | 'visitor'
  detailQueryId: string
  viewerId?: string | null
}

interface AppendContentVersionParams {
  kind: number
  name: string
  file: File
  uploadType: SoulUploadType
  slotReadModeMask: number
  downloadPolicy: SoulDownloadPolicy
  setActive?: boolean
  spriteConfigJson?: string | null
  spriteMoodMapJson?: string | null
}

const SUI_CLOCK_OBJECT_ID = '0x6'

// `/content/sync` returns 503 when `resolveWalrusBlobId` cannot read the
// Walrus Blob object emitted by the append transaction yet. The route is
// idempotent (keyed by routeKey + txDigest + actor + resource and only
// persisted on response.ok), so replaying the same body once chain data
// catches up is safe. Five attempts with these delays gives ~7.5s of
// additional propagation budget — enough to absorb the typical post-TX
// fan-out window without stranding the in-memory append payload.
const POST_SYNC_RETRY_DELAYS_MS = [500, 1000, 2000, 4000]

function delayMs(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function getCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is not available in this runtime')
  }
  return globalThis.crypto
}

function toCryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) as Uint8Array<ArrayBuffer>
}

function stripHexPrefix(value: string) {
  return value.startsWith('0x') ? value.slice(2) : value
}

function hexToBytes(value: string) {
  const hex = stripHexPrefix(value)
  if (hex.length % 2 !== 0) throw new Error('hex value must have an even length')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

async function importAesDecryptKey(rawKey: Uint8Array) {
  return getCrypto().subtle.importKey(
    'raw',
    toCryptoBytes(rawKey),
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
}

async function decryptCiphertext(params: {
  encryptedData: Uint8Array
  keyMaterial: Uint8Array
  sidecar: SealEnvelopeSidecar
}) {
  if (params.keyMaterial.length !== 64) {
    throw new Error('Seal envelope key material is invalid')
  }
  const dek = params.keyMaterial.subarray(0, 32)
  const boundHash = Array.from(params.keyMaterial.subarray(32), (byte) => byte.toString(16).padStart(2, '0')).join('')
  if (boundHash !== stripHexPrefix(params.sidecar.contentHash).toLowerCase()) {
    throw new Error('Seal envelope content hash binding mismatch')
  }
  const key = await importAesDecryptKey(dek)
  const plaintext = new Uint8Array(
    await getCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: toCryptoBytes(base64ToBytes(params.sidecar.iv)) },
      key,
      toCryptoBytes(params.encryptedData),
    ),
  )
  if ((await sha256Hex(plaintext)) !== boundHash) {
    throw new Error('Seal envelope content hash mismatch')
  }
  return plaintext
}

async function fetchBytes(url: string) {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error('Failed to fetch Walrus content')
  }
  return new Uint8Array(await response.arrayBuffer())
}

function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string) {
  const blobPart = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const blob = new Blob([blobPart], { type: mimeType || 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName || 'soul-content.bin'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function scopeMaskForKind(kind: number) {
  if (kind === KIND_SPRITE) return SOUL_GRANT_SCOPE_ASSETS
  if (kind === KIND_SKILL) return SOUL_GRANT_SCOPE_SKILLS
  if (kind === KIND_MEMORY) return SOUL_GRANT_SCOPE_MEMORY
  return 0
}

function grantHasScope(grant: SoulGrantRecord, scopeMask: number) {
  if (scopeMask === SOUL_GRANT_SCOPE_ASSETS) return grant.scopes.includes('assets')
  if (scopeMask === SOUL_GRANT_SCOPE_SKILLS) return grant.scopes.includes('skills')
  if (scopeMask === SOUL_GRANT_SCOPE_MEMORY) return grant.scopes.includes('memory')
  return false
}

function findGrantForWallet(grants: SoulGrantRecord[], walletAddress: string | null, kind: number) {
  if (!walletAddress) return null
  const scopeMask = scopeMaskForKind(kind)
  return grants.find((grant) =>
    grant.status === 'active'
    && grantHasScope(grant, scopeMask)
    && sameSuiValue(grant.granteeAddress, walletAddress),
  ) ?? null
}

function defaultSlotReadModeFor(kind: number, visibility?: 'public' | 'private') {
  if (kind === KIND_SPRITE && visibility === 'public') {
    return READ_OWNER | READ_GRANT | READ_PUBLIC
  }
  return READ_OWNER | READ_GRANT
}

function buildContentSealApprovalTx(access: Extract<ContentAccessResponse, { visibility: 'sealed' }>) {
  const tx = new Transaction()
  const documentIdArg = tx.pure.vector('u8', Array.from(hexToBytes(access.accessPolicy.documentIdHex)))
  const kindArg = tx.pure.u32(access.accessPolicy.kind)
  const nameArg = tx.pure.string(access.accessPolicy.name)
  const versionArg = tx.pure.u64(BigInt(access.accessPolicy.versionIndex))
  const target = `${access.accessPolicy.packageId}::${access.accessPolicy.moduleName}::${access.accessPolicy.functionName}`

  if (access.accessPolicy.functionName === 'seal_approve_content_owner') {
    tx.moveCall({
      target,
      arguments: [
        documentIdArg,
        tx.object(access.accessPolicy.stateObjectId),
        tx.object(access.accessPolicy.contentObjectId),
        kindArg,
        nameArg,
        versionArg,
      ],
    })
  } else if (access.accessPolicy.functionName === 'seal_approve_content_granted_agent') {
    if (!access.accessPolicy.soulGrantObjectId) {
      throw new Error('SoulGrant object is missing for granted-agent content access')
    }
    tx.moveCall({
      target,
      arguments: [
        documentIdArg,
        tx.object(access.accessPolicy.stateObjectId),
        tx.object(access.accessPolicy.contentObjectId),
        tx.object(access.accessPolicy.soulGrantObjectId),
        kindArg,
        nameArg,
        versionArg,
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    })
  } else if (access.accessPolicy.functionName === 'seal_approve_content_paid_access') {
    if (!access.accessPolicy.paidAccessListOnChainId) {
      throw new Error('Paid access list object is missing for paid content access')
    }
    tx.moveCall({
      target,
      arguments: [
        documentIdArg,
        tx.object(access.accessPolicy.stateObjectId),
        tx.object(access.accessPolicy.paidAccessListOnChainId),
        tx.object(access.accessPolicy.contentObjectId),
        kindArg,
        nameArg,
        versionArg,
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    })
  } else {
    tx.moveCall({
      target,
      arguments: [
        documentIdArg,
        tx.object(access.accessPolicy.stateObjectId),
        tx.object(access.accessPolicy.contentObjectId),
        kindArg,
        nameArg,
        versionArg,
      ],
    })
  }

  return tx
}

function contentSyncBody(params: Record<string, unknown>) {
  return JSON.stringify(params)
}

export function useSoulContentActions({
  soul,
  role,
  detailQueryId,
  viewerId,
}: UseSoulContentActionsParams) {
  const [pendingAction, setPendingAction] = useState<UseSoulContentActionsState['pendingAction']>(null)
  const [contentActionError, setContentActionError] = useState<string | null>(null)
  const { getAuthHeaders } = useAuth()
  const { suiWallet, signAndExecute, signPersonalMessage, suiClient } = useWalletSign()
  const queryClient = useQueryClient()

  const invalidateSoul = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['soul', detailQueryId, viewerId ?? null] })
    void queryClient.invalidateQueries({ queryKey: ['soul', soul.onChainId] })
  }, [detailQueryId, queryClient, soul.onChainId, viewerId])

  const postSync = useCallback(async (body: Record<string, unknown>) => {
    const authHeaders = await getAuthHeaders()
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`/api/souls/${encodeURIComponent(soul.onChainId)}/content/sync`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: contentSyncBody(body),
      })
      if (response.ok) {
        return response.json()
      }
      const payload = await response.json().catch(() => ({}))
      const message = payload.error ?? 'Failed to mirror Soulidity content transaction'
      // Only 503 is a documented retryable state from /content/sync (transient
      // chain read of the emitted Walrus Blob). Treat any other status as
      // terminal so we don't mask real validation / auth / mismatch failures.
      if (response.status === 503 && attempt < POST_SYNC_RETRY_DELAYS_MS.length) {
        await delayMs(POST_SYNC_RETRY_DELAYS_MS[attempt])
        continue
      }
      throw new Error(message)
    }
  }, [getAuthHeaders, soul.onChainId])

  const setStateConfig = useCallback(async (key: string, value: string) => {
    if (role !== 'owner') return
    if (!suiWallet) throw new Error('Connect a Sui wallet before updating content config')
    const tx = buildSetStateConfigTx({
      stateObjectId: soul.stateOnChainId,
      key,
      valueUtf8: value,
    })
    const result = await signAndExecute(tx)
    await postSync({
      action: 'state-config:upsert',
      txDigest: result.digest,
      key,
      value,
    })
  }, [postSync, role, signAndExecute, soul.stateOnChainId, suiWallet])

  const setActiveContent = useCallback(async (kind: number, name: string, versionIndex: number) => {
    if (role !== 'owner') throw new Error('Only the Soul owner can set active content')
    if (!suiWallet) throw new Error('Connect a Sui wallet before setting active content')
    if (!soul.contentOnChainId) throw new Error('Soul content root is not available')
    setPendingAction('set-active')
    setContentActionError(null)
    try {
      await assertObjectInputsExist(suiClient, {
        'Soul content': soul.contentOnChainId,
        'Soul state': soul.stateOnChainId,
      })
      const tx = buildSetActiveContentTx({
        contentObjectId: soul.contentOnChainId,
        stateObjectId: soul.stateOnChainId,
        kindRegistryObjectId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID'),
        kind,
        name,
        versionIndex,
      })
      const result = await signAndExecute(tx)
      await postSync({
        action: 'active-bind',
        txDigest: result.digest,
        kind,
        name,
        versionIndex,
      })
      invalidateSoul()
    } catch (error) {
      setContentActionError(error instanceof Error ? error.message : 'Failed to set active content')
      throw error
    } finally {
      setPendingAction(null)
    }
  }, [invalidateSoul, postSync, role, signAndExecute, soul.contentOnChainId, soul.stateOnChainId, suiClient, suiWallet])

  const clearActiveContent = useCallback(async (kind: number) => {
    if (role !== 'owner') throw new Error('Only the Soul owner can clear active content')
    if (!suiWallet) throw new Error('Connect a Sui wallet before clearing active content')
    if (!soul.contentOnChainId) throw new Error('Soul content root is not available')
    setPendingAction('clear-active')
    setContentActionError(null)
    try {
      await assertObjectInputsExist(suiClient, {
        'Soul content': soul.contentOnChainId,
        'Soul state': soul.stateOnChainId,
      })
      const tx = buildClearActiveContentTx({
        contentObjectId: soul.contentOnChainId,
        stateObjectId: soul.stateOnChainId,
        kindRegistryObjectId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID'),
        kind,
      })
      const result = await signAndExecute(tx)
      await postSync({
        action: 'active-clear',
        txDigest: result.digest,
        kind,
      })
      invalidateSoul()
    } catch (error) {
      setContentActionError(error instanceof Error ? error.message : 'Failed to clear active content')
      throw error
    } finally {
      setPendingAction(null)
    }
  }, [invalidateSoul, postSync, role, signAndExecute, soul.contentOnChainId, soul.stateOnChainId, suiClient, suiWallet])

  const appendContentVersion = useCallback(async (params: AppendContentVersionParams) => {
    if (role !== 'owner' && role !== 'grantee') {
      throw new Error('Only the Soul owner or a scoped grantee can append content')
    }
    if (!suiWallet) throw new Error('Connect a Sui wallet before appending content')
    if (!soul.contentOnChainId) throw new Error('Soul content root is not available')
    const contentOnChainId = soul.contentOnChainId
    const grant = role === 'grantee'
      ? findGrantForWallet(soul.activeGrants, suiWallet.address, params.kind)
      : null
    if (role === 'grantee' && !grant?.onChainId) {
      throw new Error('No active grant covers this content kind')
    }

    setPendingAction('append')
    setContentActionError(null)
    try {
      const authHeaders = await getAuthHeaders()
      // The append moveCall's `name` argument must be known BEFORE the
      // certify+append PTB is signed. Skill bundles parse it from the
      // SKILL.md frontmatter; other kinds receive it from the caller. Do
      // the parse here so the in-PTB callback below can use it directly.
      let resolvedName: string | null = params.name ?? null
      if (params.kind === KIND_SKILL) {
        const fileBytes = new Uint8Array(await params.file.arrayBuffer())
        if (!hasZipSignature(fileBytes)) {
          throw new Error('Skill bundle must be a .zip archive')
        }
        const metadata = extractSkillBundleMetadata(fileBytes)
        resolvedName = metadata.skillName
      }
      if (!resolvedName) {
        throw new Error(params.kind === KIND_SKILL
          ? 'Skills bundle must include SKILL.md frontmatter name'
          : 'A name is required for non-skill content versions')
      }

      const kindRegistryObjectId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID')
      const stateOnChainId = soul.stateOnChainId

      const upload = await uploadSoulPayload({
        file: params.file,
        uploadType: params.uploadType,
        kind: params.kind === KIND_SPRITE ? 'persona-sprite' : 'soul-content',
        // Only skill bundles carry `SKILL.md` and have a name resolved from
        // ZIP frontmatter. Sprite ZIPs (KIND_SPRITE) and memory uploads
        // (KIND_MEMORY) must skip the skill-bundle parser, otherwise a
        // sprite-sheet ZIP without `SKILL.md` would abort here.
        extractSkillMetadata: params.kind === KIND_SKILL,
        authHeaders,
        sendObjectTo: suiWallet.address,
        walletAddress: suiWallet.address,
        suiClient,
        signAndExecute,
        confirmQuote: async (quote) => {
          if (typeof window === 'undefined') return true
          const totalMist = quote.relayTipMist + quote.walStorageCost + quote.walWriteCost + quote.gasBudgetMist
          return window.confirm(`Approve Walrus storage: ${totalMist.toString()} MIST for ${quote.storageEpochs} epoch(s)?`)
        },
        // Splice every post-certify Soulidity moveCall into the Walrus
        // certify PTB so a full upload (incl. sprite config + setActive)
        // costs exactly 2 wallet signatures: register, then
        // certify+append+config+setActive. `register_blob` must stay its
        // own signature because it commits on chain BEFORE the off-chain
        // blob upload — validators have nothing to certify until then.
        attachAfterCertify: (tx, blobObjectId) => {
          const common = {
            contentObjectId: contentOnChainId,
            stateObjectId: stateOnChainId,
            kindRegistryObjectId,
            kind: params.kind,
            name: resolvedName as string,
            slotReadModeMask: params.slotReadModeMask,
            downloadPolicy: params.downloadPolicy,
            contentBlobObjectId: blobObjectId,
          }
          // The append moveCall returns the new version index as a u64;
          // capture it as a TransactionArgument so set_active_content can
          // reference the just-appended slot in the same PTB without us
          // having to predict the index off chain.
          const versionIndexArg = role === 'grantee'
            ? addAppendContentVersionAsGrantedAgentCalls(tx, {
                ...common,
                soulGrantObjectId: grant!.onChainId,
              })
            : addAppendContentVersionAsOwnerCalls(tx, common)

          if (params.kind === KIND_SPRITE && role === 'owner') {
            // SoulState.config_ext writes don't need the append result —
            // they only depend on the SoulState object id, which is a
            // shared reference already in the PTB.
            if (params.spriteConfigJson) {
              addSetStateConfigCalls(tx, {
                stateObjectId: stateOnChainId,
                key: 'sprite_config_json',
                valueUtf8: params.spriteConfigJson,
              })
            }
            if (params.spriteMoodMapJson) {
              addSetStateConfigCalls(tx, {
                stateObjectId: stateOnChainId,
                key: 'sprite_mood_map_json',
                valueUtf8: params.spriteMoodMapJson,
              })
            }
            if (params.setActive) {
              addSetActiveContentCalls(tx, {
                contentObjectId: contentOnChainId,
                stateObjectId: stateOnChainId,
                kindRegistryObjectId,
                kind: params.kind,
                name: resolvedName as string,
                versionIndex: versionIndexArg,
              })
            }
          }
        },
      })

      const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
      if (!upload.certifyTxResult) {
        throw new Error('Certify TX result missing — append moveCall was not spliced into the upload PTB')
      }
      const event = extractContentVersionAppendedEvent(upload.certifyTxResult as never, packageId)
      const sidecars = await buildContentSidecarsForVersionsWithSuiClient({
        suiClient,
        packageId,
        contentObjectId: event.contentId,
        pendingByKindName: [{
          kind: event.kind,
          name: event.name,
          material: upload.sealMaterial ?? null,
        }],
        versions: [{
          kind: event.kind,
          name: event.name,
          versionIndex: event.versionIndex,
          sealEncrypted: event.sealEncrypted,
        }],
      })

      await postSync({
        action: 'append',
        txDigest: upload.certifyTxDigest,
        kind: event.kind,
        name: event.name,
        blobId: upload.blobId,
        contentHash: upload.contentHash,
        sealSidecar: sidecars[0]?.sidecar ?? null,
      })

      // The combined PTB also emitted state-config + active-binding
      // events when relevant. Mirror them with their own postSync calls
      // against the same `certifyTxDigest`; the sync route's idempotency
      // table is keyed by `(routeKey, txDigest, actor, resourceKey)` so
      // each action stores independently.
      if (params.kind === KIND_SPRITE && role === 'owner') {
        if (params.spriteConfigJson) {
          await postSync({
            action: 'state-config:upsert',
            txDigest: upload.certifyTxDigest,
            key: 'sprite_config_json',
            value: params.spriteConfigJson,
          })
        }
        if (params.spriteMoodMapJson) {
          await postSync({
            action: 'state-config:upsert',
            txDigest: upload.certifyTxDigest,
            key: 'sprite_mood_map_json',
            value: params.spriteMoodMapJson,
          })
        }
        if (params.setActive) {
          await postSync({
            action: 'active-bind',
            txDigest: upload.certifyTxDigest,
            kind: event.kind,
            name: event.name,
            versionIndex: event.versionIndex,
          })
        }
      }

      invalidateSoul()
      return event
    } catch (error) {
      setContentActionError(error instanceof Error ? error.message : 'Failed to append content')
      throw error
    } finally {
      setPendingAction(null)
    }
  }, [getAuthHeaders, invalidateSoul, postSync, role, signAndExecute, soul.activeGrants, soul.contentOnChainId, soul.stateOnChainId, suiClient, suiWallet])

  const deleteContentVersion = useCallback(async (version: SoulContentVersionRecord) => {
    if (role !== 'owner' && role !== 'grantee') {
      throw new Error('Only the Soul owner or a scoped grantee can delete content')
    }
    if (!suiWallet) throw new Error('Connect a Sui wallet before deleting content')
    if (!soul.contentOnChainId) throw new Error('Soul content root is not available')
    const grant = role === 'grantee'
      ? findGrantForWallet(soul.activeGrants, suiWallet.address, version.kind)
      : null
    if (role === 'grantee' && !grant?.onChainId) {
      throw new Error('No active grant covers this content kind')
    }

    setPendingAction('delete')
    setContentActionError(null)
    try {
      await assertObjectInputsExist(suiClient, {
        'Soul content': soul.contentOnChainId,
        'Soul state': soul.stateOnChainId,
      })
      const common = {
        contentObjectId: soul.contentOnChainId,
        stateObjectId: soul.stateOnChainId,
        kindRegistryObjectId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID'),
        kind: version.kind,
        name: version.name,
        versionIndex: version.versionIndex,
      }
      const tx = role === 'grantee'
        ? buildDeleteContentVersionAsGrantedAgentTx({ ...common, soulGrantObjectId: grant!.onChainId })
        : buildDeleteContentVersionAsOwnerTx(common)
      const result = await signAndExecute(tx)
      await postSync({
        action: 'delete',
        txDigest: result.digest,
        kind: version.kind,
        name: version.name,
        versionIndex: version.versionIndex,
      })
      invalidateSoul()
    } catch (error) {
      setContentActionError(error instanceof Error ? error.message : 'Failed to delete content')
      throw error
    } finally {
      setPendingAction(null)
    }
  }, [invalidateSoul, postSync, role, signAndExecute, soul.activeGrants, soul.contentOnChainId, soul.stateOnChainId, suiClient, suiWallet])

  const purgeContentVersion = useCallback(async (version: SoulContentVersionRecord) => {
    if (role !== 'owner') throw new Error('Only the Soul owner can purge deleted content')
    if (!suiWallet) throw new Error('Connect a Sui wallet before purging content')
    if (!soul.contentOnChainId) throw new Error('Soul content root is not available')
    setPendingAction('purge')
    setContentActionError(null)
    try {
      await assertObjectInputsExist(suiClient, {
        'Soul content': soul.contentOnChainId,
        'Soul state': soul.stateOnChainId,
      })
      const tx = buildPurgeContentVersionAsOwnerTx({
        contentObjectId: soul.contentOnChainId,
        stateObjectId: soul.stateOnChainId,
        kindRegistryObjectId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID'),
        kind: version.kind,
        name: version.name,
        versionIndex: version.versionIndex,
      })
      const result = await signAndExecute(tx)
      await postSync({
        action: 'purge',
        txDigest: result.digest,
        kind: version.kind,
        name: version.name,
        versionIndex: version.versionIndex,
      })
      invalidateSoul()
    } catch (error) {
      setContentActionError(error instanceof Error ? error.message : 'Failed to purge content')
      throw error
    } finally {
      setPendingAction(null)
    }
  }, [invalidateSoul, postSync, role, signAndExecute, soul.contentOnChainId, soul.stateOnChainId, suiClient, suiWallet])

  const getContentAccess = useCallback(async (version: SoulContentVersionRecord): Promise<ContentAccessResponse> => {
    const authHeaders = await getAuthHeaders()
    const response = await fetch(
      `/api/souls/${encodeURIComponent(soul.onChainId)}/content/${encodeURIComponent(String(version.kind))}/${encodeURIComponent(version.name)}/${version.versionIndex}/access`,
      { cache: 'no-store', headers: authHeaders },
    )
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.error ?? 'Failed to prepare content access')
    }
    return response.json()
  }, [getAuthHeaders, soul.onChainId])

  const decryptContentVersion = useCallback(async (version: SoulContentVersionRecord): Promise<Uint8Array> => {
    if (!suiWallet) throw new Error('Connect a Sui wallet before decrypting content')
    setPendingAction('open')
    setContentActionError(null)
    try {
      const access = await getContentAccess(version)
      if (access.visibility === 'public-plaintext') {
        if (!access.artifact.walrusBlobUrl) throw new Error('Walrus URL is missing')
        return fetchBytes(access.artifact.walrusBlobUrl)
      }
      if (!access.artifact.walrusBlobUrl) throw new Error('Walrus URL is missing')

      const encryptedData = await fetchBytes(access.artifact.walrusBlobUrl)
      const { sealClient } = createBrowserSealClient(suiClient)
      const sessionKey = await SessionKey.create({
        address: access.viewerAddress || suiWallet.address,
        packageId: access.accessPolicy.packageId,
        ttlMin: access.sessionTtlMin,
        suiClient: suiClient as never,
      })
      const signature = await signPersonalMessage(sessionKey.getPersonalMessage())
      await sessionKey.setPersonalMessageSignature(signature)
      const txBytes = await buildContentSealApprovalTx(access).build({
        client: suiClient as never,
        onlyTransactionKind: true,
      })
      const keyMaterial = new Uint8Array(
        await sealClient.decrypt({
          data: base64ToBytes(access.sealSidecar.encryptedDek),
          sessionKey,
          txBytes,
        }),
      )
      try {
        return await decryptCiphertext({
          encryptedData,
          keyMaterial,
          sidecar: access.sealSidecar,
        })
      } finally {
        keyMaterial.fill(0)
      }
    } catch (error) {
      setContentActionError(error instanceof Error ? error.message : 'Failed to open content')
      throw error
    } finally {
      setPendingAction(null)
    }
  }, [getContentAccess, signPersonalMessage, suiClient, suiWallet])

  const openContentVersion = useCallback(async (version: SoulContentVersionRecord) => {
    setPendingAction('open')
    setContentActionError(null)
    try {
      const access = await getContentAccess(version)
      if (access.visibility === 'public-plaintext') {
        if (!access.artifact.walrusBlobUrl) throw new Error('Walrus URL is missing')
        window.open(access.artifact.walrusBlobUrl, '_blank', 'noopener,noreferrer')
        return
      }
      const bytes = await decryptContentVersion(version)
      downloadBytes(bytes, access.sealSidecar.fileName, access.sealSidecar.mimeType)
    } catch (error) {
      setContentActionError(error instanceof Error ? error.message : 'Failed to open content')
      throw error
    } finally {
      setPendingAction(null)
    }
  }, [decryptContentVersion, getContentAccess])

  return {
    pendingAction,
    contentActionError,
    defaultSlotReadModeFor,
    appendContentVersion,
    openContentVersion,
    decryptContentVersion,
    deleteContentVersion,
    purgeContentVersion,
    setActiveContent,
    clearActiveContent,
    canUseContentActions: role === 'owner' || role === 'grantee',
    canonicalMemoryName: CANONICAL_MEMORY_NAME,
    noDownloadPolicy: NO_DOWNLOAD_POLICY,
  }
}
