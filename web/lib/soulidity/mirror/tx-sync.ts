import { prisma } from '@/lib/prisma'
import type { Prisma } from '@db/prisma-client'

// Routes that wrap projection writes + this idempotency write in a single
// `prisma.$transaction` need to thread the transaction client through, so
// the helpers accept an optional client (default = global `prisma`).
type TxSyncDbClient = Prisma.TransactionClient | typeof prisma

export const SOULIDITY_TX_SYNC_ROUTE_KEYS = [
  'publish',
  'publish:batch',
  'buy',
  'list',
  'delist',
  // Pet-scoped batch grant issue/revoke driven by `/account/pets` PetCard.
  // One row per (memberId, petId, txDigest) so wallet retries dedupe.
  'pet-grant:issue',
  'pet-grant:revoke',
  'collection:mint',
  'collection:add-soul',
  'import',
  'personal-join',
  'agent-buy',
] as const

export type SoulidityTxSyncRouteKey = (typeof SOULIDITY_TX_SYNC_ROUTE_KEYS)[number]

function normalizeSyncKeyPart(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : fallback
}

export async function getStoredSoulidityTxSync(
  params: {
    routeKey: SoulidityTxSyncRouteKey
    txDigest: string
    actorKey?: string | null
    resourceKey?: string | null
  },
  client: TxSyncDbClient = prisma,
) {
  return client.soulTxSync.findUnique({
    where: {
      routeKey_txDigest_actorKey_resourceKey: {
        routeKey: params.routeKey,
        txDigest: params.txDigest,
        actorKey: normalizeSyncKeyPart(params.actorKey, 'anonymous'),
        resourceKey: normalizeSyncKeyPart(params.resourceKey, 'global'),
      },
    },
  })
}

export async function storeSoulidityTxSync(
  params: {
    routeKey: SoulidityTxSyncRouteKey
    txDigest: string
    actorKey?: string | null
    resourceKey?: string | null
    statusCode: number
    responseBody: object
  },
  client: TxSyncDbClient = prisma,
) {
  const actorKey = normalizeSyncKeyPart(params.actorKey, 'anonymous')
  const resourceKey = normalizeSyncKeyPart(params.resourceKey, 'global')

  return client.soulTxSync.upsert({
    where: {
      routeKey_txDigest_actorKey_resourceKey: {
        routeKey: params.routeKey,
        txDigest: params.txDigest,
        actorKey,
        resourceKey,
      },
    },
    update: {
      statusCode: params.statusCode,
      responseBody: params.responseBody,
    },
    create: {
      routeKey: params.routeKey,
      txDigest: params.txDigest,
      actorKey,
      resourceKey,
      statusCode: params.statusCode,
      responseBody: params.responseBody,
    },
  })
}
