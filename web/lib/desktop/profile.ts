import type { Prisma } from '../../../generated/prisma/client'
import { prisma } from '@web/lib/prisma'
import { findDesktopPersonaManifestBySource } from '@/lib/desktop/repository'
import type {
  DesktopCatalogSourceType,
  DesktopMeResponse,
  DesktopProfile,
} from '@/lib/types/desktop'

const desktopProfileSelect = {
  accountId: true,
  activeSourceType: true,
  activeSourceRef: true,
  preferences: true,
  lastSyncedAt: true,
  updatedAt: true,
} as const

type DesktopProfileRow = Prisma.DesktopProfileGetPayload<{ select: typeof desktopProfileSelect }>

function asIso(value: Date | null) {
  return value ? value.toISOString() : null
}

function isDesktopCatalogSourceType(value: string | null): value is DesktopCatalogSourceType {
  return value === 'starter' || value === 'soul'
}

function normalizeDesktopPreferences(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function toDesktopProfile(row: DesktopProfileRow): DesktopProfile {
  return {
    accountId: row.accountId,
    activeSourceType: isDesktopCatalogSourceType(row.activeSourceType) ? row.activeSourceType : null,
    activeSourceRef: row.activeSourceRef,
    preferences: normalizeDesktopPreferences(row.preferences),
    lastSyncedAt: asIso(row.lastSyncedAt),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export class DesktopActivePersonaNotFoundError extends Error {
  constructor(message = 'Desktop active persona was not found') {
    super(message)
    this.name = 'DesktopActivePersonaNotFoundError'
  }
}

async function upsertDesktopProfile(
  accountId: string,
  params: {
    activeSourceType?: DesktopCatalogSourceType | null
    activeSourceRef?: string | null
    lastSyncedAt?: Date | null
  } = {},
) {
  const hasActiveSourceType = 'activeSourceType' in params
  const hasActiveSourceRef = 'activeSourceRef' in params
  const hasLastSyncedAt = 'lastSyncedAt' in params

  return prisma.desktopProfile.upsert({
    where: { accountId },
    create: {
      accountId,
      ...(hasActiveSourceType ? { activeSourceType: params.activeSourceType ?? null } : {}),
      ...(hasActiveSourceRef ? { activeSourceRef: params.activeSourceRef ?? null } : {}),
      ...(hasLastSyncedAt ? { lastSyncedAt: params.lastSyncedAt ?? null } : {}),
    },
    update: {
      ...(hasActiveSourceType ? { activeSourceType: params.activeSourceType ?? null } : {}),
      ...(hasActiveSourceRef ? { activeSourceRef: params.activeSourceRef ?? null } : {}),
      ...(hasLastSyncedAt ? { lastSyncedAt: params.lastSyncedAt ?? null } : {}),
    },
    select: desktopProfileSelect,
  })
}

export async function getDesktopMe(accountId: string): Promise<DesktopMeResponse> {
  let profileRow = await prisma.desktopProfile.findUnique({
    where: { accountId },
    select: desktopProfileSelect,
  })
  if (!profileRow) {
    profileRow = await upsertDesktopProfile(accountId)
  }
  const profile = toDesktopProfile(profileRow)

  if (!profile.activeSourceType || !profile.activeSourceRef) {
    return {
      profile,
      activePersona: null,
    }
  }

  const activePersona = await findDesktopPersonaManifestBySource({
    sourceType: profile.activeSourceType,
    sourceRef: profile.activeSourceRef,
  })

  return {
    profile,
    activePersona,
  }
}

export async function setDesktopActivePersona(
  accountId: string,
  params: {
    sourceType: DesktopCatalogSourceType | null
    sourceRef: string | null
    now?: Date
  },
): Promise<DesktopMeResponse> {
  const now = params.now ?? new Date()

  if (params.sourceType && params.sourceRef) {
    const activePersona = await findDesktopPersonaManifestBySource({
      sourceType: params.sourceType,
      sourceRef: params.sourceRef,
    })

    if (!activePersona) {
      throw new DesktopActivePersonaNotFoundError()
    }

    const profileRow = await upsertDesktopProfile(accountId, {
      activeSourceType: params.sourceType,
      activeSourceRef: params.sourceRef,
      lastSyncedAt: now,
    })

    return {
      profile: toDesktopProfile(profileRow),
      activePersona,
    }
  }

  const profileRow = await upsertDesktopProfile(accountId, {
    activeSourceType: null,
    activeSourceRef: null,
    lastSyncedAt: now,
  })

  return {
    profile: toDesktopProfile(profileRow),
    activePersona: null,
  }
}
