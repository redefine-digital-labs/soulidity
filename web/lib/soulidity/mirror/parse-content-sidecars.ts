/**
 * Parse the `contentSidecars[]` request body field into a lookup map keyed by
 * `(kind, name, versionIndex)`. Used by Phase 2 mint-mirror routes to pair
 * client-supplied Seal sidecars with on-chain `ContentVersionAppended` events.
 *
 * The client sends:
 *   { kind: number, name: string, versionIndex: number, sidecar: SealEnvelopeSidecar | null }
 *
 * Pure-public slots send `sidecar: null`; sealed slots send the parsed
 * envelope. The route re-validates the sidecar against the slot's
 * `sealEncrypted` flag via `buildSyncSealSidecars`.
 */
import { SealSidecarRequestError, parseProvidedSidecar } from '@/lib/soulidity/mirror/provided-sidecar'
import type { SealEnvelopeSidecar } from '@soulidity/sdk'

export interface ContentSidecarRequestEntry {
  kind: number
  name: string
  versionIndex: number
  sidecar: SealEnvelopeSidecar | null
}

export type ContentSidecarMap = Map<string, SealEnvelopeSidecar | null>

function sidecarKey(kind: number, name: string, versionIndex: number) {
  return `${kind}::${name}::${versionIndex}`
}

export function parseContentSidecars(value: unknown, fieldName: string): ContentSidecarMap {
  const out: ContentSidecarMap = new Map()
  if (value == null) {
    return out
  }
  if (!Array.isArray(value)) {
    throw new SealSidecarRequestError(`${fieldName} must be an array of content sidecar entries`)
  }
  for (let i = 0; i < value.length; i++) {
    const item = value[i] as Record<string, unknown> | null
    if (!item || typeof item !== 'object') {
      throw new SealSidecarRequestError(`${fieldName}[${i}] must be an object`)
    }
    if (typeof item.kind !== 'number' || !Number.isInteger(item.kind) || item.kind < 0) {
      throw new SealSidecarRequestError(`${fieldName}[${i}].kind must be a non-negative integer`)
    }
    if (typeof item.name !== 'string' || item.name.length === 0) {
      throw new SealSidecarRequestError(`${fieldName}[${i}].name must be a non-empty string`)
    }
    if (typeof item.versionIndex !== 'number' || !Number.isInteger(item.versionIndex) || item.versionIndex < 0) {
      throw new SealSidecarRequestError(
        `${fieldName}[${i}].versionIndex must be a non-negative integer`,
      )
    }
    const sidecar = parseProvidedSidecar(item.sidecar, `${fieldName}[${i}].sidecar`)
    const key = sidecarKey(item.kind, item.name, item.versionIndex)
    if (out.has(key)) {
      throw new SealSidecarRequestError(
        `${fieldName} contains a duplicate (kind=${item.kind}, name=${item.name}, versionIndex=${item.versionIndex}) entry`,
      )
    }
    out.set(key, sidecar)
  }
  return out
}
