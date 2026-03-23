import { Prisma } from '../../../generated/prisma/client'
import { prisma } from '@web/lib/prisma'

export type SoulTxSyncRouteKey = 'purchase' | 'publish' | 'grant:set' | 'grant:revoke'

type SoulTxSyncBody = Record<string, unknown>
const MAX_SOUL_TX_SYNC_BODY_BYTES = 64 * 1024

function stringifySoulTxSyncBody(body: SoulTxSyncBody): string {
  return JSON.stringify(body)
}

export async function getStoredSoulTxSync(params: {
  txDigest: string
  routeKey: SoulTxSyncRouteKey
  actorKey: string
  resourceKey: string
}): Promise<{ statusCode: number; body: SoulTxSyncBody } | null> {
  const record = await prisma.soulTxSync.findFirst({
    where: {
      routeKey: params.routeKey,
      txDigest: params.txDigest,
      actorKey: params.actorKey,
      resourceKey: params.resourceKey,
    },
    select: {
      statusCode: true,
      responseBody: true,
    },
  })

  if (!record) {
    return null
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
}): Promise<void> {
  const serializedBody = stringifySoulTxSyncBody(params.body)
  if (Buffer.byteLength(serializedBody, 'utf8') > MAX_SOUL_TX_SYNC_BODY_BYTES) {
    throw new Error('Soul tx sync body exceeds the size limit')
  }

  await prisma.soulTxSync.upsert({
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
