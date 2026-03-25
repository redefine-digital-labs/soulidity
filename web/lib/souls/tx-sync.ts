import { Prisma } from '../../../generated/prisma/client'
import { prisma } from '@web/lib/prisma'

export type SoulTxSyncRouteKey = 'purchase' | 'publish' | 'release' | 'grant:set' | 'grant:revoke' | 'renew'

type SoulTxSyncBody = Record<string, unknown>
type SoulTxSyncDbClient = typeof prisma | Prisma.TransactionClient
const MAX_SOUL_TX_SYNC_BODY_BYTES = 64 * 1024
const SOUL_TX_SYNC_CROSS_ACTOR_CONFLICT = 'txDigest has already been processed by another account'

function stringifySoulTxSyncBody(body: SoulTxSyncBody): string {
  return JSON.stringify(body)
}

export async function getStoredSoulTxSync(params: {
  txDigest: string
  routeKey: SoulTxSyncRouteKey
  actorKey: string
  resourceKey: string
}): Promise<{ statusCode: number; body: SoulTxSyncBody } | null> {
  const record = await prisma.soulTxSync.findUnique({
    where: {
      routeKey_txDigest_actorKey_resourceKey: {
        routeKey: params.routeKey,
        txDigest: params.txDigest,
        actorKey: params.actorKey,
        resourceKey: params.resourceKey,
      },
    },
    select: {
      statusCode: true,
      responseBody: true,
    },
  })

  if (!record) {
    const crossActorRecord = await prisma.soulTxSync.findFirst({
      where: {
        txDigest: params.txDigest,
        NOT: { actorKey: params.actorKey },
      },
      select: {
        actorKey: true,
      },
    })

    if (!crossActorRecord) {
      return null
    }

    return {
      statusCode: 409,
      body: { error: SOUL_TX_SYNC_CROSS_ACTOR_CONFLICT },
    }
  }

  return {
    statusCode: record.statusCode,
    body: record.responseBody as SoulTxSyncBody,
  }
}

export async function storeSoulTxSync(params: {
  txDigest: string
  routeKey: SoulTxSyncRouteKey
  actorKey: string
  resourceKey: string
  statusCode: number
  body: SoulTxSyncBody
  db?: SoulTxSyncDbClient
}): Promise<void> {
  const db = params.db ?? prisma
  const serializedBody = stringifySoulTxSyncBody(params.body)
  if (Buffer.byteLength(serializedBody, 'utf8') > MAX_SOUL_TX_SYNC_BODY_BYTES) {
    throw new Error('Soul tx sync body exceeds the size limit')
  }

  await db.soulTxSync.upsert({
    where: {
      routeKey_txDigest_actorKey_resourceKey: {
        routeKey: params.routeKey,
        txDigest: params.txDigest,
        actorKey: params.actorKey,
        resourceKey: params.resourceKey,
      },
    },
    create: {
      routeKey: params.routeKey,
      txDigest: params.txDigest,
      actorKey: params.actorKey,
      resourceKey: params.resourceKey,
      statusCode: params.statusCode,
      responseBody: params.body as Prisma.InputJsonValue,
    },
    update: {
      resourceKey: params.resourceKey,
      statusCode: params.statusCode,
      responseBody: params.body as Prisma.InputJsonValue,
    },
  })
}
