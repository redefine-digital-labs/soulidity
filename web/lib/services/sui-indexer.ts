/**
 * Sui event indexer for Soul marketplace.
 * Subscribes to on-chain events and syncs to PostgreSQL.
 */

import { prisma } from '@web/lib/prisma'
import { suiClient } from '@web/lib/sui'
import { decodeMoveBytesAsHex, decodeMoveText } from './sui-event-decoder'
import { parseSuiTimestampMs, requireSuiPackageId } from './sui-indexer-utils'

const SOUL_PACKAGE_ID = process.env.NEXT_PUBLIC_SOUL_PACKAGE_ID || ''
const POLL_INTERVAL_MS = 5_000
const MAX_CONSECUTIVE_EVENT_FAILURES = 3

const PLAN_ONETIME = 0
const PLAN_SUBSCRIPTION = 1
const MS_PER_DAY = 86_400_000
const USDC_ATOMIC_TO_CENTS = 10_000n

const globalForIndexer = globalThis as typeof globalThis & {
  __soulIndexerFailureCounts?: Map<string, number>
}

const eventFailureCounts =
  globalForIndexer.__soulIndexerFailureCounts ?? new Map<string, number>()

if (!globalForIndexer.__soulIndexerFailureCounts) {
  globalForIndexer.__soulIndexerFailureCounts = eventFailureCounts
}

function getEventFailureKey(moduleName: string, event: SuiEvent): string {
  return `${moduleName}:${event.id.txDigest}:${event.id.eventSeq}`
}

type PassSnapshotUpdate = {
  expiresAt?: Date
  lastSyncedAt?: Date
  agentGrant?: string | null
  ownerAddress?: string
  ownerMemberId?: string | null
}

function buildDeadLetterPayload(event: SuiEvent): Record<string, unknown> {
  return {
    id: event.id,
    type: event.type,
    parsedJson: event.parsedJson,
    timestampMs: event.timestampMs ?? null,
  }
}

async function recordDeadLetterEvent(
  moduleName: string,
  event: SuiEvent,
  failureCount: number,
  errorMessage: string,
) {
  await (prisma as any).indexerDeadLetterEvent.upsert({
    where: {
      moduleName_txDigest_eventSeq: {
        moduleName,
        txDigest: event.id.txDigest,
        eventSeq: event.id.eventSeq,
      },
    },
    create: {
      moduleName,
      eventType: event.type,
      txDigest: event.id.txDigest,
      eventSeq: event.id.eventSeq,
      payload: buildDeadLetterPayload(event),
      errorMessage,
      failureCount,
    },
    update: {
      eventType: event.type,
      payload: buildDeadLetterPayload(event),
      errorMessage,
      failureCount,
    },
  })
}

async function requirePassSnapshotUpdate(passId: string, data: PassSnapshotUpdate) {
  const result = await prisma.soulPassSnapshot.updateMany({
    where: { onChainId: passId },
    data,
  })

  if (result.count === 0) {
    throw new Error(`Pass ${passId} must exist before indexing dependent pass state`)
  }
}

interface SuiEvent {
  id: { txDigest: string; eventSeq: string }
  type: string
  parsedJson: Record<string, unknown>
  timestampMs?: string
}

/**
 * Process a SeriesCreated event
 */
async function handleSeriesCreated(event: SuiEvent) {
  const data = event.parsedJson as {
    series_id: string
    author: string
    name: string
    category: string
  }

  const binding = await prisma.walletBinding.findFirst({
    where: { address: data.author, chain: 'sui' },
  })

  await prisma.soulSeries.upsert({
    where: { onChainId: data.series_id },
    create: {
      onChainId: data.series_id,
      authorMemberId: binding?.memberId ?? null,
      authorAddress: data.author,
      name: decodeMoveText(data.name),
      description: '',
      category: decodeMoveText(data.category),
      tags: [],
      previewImages: [],
    },
    update: {
      authorMemberId: binding?.memberId ?? null,
      authorAddress: data.author,
      name: decodeMoveText(data.name),
      category: decodeMoveText(data.category),
    },
  })
}

/**
 * Process a SeriesMetadataUpdated event.
 * The event only carries series_id, so we read the object from chain.
 */
async function handleSeriesMetadataUpdated(event: SuiEvent) {
  const data = event.parsedJson as { series_id: string }

  const obj = await suiClient.getObject({
    id: data.series_id,
    options: { showContent: true },
  })

  if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') {
    throw new Error(`Cannot read series object ${data.series_id} from chain`)
  }

  const fields = (obj.data.content as { dataType: 'moveObject'; fields: Record<string, unknown> }).fields

  await prisma.soulSeries.updateMany({
    where: { onChainId: data.series_id },
    data: {
      name: decodeMoveText(fields.name),
      description: decodeMoveText(fields.description),
      category: decodeMoveText(fields.category),
      tags: (fields.tags as unknown[]).map(decodeMoveText),
      previewImages: (fields.preview_images as unknown[]).map(decodeMoveText),
    },
  })
}

/**
 * Process an AuthorCapTransferred event
 */
async function handleAuthorCapTransferred(event: SuiEvent) {
  const data = event.parsedJson as {
    series_id: string
    old_author: string
    new_author: string
  }

  const binding = await prisma.walletBinding.findFirst({
    where: { address: data.new_author, chain: 'sui' },
  })

  await prisma.soulSeries.updateMany({
    where: { onChainId: data.series_id },
    data: {
      authorAddress: data.new_author,
      authorMemberId: binding?.memberId ?? null,
    },
  })
}

/**
 * Process a PricingPlanCreated event.
 * Maps on-chain plan to the flat pricing columns on SoulSeries.
 */
async function handlePricingPlanCreated(event: SuiEvent) {
  const data = event.parsedJson as {
    plan_id: string
    series_id: string
    plan_type: number
    price_usdc: string
    period_ms: string
  }

  const priceCents = Number(BigInt(data.price_usdc) / USDC_ATOMIC_TO_CENTS)

  if (data.plan_type === PLAN_ONETIME) {
    await prisma.soulSeries.updateMany({
      where: { onChainId: data.series_id },
      data: { oneTimePriceUsdc: priceCents },
    })
  } else if (data.plan_type === PLAN_SUBSCRIPTION) {
    const periodDays = Math.ceil(Number(data.period_ms) / MS_PER_DAY)
    await prisma.soulSeries.updateMany({
      where: { onChainId: data.series_id },
      data: { subPriceUsdc: priceCents, subPeriodDays: periodDays },
    })
  }
}

/**
 * Process a PricingPlanDeactivated event.
 * Reads the plan from chain to determine series and type, then clears pricing.
 */
async function handlePricingPlanDeactivated(event: SuiEvent) {
  const data = event.parsedJson as { plan_id: string }

  const obj = await suiClient.getObject({
    id: data.plan_id,
    options: { showContent: true },
  })

  if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') {
    throw new Error(`Cannot read pricing plan object ${data.plan_id} from chain`)
  }

  const fields = (obj.data.content as { dataType: 'moveObject'; fields: Record<string, unknown> }).fields
  const seriesId = fields.series_id as string
  const planType = fields.plan_type as number
  const priceCents = Number(BigInt(fields.price_usdc as string) / USDC_ATOMIC_TO_CENTS)

  // Only clear projected pricing if it still matches the deactivated plan.
  // A newer plan may have already overwritten the columns.
  if (planType === PLAN_ONETIME) {
    await prisma.soulSeries.updateMany({
      where: { onChainId: seriesId, oneTimePriceUsdc: priceCents },
      data: { oneTimePriceUsdc: null },
    })
  } else if (planType === PLAN_SUBSCRIPTION) {
    const periodDays = Math.ceil(Number(fields.period_ms as string) / MS_PER_DAY)
    await prisma.soulSeries.updateMany({
      where: { onChainId: seriesId, subPriceUsdc: priceCents, subPeriodDays: periodDays },
      data: { subPriceUsdc: null, subPeriodDays: null },
    })
  }
}

/**
 * Process a ReleasePublished event
 */
async function handleReleasePublished(event: SuiEvent) {
  const data = event.parsedJson as {
    series_id: string
    release_id: string
    version: string
    encrypted_blob_id: string
    public_metadata_id: string
    content_hash: string
  }

  const series = await prisma.soulSeries.findUnique({
    where: { onChainId: data.series_id },
  })
  if (!series) {
    throw new Error(`Series ${data.series_id} must exist before indexing release ${data.release_id}`)
  }

  const release = await prisma.soulRelease.upsert({
    where: { onChainId: data.release_id },
    create: {
      onChainId: data.release_id,
      seriesId: series.id,
      version: decodeMoveText(data.version),
      walrusBlobRef: decodeMoveText(data.encrypted_blob_id),
      publicMetadataRef: decodeMoveText(data.public_metadata_id) || null,
      contentHash: decodeMoveBytesAsHex(data.content_hash),
    },
    update: {
      version: decodeMoveText(data.version),
      walrusBlobRef: decodeMoveText(data.encrypted_blob_id),
      publicMetadataRef: decodeMoveText(data.public_metadata_id) || null,
      contentHash: decodeMoveBytesAsHex(data.content_hash),
    },
  })

  await prisma.soulSeries.update({
    where: { id: series.id },
    data: { latestReleaseId: release.id },
  })
}

/**
 * Process a PerpetualPassMinted event
 */
async function handlePerpetualPassMinted(event: SuiEvent) {
  const data = event.parsedJson as {
    pass_id: string
    series_id: string
    release_id: string
    owner: string
  }

  const series = await prisma.soulSeries.findUnique({
    where: { onChainId: data.series_id },
  })
  if (!series) {
    throw new Error(`Series ${data.series_id} must exist before indexing pass ${data.pass_id}`)
  }

  // Try to resolve owner to member
  const binding = await prisma.walletBinding.findFirst({
    where: { address: data.owner, chain: 'sui' },
  })

  await prisma.soulPassSnapshot.upsert({
    where: { onChainId: data.pass_id },
    create: {
      onChainId: data.pass_id,
      seriesId: series.id,
      ownerAddress: data.owner,
      ownerMemberId: binding?.memberId ?? null,
      passType: 'perpetual',
      lockedReleaseId: data.release_id,
      mintTxDigest: event.id.txDigest,
    },
    update: {
      ownerAddress: data.owner,
      ownerMemberId: binding?.memberId ?? null,
    },
  })
}

/**
 * Process a SubscriptionPassMinted event
 */
async function handleSubscriptionPassMinted(event: SuiEvent) {
  const data = event.parsedJson as {
    pass_id: string
    series_id: string
    owner: string
    expires_at: string
  }

  const series = await prisma.soulSeries.findUnique({
    where: { onChainId: data.series_id },
  })
  if (!series) {
    throw new Error(`Series ${data.series_id} must exist before indexing pass ${data.pass_id}`)
  }

  const binding = await prisma.walletBinding.findFirst({
    where: { address: data.owner, chain: 'sui' },
  })

  await prisma.soulPassSnapshot.upsert({
    where: { onChainId: data.pass_id },
    create: {
      onChainId: data.pass_id,
      seriesId: series.id,
      ownerAddress: data.owner,
      ownerMemberId: binding?.memberId ?? null,
      passType: 'subscription',
      expiresAt: parseSuiTimestampMs(data.expires_at, 'expires_at'),
      mintTxDigest: event.id.txDigest,
    },
    update: {
      ownerAddress: data.owner,
      ownerMemberId: binding?.memberId ?? null,
      expiresAt: parseSuiTimestampMs(data.expires_at, 'expires_at'),
    },
  })
}

/**
 * Process a SubscriptionRenewed event
 */
async function handleSubscriptionRenewed(event: SuiEvent) {
  const data = event.parsedJson as {
    pass_id: string
    new_expires_at: string
  }

  await requirePassSnapshotUpdate(data.pass_id, {
    expiresAt: parseSuiTimestampMs(data.new_expires_at, 'new_expires_at'),
    lastSyncedAt: new Date(),
  })
}

/**
 * Process an AgentGrantSet event
 */
async function handleAgentGrantSet(event: SuiEvent) {
  const data = event.parsedJson as {
    pass_id: string
    agent: string
  }

  await requirePassSnapshotUpdate(data.pass_id, {
    agentGrant: data.agent,
    lastSyncedAt: new Date(),
  })
}

/**
 * Process an AgentGrantRevoked event
 */
async function handleAgentGrantRevoked(event: SuiEvent) {
  const data = event.parsedJson as {
    pass_id: string
  }

  await requirePassSnapshotUpdate(data.pass_id, {
    agentGrant: null,
    lastSyncedAt: new Date(),
  })
}

/**
 * Process a PassTransferred event
 */
async function handlePassTransferred(event: SuiEvent) {
  const data = event.parsedJson as {
    pass_id: string
    to: string
  }

  const binding = await prisma.walletBinding.findFirst({
    where: { address: data.to, chain: 'sui' },
  })

  await requirePassSnapshotUpdate(data.pass_id, {
    ownerAddress: data.to,
    ownerMemberId: binding?.memberId ?? null,
    agentGrant: null,
    lastSyncedAt: new Date(),
  })
}

export function createEventHandlers(packageId: string): Record<string, (event: SuiEvent) => Promise<void>> {
  return {
    [`${packageId}::series::SeriesCreated`]: handleSeriesCreated,
    [`${packageId}::series::SeriesMetadataUpdated`]: handleSeriesMetadataUpdated,
    [`${packageId}::series::ReleasePublished`]: handleReleasePublished,
    [`${packageId}::series::AuthorCapTransferred`]: handleAuthorCapTransferred,
    [`${packageId}::purchase::PricingPlanCreated`]: handlePricingPlanCreated,
    [`${packageId}::purchase::PricingPlanDeactivated`]: handlePricingPlanDeactivated,
    [`${packageId}::pass::PerpetualPassMinted`]: handlePerpetualPassMinted,
    [`${packageId}::pass::SubscriptionPassMinted`]: handleSubscriptionPassMinted,
    [`${packageId}::pass::SubscriptionRenewed`]: handleSubscriptionRenewed,
    [`${packageId}::grant::AgentGrantSet`]: handleAgentGrantSet,
    [`${packageId}::grant::AgentGrantRevoked`]: handleAgentGrantRevoked,
    [`${packageId}::grant::PassTransferred`]: handlePassTransferred,
  }
}

/** Modules that emit events we need to index (order matters: series before purchase/pass/grant) */
const EVENT_MODULES = ['series', 'purchase', 'pass', 'grant'] as const

/**
 * Parse a stored cursor string back into a Sui EventId.
 */
function parseCursor(cursorData: string | null): { txDigest: string; eventSeq: string } | undefined {
  if (!cursorData) return undefined
  try {
    const parsed = JSON.parse(cursorData)
    if (parsed.txDigest && parsed.eventSeq !== undefined) return parsed
  } catch { /* invalid cursor, start from beginning */ }
  return undefined
}

/**
 * Run the indexer loop.
 * Polls for new events from each event-emitting module, pages through all
 * available events, and persists the real Sui event cursor for resumption.
 */
export async function runIndexer() {
  const packageId = requireSuiPackageId(SOUL_PACKAGE_ID)
  const eventHandlers = createEventHandlers(packageId)
  console.log('[indexer] Starting Soul event indexer...')

  while (true) {
    try {
      for (const moduleName of EVENT_MODULES) {
        const cursorId = `sui-soul-${moduleName}`

        const cursorRow = await prisma.indexerCursor.findFirst({
          where: { id: cursorId },
        })
        let eventCursor = parseCursor(cursorRow?.cursorData ?? null)

        // Page through all available events for this module
        let hasMore = true
        while (hasMore) {
          const events = await suiClient.queryEvents({
            query: { MoveModule: { package: packageId, module: moduleName } },
            order: 'ascending',
            limit: 50,
            cursor: eventCursor,
          })

          let processedCount = 0
          let pageFailed = false
          let lastProcessedCursor: { txDigest: string; eventSeq: string } | undefined

          for (const event of events.data) {
            const typedEvent = event as unknown as SuiEvent
            const handler = eventHandlers[event.type]
            if (handler) {
              try {
                await handler(typedEvent)
                eventFailureCounts.delete(getEventFailureKey(moduleName, typedEvent))
              } catch (err) {
                const failureKey = getEventFailureKey(moduleName, typedEvent)
                const failureCount = (eventFailureCounts.get(failureKey) ?? 0) + 1
                eventFailureCounts.set(failureKey, failureCount)
                const errorMessage = err instanceof Error ? err.message : String(err)
                console.error(
                  `[indexer] Error handling event ${event.type} (attempt ${failureCount}/${MAX_CONSECUTIVE_EVENT_FAILURES}):`,
                  err,
                )

                if (failureCount >= MAX_CONSECUTIVE_EVENT_FAILURES) {
                  await recordDeadLetterEvent(moduleName, typedEvent, failureCount, errorMessage)
                  console.error(
                    `[indexer] Skipping event ${event.type} after ${failureCount} consecutive failures and recording it in dead-letter storage`,
                  )
                  eventFailureCounts.delete(failureKey)
                  processedCount += 1
                  lastProcessedCursor = {
                    txDigest: event.id.txDigest,
                    eventSeq: event.id.eventSeq,
                  }
                  continue
                }

                pageFailed = true
                break
              }
            }

            processedCount += 1
            lastProcessedCursor = {
              txDigest: event.id.txDigest,
              eventSeq: event.id.eventSeq,
            }
          }

          const cursorToPersist = pageFailed
            ? lastProcessedCursor
            : events.nextCursor ?? lastProcessedCursor

          if (cursorToPersist && processedCount > 0) {
            eventCursor = cursorToPersist
            await prisma.indexerCursor.upsert({
              where: { id: cursorId },
              create: {
                id: cursorId,
                checkpoint: BigInt(processedCount),
                cursorData: JSON.stringify(cursorToPersist),
              },
              update: {
                checkpoint: { increment: BigInt(processedCount) },
                cursorData: JSON.stringify(cursorToPersist),
              },
            })
          }

          if (pageFailed) {
            break
          }
          hasMore = events.hasNextPage
        }
      }
    } catch (err) {
      console.error('[indexer] Poll error:', err)
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
}
