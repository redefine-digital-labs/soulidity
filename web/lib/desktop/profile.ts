import type { Prisma } from '@db/prisma-client'
import { prisma } from '@/lib/prisma'
import { findDesktopPersonaManifestBySource } from '@/lib/desktop/repository'
import type {
  DesktopCatalogSourceType,
  DesktopMeResponse,
  DesktopProfile,
} from '@/lib/types/desktop'

// T4: Active-source state lives on `DesktopPet` (per-pet), not on the
// account-level `DesktopProfile` row. The DesktopProfile row continues to
// own only `preferences` for the human account; the pet row owns
// `agentAddress`, `activeSourceType`, `activeSourceRef`, and `lastSyncedAt`.
// Callers must always pass the caller's `desktopPetId` (resolved from the
// `dtk_*` token via `requireDesktopIdentity`).

const desktopProfileSelect = {
  accountId: true,
  preferences: true,
  updatedAt: true,
} as const

const desktopPetSelect = {
  id: true,
  accountId: true,
  agentAddress: true,
  activeSourceType: true,
  activeSourceRef: true,
  lastSyncedAt: true,
} as const

type DesktopProfileRow = Prisma.DesktopProfileGetPayload<{ select: typeof desktopProfileSelect }>
type DesktopPetRow = Prisma.DesktopPetGetPayload<{ select: typeof desktopPetSelect }>

const SENSITIVE_PREFERENCE_KEYS = new Set([
  'desktopAccessTokenPending',
  'desktopAccessTokenHash',
  'desktopAccessTokenIssuedAt',
  'desktopAccessTokenSessionId',
])

function normalizeDesktopPreferences(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const raw = value as Record<string, unknown>
  const sanitized: Record<string, unknown> = {}
  for (const key of Object.keys(raw)) {
    if (!SENSITIVE_PREFERENCE_KEYS.has(key)) {
      sanitized[key] = raw[key]
    }
  }
  return sanitized
}

async function resolvePrimarySuiAddress(accountId: string): Promise<string | null> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      members: {
        where: { kind: 'human' },
        orderBy: { joinedAt: 'asc' },
        take: 1,
        select: {
          walletBindings: {
            where: { chain: 'sui' },
            orderBy: [
              { isPrimary: 'desc' },
              { createdAt: 'asc' },
              { id: 'asc' },
            ],
            take: 1,
            select: { address: true },
          },
        },
      },
    },
  })

  return account?.members[0]?.walletBindings[0]?.address ?? null
}

function toDesktopProfile(
  row: DesktopProfileRow,
  pet: DesktopPetRow,
  primarySuiAddress: string | null,
): DesktopProfile {
  const activeSourceType =
    pet.activeSourceType === 'starter' || pet.activeSourceType === 'soul'
      ? (pet.activeSourceType as DesktopCatalogSourceType)
      : null

  return {
    accountId: row.accountId,
    agentAddress: pet.agentAddress,
    primarySuiAddress,
    activeSourceType,
    activeSourceRef: pet.activeSourceRef,
    preferences: normalizeDesktopPreferences(row.preferences),
    lastSyncedAt: pet.lastSyncedAt ? pet.lastSyncedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export class DesktopActivePersonaNotFoundError extends Error {
  constructor(message = 'Desktop active persona was not found') {
    super(message)
    this.name = 'DesktopActivePersonaNotFoundError'
  }
}

export class DesktopPetNotFoundError extends Error {
  constructor(message = 'Desktop pet not found for this account') {
    super(message)
    this.name = 'DesktopPetNotFoundError'
  }
}

async function ensureDesktopProfile(accountId: string): Promise<DesktopProfileRow> {
  const existing = await prisma.desktopProfile.findUnique({
    where: { accountId },
    select: desktopProfileSelect,
  })
  if (existing) {
    return existing
  }
  return prisma.desktopProfile.create({
    data: { accountId },
    select: desktopProfileSelect,
  })
}

async function findOwnedDesktopPet(params: {
  accountId: string
  desktopPetId: string
}): Promise<DesktopPetRow> {
  const pet = await prisma.desktopPet.findUnique({
    where: { id: params.desktopPetId },
    select: desktopPetSelect,
  })

  if (!pet || pet.accountId !== params.accountId) {
    throw new DesktopPetNotFoundError()
  }

  return pet
}

async function buildDesktopMeResponse(params: {
  accountId: string
  pet: DesktopPetRow
}): Promise<DesktopMeResponse> {
  const profileRow = await ensureDesktopProfile(params.accountId)
  const primarySuiAddress = await resolvePrimarySuiAddress(params.accountId)
  const profile = toDesktopProfile(profileRow, params.pet, primarySuiAddress)

  let activePersona = null
  if (params.pet.activeSourceType && params.pet.activeSourceRef) {
    const sourceType =
      params.pet.activeSourceType === 'starter' || params.pet.activeSourceType === 'soul'
        ? (params.pet.activeSourceType as DesktopCatalogSourceType)
        : null
    if (sourceType) {
      activePersona = await findDesktopPersonaManifestBySource({
        sourceType,
        sourceRef: params.pet.activeSourceRef,
      })
    }
  }

  return { profile, activePersona }
}

export async function getDesktopMe(params: {
  accountId: string
  desktopPetId: string
}): Promise<DesktopMeResponse> {
  const pet = await findOwnedDesktopPet(params)
  return buildDesktopMeResponse({ accountId: params.accountId, pet })
}

export async function setDesktopActivePersona(params: {
  accountId: string
  desktopPetId: string
  sourceType: DesktopCatalogSourceType | null
  sourceRef: string | null
  now?: Date
}): Promise<DesktopMeResponse> {
  if (params.sourceType && params.sourceRef) {
    const activePersona = await findDesktopPersonaManifestBySource({
      sourceType: params.sourceType,
      sourceRef: params.sourceRef,
    })

    if (!activePersona) {
      throw new DesktopActivePersonaNotFoundError()
    }
  }

  const lastSyncedAt = params.now ?? new Date()

  let updatedPet: DesktopPetRow
  try {
    updatedPet = await prisma.desktopPet.update({
      where: {
        // Composite uniqueness — pet id must belong to this account.
        id: params.desktopPetId,
        accountId: params.accountId,
      },
      data: {
        activeSourceType: params.sourceType,
        activeSourceRef: params.sourceRef,
        lastSyncedAt,
      },
      select: desktopPetSelect,
    })
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2025'
    ) {
      throw new DesktopPetNotFoundError()
    }
    throw error
  }

  return buildDesktopMeResponse({ accountId: params.accountId, pet: updatedPet })
}
