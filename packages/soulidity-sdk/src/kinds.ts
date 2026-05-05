/**
 * Kind / op / read-mode constants mirroring `move/soulidity/sources/kind_registry.move`.
 * These values are baked into the protocol — every TS caller MUST import from here
 * rather than redefining numeric literals.
 */
import {
  SOUL_GRANT_SCOPE_ASSETS,
  SOUL_GRANT_SCOPE_MEMORY,
  SOUL_GRANT_SCOPE_SEAL,
  SOUL_GRANT_SCOPE_SKILLS,
} from './grant-scopes'
import type { SoulDownloadPolicy } from './types'

// ── Kind ids (mirrors `kind_registry.move` constants) ────────────────────
export const KIND_SOUL_DOC = 0
export const KIND_MEMORY = 1
export const KIND_SKILL = 2
export const KIND_SPRITE = 3
export const KIND_AUDIO = 4
export const FIRST_CUSTOM_KIND = 16

export type KindId = number
export type BuiltinKindId =
  | typeof KIND_SOUL_DOC
  | typeof KIND_MEMORY
  | typeof KIND_SKILL
  | typeof KIND_SPRITE
  | typeof KIND_AUDIO

// ── op_mask bits ─────────────────────────────────────────────────────────
export const OP_APPEND = 1 << 0
export const OP_DELETE = 1 << 1
export const OP_PURGE = 1 << 2
export const OP_ACTIVE_BIND = 1 << 3
export const ALL_OPS = OP_APPEND | OP_DELETE | OP_PURGE | OP_ACTIVE_BIND

// ── read_mode_mask bits ──────────────────────────────────────────────────
export const READ_OWNER = 1 << 0
export const READ_GRANT = 1 << 1
export const READ_PAID = 1 << 2
export const READ_PUBLIC = 1 << 3
export const ALL_READ_MODES = READ_OWNER | READ_GRANT | READ_PAID | READ_PUBLIC

// ── Canonical slot names ─────────────────────────────────────────────────
//
// Enforced inside `content.move` for the two invariant kinds; the protocol
// rejects any other slot name for these kinds via `EMemoryNameMismatch`
// / `ESoulDocNameMismatch`.
export const CANONICAL_SOUL_DOC_NAME = 'soul'
export const CANONICAL_MEMORY_NAME = 'default'

// ── Download policy numeric encoding (mirrors `content.move`) ────────────
export const DOWNLOAD_POLICY_PUBLIC = 0
export const DOWNLOAD_POLICY_OWNER_ONLY = 1
export const DOWNLOAD_POLICY_ALLOWLIST = 2

// `content.move` requires policy byte 0 for descriptors with
// `requires_download_policy=false`. The policy-enabled enum names byte 0
// `public`; this alias documents the no-policy use at call sites.
export const NO_DOWNLOAD_POLICY: SoulDownloadPolicy = 'public'

export function downloadPolicyToU8(policy: SoulDownloadPolicy): number {
  switch (policy) {
    case 'public': return DOWNLOAD_POLICY_PUBLIC
    case 'owner_only': return DOWNLOAD_POLICY_OWNER_ONLY
    case 'allowlist': return DOWNLOAD_POLICY_ALLOWLIST
  }
}

export function downloadPolicyFromU8(value: number): SoulDownloadPolicy {
  switch (value) {
    case DOWNLOAD_POLICY_PUBLIC: return 'public'
    case DOWNLOAD_POLICY_OWNER_ONLY: return 'owner_only'
    case DOWNLOAD_POLICY_ALLOWLIST: return 'allowlist'
    default: throw new Error(`unknown download_policy value ${value}`)
  }
}

// ── KindDescriptor mirror (server-side cache; on-chain remains source of truth) ─
export interface KindDescriptor {
  kind: KindId
  name: string
  opMask: number
  readModeMask: number
  hasActiveBinding: boolean
  requiresDownloadPolicy: boolean
  defaultGrantScopeMask: number
  deprecated: boolean
}

// Mirror of the five built-in descriptors registered in `kind_registry::init`.
// Custom kinds added by the admin via `register_kind` are not listed here —
// callers must look them up from a live KindRegistry projection.
export const BUILTIN_KIND_DESCRIPTORS: ReadonlyArray<KindDescriptor> = [
  {
    kind: KIND_SOUL_DOC,
    name: 'soul_doc',
    opMask: 0,
    readModeMask: READ_OWNER | READ_GRANT,
    hasActiveBinding: false,
    requiresDownloadPolicy: false,
    defaultGrantScopeMask: SOUL_GRANT_SCOPE_SEAL,
    deprecated: false,
  },
  {
    kind: KIND_MEMORY,
    name: 'memory',
    opMask: OP_APPEND | OP_DELETE | OP_PURGE,
    readModeMask: READ_OWNER | READ_GRANT,
    hasActiveBinding: false,
    requiresDownloadPolicy: false,
    defaultGrantScopeMask: SOUL_GRANT_SCOPE_MEMORY,
    deprecated: false,
  },
  {
    kind: KIND_SKILL,
    name: 'skill',
    opMask: OP_APPEND | OP_DELETE | OP_PURGE,
    readModeMask: READ_OWNER | READ_GRANT,
    hasActiveBinding: false,
    requiresDownloadPolicy: false,
    defaultGrantScopeMask: SOUL_GRANT_SCOPE_SKILLS,
    deprecated: false,
  },
  {
    kind: KIND_SPRITE,
    name: 'sprite',
    opMask: OP_APPEND | OP_DELETE | OP_PURGE | OP_ACTIVE_BIND,
    readModeMask: READ_OWNER | READ_GRANT | READ_PAID | READ_PUBLIC,
    hasActiveBinding: true,
    requiresDownloadPolicy: true,
    defaultGrantScopeMask: SOUL_GRANT_SCOPE_ASSETS,
    deprecated: false,
  },
  {
    kind: KIND_AUDIO,
    name: 'audio',
    opMask: OP_APPEND | OP_DELETE | OP_PURGE | OP_ACTIVE_BIND,
    readModeMask: READ_OWNER | READ_GRANT | READ_PAID | READ_PUBLIC,
    hasActiveBinding: true,
    requiresDownloadPolicy: true,
    defaultGrantScopeMask: SOUL_GRANT_SCOPE_ASSETS,
    deprecated: false,
  },
]

const BUILTIN_BY_KIND = new Map<number, KindDescriptor>(
  BUILTIN_KIND_DESCRIPTORS.map((d) => [d.kind, d]),
)
const BUILTIN_BY_NAME = new Map<string, KindDescriptor>(
  BUILTIN_KIND_DESCRIPTORS.map((d) => [d.name, d]),
)

export function getBuiltinKindDescriptor(kind: KindId): KindDescriptor | null {
  return BUILTIN_BY_KIND.get(kind) ?? null
}

export function getBuiltinKindIdForName(name: string): KindId | null {
  return BUILTIN_BY_NAME.get(name)?.kind ?? null
}

export function isBuiltinKind(kind: KindId): boolean {
  return BUILTIN_BY_KIND.has(kind)
}

export function builtinKindName(kind: KindId): string | null {
  return BUILTIN_BY_KIND.get(kind)?.name ?? null
}

// ── Read-mode helpers ────────────────────────────────────────────────────
export function readModeMaskToList(
  mask: number,
): Array<'owner' | 'grant' | 'paid' | 'public'> {
  const list: Array<'owner' | 'grant' | 'paid' | 'public'> = []
  if (mask & READ_OWNER) list.push('owner')
  if (mask & READ_GRANT) list.push('grant')
  if (mask & READ_PAID) list.push('paid')
  if (mask & READ_PUBLIC) list.push('public')
  return list
}

export function listToReadModeMask(
  modes: ReadonlyArray<'owner' | 'grant' | 'paid' | 'public'>,
): number {
  let mask = 0
  for (const mode of modes) {
    switch (mode) {
      case 'owner': mask |= READ_OWNER; break
      case 'grant': mask |= READ_GRANT; break
      case 'paid': mask |= READ_PAID; break
      case 'public': mask |= READ_PUBLIC; break
    }
  }
  return mask
}

// ── Op helpers ───────────────────────────────────────────────────────────
export function opMaskToList(
  mask: number,
): Array<'append' | 'delete' | 'purge' | 'active_bind'> {
  const list: Array<'append' | 'delete' | 'purge' | 'active_bind'> = []
  if (mask & OP_APPEND) list.push('append')
  if (mask & OP_DELETE) list.push('delete')
  if (mask & OP_PURGE) list.push('purge')
  if (mask & OP_ACTIVE_BIND) list.push('active_bind')
  return list
}

// ── Slot-shape validation (mirrors `content.move::append_version_impl` checks) ─
export interface SlotReadModeShape {
  /** The slot's `read_mode_mask` chosen at append time. */
  readModeMask: number
  /** The kind's descriptor `read_mode_mask` (the upper bound the slot must be a subset of). */
  kindReadModeMask: number
  /** The slot's `download_policy` chosen at append time. */
  downloadPolicy: SoulDownloadPolicy
}

/**
 * Mirror the protocol's `assert_slot_read_mode_allowed` + `EOwnerReadModeRequired`
 * checks. Throws if the requested slot read mode is not a subset of the kind
 * descriptor or violates the OWNER / PUBLIC invariants.
 */
export function assertSlotReadModeAllowed(shape: SlotReadModeShape): void {
  const { readModeMask, kindReadModeMask, downloadPolicy } = shape
  if (readModeMask === 0) {
    throw new Error('slot read_mode_mask must be non-zero')
  }
  if ((readModeMask & READ_OWNER) === 0) {
    throw new Error('slot read_mode_mask must include READ_OWNER')
  }
  if ((readModeMask & kindReadModeMask) !== readModeMask) {
    throw new Error('slot read_mode_mask must be a subset of the kind descriptor')
  }
  if ((readModeMask & READ_PUBLIC) !== 0 && downloadPolicy !== 'public') {
    throw new Error('slot read_mode_mask includes PUBLIC but download_policy is not public')
  }
}
