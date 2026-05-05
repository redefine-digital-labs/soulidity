/**
 * Phase 2 unified content access resolver. Replaces the legacy
 * `resolveSoulAccessPayload` / `resolveMemoryAccessPayload` /
 * `resolveSkillAccessPayload` / `resolveAssetAccessPayload` quartet with a
 * single function that handles every kind by reading the slot's cached
 * `read_mode_mask` and `grant_scope_mask`.
 *
 * Authorization order:
 *   1. owner — if viewer == SoulState.current_owner AND slot.read_mode_mask includes READ_OWNER.
 *   2. granted agent — if viewer has an active SoulGrant whose scope matches slot.grant_scope_mask
 *      AND slot.read_mode_mask includes READ_GRANT.
 *   3. paid — if viewer has an unrevoked, non-stale, non-expired SoulPaidAccessEntry
 *      for slot.kind whose scope matches slot.grant_scope_mask AND slot.read_mode_mask includes READ_PAID.
 *   4. public — if slot.read_mode_mask includes READ_PUBLIC. Returns either a plaintext
 *      Walrus URL (when slot.downloadPolicy=public AND slot.sealEncrypted=false) or a
 *      Seal-gated session pointing at `seal_approve_content_public` (when sealEncrypted=true).
 *
 * Returns the canonical `ContentAccessResponse` envelope; callers (HTTP routes)
 * forward it to the client which uses it to construct a Seal SessionKey or to
 * fetch the plaintext URL directly.
 */
import { prisma } from '@/lib/prisma'
import { getBlobUrl } from '@soulidity/sdk'
import { getSealRuntimeConfig, getSealSessionTtlMinutes } from '@/lib/services/seal'
import {
  CANONICAL_MEMORY_NAME,
  CANONICAL_SOUL_DOC_NAME,
  KIND_MEMORY,
  KIND_SOUL_DOC,
  READ_GRANT,
  READ_OWNER,
  READ_PAID,
  READ_PUBLIC,
} from '@soulidity/sdk'
import {
  findActiveGrantSlotForViewer,
  getSoulGrantObject,
  getSoulStateObject,
  normalizeSuiValue,
  sameSuiValue,
} from '@soulidity/sdk'
import type {
  ContentAccessKind,
  ContentAccessResponse,
  ContentSlotDescriptor,
  SoulAssetSummary,
  SoulContentVersionRecord,
  SoulDownloadPolicy,
} from '@soulidity/sdk'

export class ContentAccessDeniedError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message)
    this.name = 'ContentAccessDeniedError'
  }
}

interface ResolveContentAccessParams {
  soul: Pick<SoulAssetSummary, 'onChainId' | 'stateOnChainId' | 'contentOnChainId' | 'paidAccessListOnChainId'>
  version: SoulContentVersionRecord
  viewerAddresses: string[]
  packageId: string
}

function buildSlotDescriptor(version: SoulContentVersionRecord): ContentSlotDescriptor {
  return {
    kind: version.kind,
    kindName: version.kindName,
    name: version.name,
    versionIndex: version.versionIndex,
    readModeMask: version.readModeMask,
    opMask: version.opMask,
    grantScopeMask: version.grantScopeMask,
    isPublic: version.isPublic,
    sealEncrypted: version.sealEncrypted,
    downloadPolicy: version.downloadPolicy,
    deletedAt: version.deletedAt,
    purgedAt: version.purgedAt,
  }
}

function blobArtifact(version: SoulContentVersionRecord) {
  return {
    walrusBlobUrl: version.blobId ? getBlobUrl(version.blobId) : null,
    walrusBlobId: version.blobId,
    blobObjectId: version.blobObjectId,
  }
}

function ensureSlotReadable(version: SoulContentVersionRecord) {
  if (version.deletedAt != null) {
    throw new ContentAccessDeniedError('Content version was deleted', 410)
  }
  if (version.purgedAt != null) {
    throw new ContentAccessDeniedError('Content version was purged', 410)
  }
}

function ensureCanonicalName(version: SoulContentVersionRecord) {
  if (version.kind === KIND_SOUL_DOC && version.name !== CANONICAL_SOUL_DOC_NAME) {
    throw new ContentAccessDeniedError(`SOUL_DOC slot name must be "${CANONICAL_SOUL_DOC_NAME}"`, 400)
  }
  if (version.kind === KIND_MEMORY && version.name !== CANONICAL_MEMORY_NAME) {
    throw new ContentAccessDeniedError(`MEMORY slot name must be "${CANONICAL_MEMORY_NAME}"`, 400)
  }
}

function ensureSidecarPresent(version: SoulContentVersionRecord) {
  if (version.sealEncrypted && !version.sealSidecar) {
    throw new ContentAccessDeniedError('Seal sidecar is missing for encrypted slot', 409)
  }
}

function buildSealedResponse(params: {
  contentObjectId: string
  stateObjectId: string
  version: SoulContentVersionRecord
  packageId: string
  resolvedPackageId: string
  moduleName: 'content' | 'paid_access'
  functionName:
    | 'seal_approve_content_owner'
    | 'seal_approve_content_granted_agent'
    | 'seal_approve_content_paid_access'
    | 'seal_approve_content_public'
  soulGrantObjectId: string | null
  paidAccessListOnChainId: string | null
  viewerAddress: string
  accessKind: ContentAccessKind
}): ContentAccessResponse {
  if (!params.version.sealSidecar) {
    throw new ContentAccessDeniedError('Seal sidecar is missing for encrypted slot', 409)
  }
  return {
    visibility: 'sealed',
    slot: buildSlotDescriptor(params.version),
    artifact: blobArtifact(params.version),
    accessPolicy: {
      packageId: params.resolvedPackageId,
      stateObjectId: params.stateObjectId,
      contentObjectId: params.contentObjectId,
      kind: params.version.kind,
      name: params.version.name,
      versionIndex: params.version.versionIndex,
      moduleName: params.moduleName,
      functionName: params.functionName,
      soulGrantObjectId: params.soulGrantObjectId,
      paidAccessListOnChainId: params.paidAccessListOnChainId,
      documentIdHex: params.version.sealSidecar.documentId,
    },
    seal: getSealRuntimeConfig(),
    sealSidecar: params.version.sealSidecar,
    viewerAddress: params.viewerAddress,
    accessKind: params.accessKind,
    sessionTtlMin: getSealSessionTtlMinutes(),
  }
}

function buildPublicPlaintextResponse(version: SoulContentVersionRecord): ContentAccessResponse {
  return {
    visibility: 'public-plaintext',
    slot: buildSlotDescriptor(version),
    artifact: blobArtifact(version),
  }
}

async function checkPaidAccessEntry(params: {
  paidAccessListOnChainId: string | null
  buyerAddress: string
  kind: number
  ownershipEpoch: number
  slotScopeMask: number
}): Promise<boolean> {
  if (!params.paidAccessListOnChainId) return false
  const entry = await prisma.soulPaidAccessEntry.findFirst({
    where: {
      paidAccessListOnChainId: params.paidAccessListOnChainId,
      buyerAddress: params.buyerAddress,
      kind: params.kind,
      revokedAt: null,
      ownershipEpochSnapshot: params.ownershipEpoch,
    },
  })
  if (!entry) return false
  if ((entry.scopeMask & params.slotScopeMask) !== params.slotScopeMask) return false
  if (entry.expiresAtMs != null && BigInt(entry.expiresAtMs) < BigInt(Date.now())) return false
  return true
}

/**
 * Resolve the content access envelope for a single content version. Throws
 * `ContentAccessDeniedError` when no authorization channel is available.
 *
 * The caller (HTTP route) is responsible for: (1) loading the
 * `SoulContentVersionRecord` from the mirror DB, (2) confirming the soul
 * exists and is current-package, and (3) forwarding the response to the
 * client (which constructs the Seal SessionKey for sealed responses).
 */
export async function resolveContentAccessPayload(
  params: ResolveContentAccessParams,
): Promise<ContentAccessResponse> {
  const { soul, version, viewerAddresses: rawViewers, packageId } = params

  ensureSlotReadable(version)
  ensureCanonicalName(version)

  if (!soul.contentOnChainId) {
    throw new ContentAccessDeniedError('Soul content root is not available', 409)
  }

  const viewerAddresses = rawViewers
    .map((address) => normalizeSuiValue(address))
    .filter((value): value is string => value != null)

  const state = await getSoulStateObject(soul.stateOnChainId, packageId, {
    includeActiveGrants: false,
  })
  const resolvedPackageId = state.packageId ?? packageId

  // ── 1. Owner check ───────────────────────────────────────────────────
  if (version.readModeMask & READ_OWNER) {
    const ownerMatch = viewerAddresses.find((address) =>
      sameSuiValue(address, state.currentOwnerAddress),
    )
    if (ownerMatch) {
      ensureSidecarPresent(version)
      return buildSealedResponse({
        contentObjectId: soul.contentOnChainId,
        stateObjectId: soul.stateOnChainId,
        version,
        packageId,
        resolvedPackageId,
        moduleName: 'content',
        functionName: 'seal_approve_content_owner',
        soulGrantObjectId: null,
        paidAccessListOnChainId: null,
        viewerAddress: ownerMatch,
        accessKind: 'owner',
      })
    }
  }

  // ── 2. Granted-agent check ───────────────────────────────────────────
  if (version.readModeMask & READ_GRANT && version.grantScopeMask !== 0) {
    const stateForGrants = await getSoulStateObject(soul.stateOnChainId, packageId, {
      includeActiveGrants: true,
    })
    const slot = await findActiveGrantSlotForViewer({
      state: stateForGrants,
      viewerAddresses,
      scopeMask: version.grantScopeMask,
    })
    if (slot) {
      const granteeMatch = viewerAddresses.find((address) =>
        sameSuiValue(address, slot.granteeAddress),
      )
      if (granteeMatch) {
        const grant = await getSoulGrantObject(slot.grantId, resolvedPackageId)
        if (
          grant.ownershipEpochSnapshot === stateForGrants.ownershipEpoch
          && sameSuiValue(grant.granteeAddress, granteeMatch)
          && (grant.expiresAtMs == null || grant.expiresAtMs >= Date.now())
          && (grant.scopeMask & version.grantScopeMask) === version.grantScopeMask
        ) {
          ensureSidecarPresent(version)
          return buildSealedResponse({
            contentObjectId: soul.contentOnChainId,
            stateObjectId: soul.stateOnChainId,
            version,
            packageId,
            resolvedPackageId,
            moduleName: 'content',
            functionName: 'seal_approve_content_granted_agent',
            soulGrantObjectId: grant.objectId,
            paidAccessListOnChainId: null,
            viewerAddress: granteeMatch,
            accessKind: 'granted-agent',
          })
        }
      }
    }
  }

  // ── 3. Paid-access check ─────────────────────────────────────────────
  if (
    version.readModeMask & READ_PAID
    && version.grantScopeMask !== 0
    && soul.paidAccessListOnChainId
  ) {
    for (const buyer of viewerAddresses) {
      const ok = await checkPaidAccessEntry({
        paidAccessListOnChainId: soul.paidAccessListOnChainId,
        buyerAddress: buyer,
        kind: version.kind,
        ownershipEpoch: state.ownershipEpoch,
        slotScopeMask: version.grantScopeMask,
      })
      if (ok) {
        ensureSidecarPresent(version)
        return buildSealedResponse({
          contentObjectId: soul.contentOnChainId,
          stateObjectId: soul.stateOnChainId,
          version,
          packageId,
          resolvedPackageId,
          moduleName: 'paid_access',
          functionName: 'seal_approve_content_paid_access',
          soulGrantObjectId: null,
          paidAccessListOnChainId: soul.paidAccessListOnChainId,
          viewerAddress: buyer,
          accessKind: 'paid',
        })
      }
    }
  }

  // ── 4. Public check ──────────────────────────────────────────────────
  if (version.readModeMask & READ_PUBLIC) {
    if (version.sealEncrypted) {
      // Public + Seal-encrypted: caller must construct a Seal session.
      // Use the first viewer address (or empty string when anonymous).
      const viewerAddress = viewerAddresses[0] ?? ''
      return buildSealedResponse({
        contentObjectId: soul.contentOnChainId,
        stateObjectId: soul.stateOnChainId,
        version,
        packageId,
        resolvedPackageId,
        moduleName: 'content',
        functionName: 'seal_approve_content_public',
        soulGrantObjectId: null,
        paidAccessListOnChainId: null,
        viewerAddress,
        accessKind: 'public',
      })
    }
    if ((version.downloadPolicy as SoulDownloadPolicy) === 'public') {
      return buildPublicPlaintextResponse(version)
    }
  }

  throw new ContentAccessDeniedError(
    'No authorization channel for this content version',
    403,
  )
}
