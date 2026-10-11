/**
 * Phase 2 unified Seal sidecar gate. Replaces the legacy four-channel
 * (soul/memory/skill/asset) sidecar verification with a single
 * content-version sidecar map keyed by `(kind, name, versionIndex)`.
 *
 * The sidecar's `documentId` MUST match the canonical id derived from
 * the `(contentObjectId, kind, name, versionIndex)` tuple plus the
 * caller-supplied 16-byte nonce. Phase 2 `seal_approve_content_*` entries
 * verify the same id layout in `assert_matching_document_id`.
 *
 * Pure-PUBLIC slots (read_mode_mask == READ_PUBLIC only) MUST NOT carry
 * a sidecar — they're served plaintext via Walrus URL. Mint/append code
 * rejects pure-PUBLIC slots at the Move layer (`EOwnerReadModeRequired`),
 * but a defensive check is kept here for any caller passing
 * `sealEncrypted=false`.
 */
import { parseSealEnvelopeSidecar } from '@/lib/services/seal-crypto'
import { isContentDocumentIdForVersion, type SealEnvelopeSidecar } from '@soulidity/sdk'

export class SealSidecarSyncConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SealSidecarSyncConfigError'
  }
}

export interface ContentSidecarInput {
  /** `ContentSlot.kind` from the on-chain projection. */
  kind: number
  /** `ContentSlot.name` (canonical for invariant kinds). */
  name: string
  /** `ContentSlot.version_index`. */
  versionIndex: number
  /** Whether the slot's blob is Seal-encrypted. */
  sealEncrypted: boolean
  /** Caller-provided sidecar JSON; required for sealed slots, must be null otherwise. */
  sidecar?: SealEnvelopeSidecar | null
}

export interface ContentSidecarRecord extends ContentSidecarInput {
  /** Validated sidecar (or null for plaintext slots). */
  validatedSidecar: SealEnvelopeSidecar | null
}

export interface BuildSyncSealSidecarsInput {
  /**
   * `SoulContent` object id of the soul. Required so the parsed sidecar's
   * documentId can be checked against the (contentObjectId, kind, name,
   * version) layout enforced by the Move layer.
   */
  contentObjectId: string
  /** One row per content version that this sync should mirror. */
  entries: ReadonlyArray<ContentSidecarInput>
}

export interface BuildSyncSealSidecarsOutput {
  /**
   * Validated sidecars in the same order as the input `entries`. Pure-PUBLIC
   * slots return `validatedSidecar: null`; sealed slots carry the parsed
   * envelope (kept by the post-tx mirror writer for storage in
   * `SoulContentVersionRecord.sealSidecar`).
   */
  validatedEntries: ContentSidecarRecord[]
}

export function buildSyncSealSidecars(
  input: BuildSyncSealSidecarsInput,
): BuildSyncSealSidecarsOutput {
  const validatedEntries: ContentSidecarRecord[] = input.entries.map((entry) => {
    let provided: SealEnvelopeSidecar | null = null
    if (entry.sidecar) {
      try {
        provided = parseSealEnvelopeSidecar(entry.sidecar)
      } catch (error) {
        throw new SealSidecarSyncConfigError(
          error instanceof Error ? error.message : 'content sidecar is malformed',
        )
      }
    }

    if (entry.sealEncrypted) {
      if (!provided) {
        throw new SealSidecarSyncConfigError(
          `content version (kind=${entry.kind}, name=${entry.name}, version=${entry.versionIndex}) is sealEncrypted but no sidecar was provided`,
        )
      }
      if (!isContentDocumentIdForVersion(provided.documentId, {
        contentObjectId: input.contentObjectId,
        kind: entry.kind,
        name: entry.name,
        versionIndex: entry.versionIndex,
      })) {
        throw new SealSidecarSyncConfigError(
          `content sidecar documentId does not match content version (kind=${entry.kind}, name=${entry.name}, version=${entry.versionIndex})`,
        )
      }
      return {
        ...entry,
        validatedSidecar: provided,
      }
    }

    if (provided) {
      throw new SealSidecarSyncConfigError(
        `content version (kind=${entry.kind}, name=${entry.name}, version=${entry.versionIndex}) is plaintext but a sidecar was provided`,
      )
    }
    return { ...entry, validatedSidecar: null }
  })

  return { validatedEntries }
}
