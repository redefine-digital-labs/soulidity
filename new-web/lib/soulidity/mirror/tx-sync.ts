import { prisma } from '@web/lib/prisma'

export const SOULIDITY_TX_SYNC_ROUTE_KEYS = [
  'publish',
  'buy',
  'list',
  'delist',
  'grant:issue',
  'grant:revoke',
  'grant:revoke-scope',
  'skills:append',
  'skills:delete',
  'collection:mint',
  'collection:list',
  'collection:delist',
  'collection:buy',
  'import',
  'personal-join',
  'agent-buy',
] as const

export type SoulidityTxSyncRouteKey = (typeof SOULIDITY_TX_SYNC_ROUTE_KEYS)[number]

function normalizeSyncKeyPart(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : fallback
}

export async function getStoredSoulidityTxSync(params: {
  routeKey: SoulidityTxSyncRouteKey
  txDigest: string
  actorKey?: string | null
  resourceKey?: string | null
}) {
  return prisma.soulTxSync.findUnique({
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

export async function storeSoulidityTxSync(params: {
  routeKey: SoulidityTxSyncRouteKey
  txDigest: string
  actorKey?: string | null
  resourceKey?: string | null
  statusCode: number
  responseBody: object
}) {
  const actorKey = normalizeSyncKeyPart(params.actorKey, 'anonymous')
  const resourceKey = normalizeSyncKeyPart(params.resourceKey, 'global')

  return prisma.soulTxSync.upsert({
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
