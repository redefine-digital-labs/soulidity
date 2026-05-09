import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireHumanWalletIdentity, assertTransactionSender } from '@/lib/soulidity/server'
import { findSoulAssetByRouteId } from '@/lib/soulidity/repository'
import { buildSyncSealSidecars, SealSidecarSyncConfigError } from '@/lib/soulidity/mirror/build-seal-sidecars'
import {
  markContentVersionDeletedFromChain,
  markContentVersionPurgedFromChain,
  syncContentVersionProjectionFromChain,
} from '@/lib/soulidity/mirror/sync-helpers'
import {
  getStoredSoulidityTxSync,
  storeSoulidityTxSync,
  type SoulidityTxSyncRouteKey,
} from '@/lib/soulidity/mirror/tx-sync'
import { badRequest, parseContentKindParam, parseContentVersionIndexParam } from '@/lib/soulidity/content-route'
import {
  KIND_AUDIO,
  KIND_SPRITE,
  extractActiveBindingUpdatedEvent,
  extractContentVersionAppendedEvent,
  extractContentVersionDeletedEvent,
  extractContentVersionPurgedEvent,
  extractSoulStateConfigDeletedEvent,
  extractSoulStateConfigUpsertedEvent,
  getRequiredSoulidityEnv,
  getSoulStateConfigEntry,
  getSuccessfulTransactionBlock,
  parseRequiredTxDigest,
  readTransactionSender,
  resolveWalrusBlobId,
  waitForTransactionBestEffort,
} from '@soulidity/sdk'

export const dynamic = 'force-dynamic'

type ContentSyncAction =
  | 'append'
  | 'delete'
  | 'purge'
  | 'active-bind'
  | 'active-clear'
  | 'state-config:upsert'
  | 'state-config:delete'

const ROUTE_KEY_BY_ACTION: Record<ContentSyncAction, SoulidityTxSyncRouteKey> = {
  append: 'content:append',
  delete: 'content:delete',
  purge: 'content:purge',
  'active-bind': 'content:active-bind',
  'active-clear': 'content:active-clear',
  'state-config:upsert': 'state-config:upsert',
  'state-config:delete': 'state-config:delete',
}

function parseAction(value: unknown): ContentSyncAction | null {
  if (typeof value !== 'string') return null
  return Object.prototype.hasOwnProperty.call(ROUTE_KEY_BY_ACTION, value)
    ? value as ContentSyncAction
    : null
}

function parseString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function parseBodyKind(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  return parseContentKindParam(typeof value === 'string' ? value : null)
}

function parseBodyVersionIndex(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  return parseContentVersionIndexParam(typeof value === 'string' ? value : null)
}

function resourceKeyFor(action: ContentSyncAction, soulOnChainId: string, body: Record<string, unknown>) {
  if (action === 'state-config:upsert' || action === 'state-config:delete') {
    return `${soulOnChainId}:state-config:${parseString(body.key) ?? 'unknown'}`
  }
  if (action === 'active-bind' || action === 'active-clear') {
    return `${soulOnChainId}:${parseBodyKind(body.kind) ?? 'unknown'}:active`
  }
  return `${soulOnChainId}:${parseBodyKind(body.kind) ?? 'unknown'}:${parseString(body.name) ?? 'unknown'}`
}

function assertEventTarget(params: {
  event: { soulId: string; contentId?: string; stateId?: string; kind?: number; name?: string; versionIndex?: number }
  soulOnChainId: string
  contentOnChainId: string | null
  stateOnChainId: string
  kind?: number
  name?: string
  versionIndex?: number
}): NextResponse | null {
  if (params.event.soulId !== params.soulOnChainId) {
    return NextResponse.json({ error: 'Transaction targeted a different Soul' }, { status: 422 })
  }
  if (params.event.contentId && params.contentOnChainId && params.event.contentId !== params.contentOnChainId) {
    return NextResponse.json({ error: 'Transaction targeted a different SoulContent root' }, { status: 422 })
  }
  if (params.event.stateId && params.event.stateId !== params.stateOnChainId) {
    return NextResponse.json({ error: 'Transaction targeted a different SoulState root' }, { status: 422 })
  }
  if (params.kind != null && params.event.kind !== params.kind) {
    return NextResponse.json({ error: 'Transaction emitted a different content kind' }, { status: 422 })
  }
  if (params.name != null && params.event.name !== params.name) {
    return NextResponse.json({ error: 'Transaction emitted a different content name' }, { status: 422 })
  }
  if (params.versionIndex != null && params.event.versionIndex !== params.versionIndex) {
    return NextResponse.json({ error: 'Transaction emitted a different content version' }, { status: 422 })
  }
  return null
}

function parseContentTarget(body: Record<string, unknown>) {
  const kind = parseBodyKind(body.kind)
  const name = parseString(body.name)
  const versionIndex = parseBodyVersionIndex(body.versionIndex)
  return { kind, name, versionIndex }
}

function activeBindingUpdate(kind: number, binding: null | { name: string; versionIndex: number; downloadPolicy: string }) {
  if (kind === KIND_SPRITE) {
    return {
      activeSpriteName: binding?.name ?? null,
      activeSpriteVersionIndex: binding?.versionIndex ?? null,
      activeSpriteDownloadPolicy: binding?.downloadPolicy ?? null,
    }
  }
  if (kind === KIND_AUDIO) {
    return {
      activeVoiceName: binding?.name ?? null,
      activeVoiceVersionIndex: binding?.versionIndex ?? null,
      activeVoiceDownloadPolicy: binding?.downloadPolicy ?? null,
    }
  }
  return null
}

function stateConfigUpdate(key: string, value: string | null) {
  if (key === 'sprite_config_json') return { spriteConfigJson: value }
  if (key === 'sprite_mood_map_json') return { spriteMoodMapJson: value }
  if (key === 'voice_config_json') return { voiceConfigJson: value }
  return null
}

async function mirrorAppend(params: {
  body: Record<string, unknown>
  transaction: unknown
  packageId: string
  soulOnChainId: string
  contentOnChainId: string | null
  stateOnChainId: string
}) {
  const { kind, name } = parseContentTarget(params.body)
  if (kind == null) return badRequest('kind is required')
  if (!name) return badRequest('name is required')
  if (!params.contentOnChainId) {
    return NextResponse.json({ error: 'Soul content root is not available' }, { status: 409 })
  }

  const event = extractContentVersionAppendedEvent(params.transaction as never, params.packageId)
  const mismatch = assertEventTarget({
    event,
    soulOnChainId: params.soulOnChainId,
    contentOnChainId: params.contentOnChainId,
    stateOnChainId: params.stateOnChainId,
    kind,
    name,
  })
  if (mismatch) return mismatch

  const sidecar = params.body.sealSidecar ?? null
  if (
    sidecar
    && typeof params.body.contentHash === 'string'
    && typeof sidecar === 'object'
    && sidecar !== null
    && 'contentHash' in sidecar
    && (sidecar as { contentHash?: unknown }).contentHash !== params.body.contentHash
  ) {
    return NextResponse.json({ error: 'sealSidecar contentHash does not match contentHash' }, { status: 422 })
  }

  let validatedEntries
  try {
    validatedEntries = buildSyncSealSidecars({
      contentObjectId: event.contentId,
      entries: [{
        kind: event.kind,
        name: event.name,
        versionIndex: event.versionIndex,
        sealEncrypted: event.sealEncrypted,
        sidecar: sidecar as never,
      }],
    }).validatedEntries
  } catch (error) {
    if (error instanceof SealSidecarSyncConfigError) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    throw error
  }

  // Always derive the blob ID from the on-chain Walrus Blob object emitted by
  // the transaction. Falling back to a caller-supplied `blobId` when the chain
  // read transiently fails would let a stale or malicious sync request mirror
  // a Walrus URL that disagrees with `event.blobObjectId` — the sealed
  // sidecar's contentHash check would fail at fetch time and any future
  // plaintext slot would serve the wrong artifact. Surface the lookup
  // failure as a retryable 503 so the client can resync once chain data is
  // available again (the tx-sync table is keyed by `(routeKey, txDigest,
  // actor, resource)`, so retrying is safe).
  let blobId: string | null
  try {
    blobId = await resolveWalrusBlobId(event.blobObjectId)
  } catch (error) {
    console.error('[soul-content-sync] Failed to resolve Walrus blob ID from chain', {
      blobObjectId: event.blobObjectId,
      error,
    })
    return NextResponse.json(
      { error: 'Failed to resolve Walrus blob ID from chain; retry the sync once chain data is available' },
      { status: 503 },
    )
  }
  await syncContentVersionProjectionFromChain({
    soulOnChainId: event.soulId,
    contentOnChainId: event.contentId,
    kind: event.kind,
    kindName: event.kindName,
    name: event.name,
    versionIndex: event.versionIndex,
    blobObjectId: event.blobObjectId,
    blobId,
    readModeMask: event.readModeMask,
    opMask: event.opMask,
    grantScopeMask: event.grantScopeMask,
    isPublic: event.isPublic,
    sealEncrypted: event.sealEncrypted,
    downloadPolicy: event.downloadPolicy,
    sealSidecar: validatedEntries[0]?.validatedSidecar ?? null,
    createdAtMs: event.createdAtMs,
  })

  return NextResponse.json({
    action: 'append',
    txDigest: parseString(params.body.txDigest),
    soulOnChainId: event.soulId,
    contentOnChainId: event.contentId,
    kind: event.kind,
    name: event.name,
    versionIndex: event.versionIndex,
  })
}

async function mirrorDeleteOrPurge(params: {
  action: 'delete' | 'purge'
  body: Record<string, unknown>
  transaction: unknown
  packageId: string
  soulOnChainId: string
  contentOnChainId: string | null
  stateOnChainId: string
}) {
  const { kind, name, versionIndex } = parseContentTarget(params.body)
  if (kind == null) return badRequest('kind is required')
  if (!name) return badRequest('name is required')
  if (versionIndex == null) return badRequest('versionIndex is required')
  if (!params.contentOnChainId) {
    return NextResponse.json({ error: 'Soul content root is not available' }, { status: 409 })
  }

  const event = params.action === 'delete'
    ? extractContentVersionDeletedEvent(params.transaction as never, params.packageId)
    : extractContentVersionPurgedEvent(params.transaction as never, params.packageId)
  const mismatch = assertEventTarget({
    event,
    soulOnChainId: params.soulOnChainId,
    contentOnChainId: params.contentOnChainId,
    stateOnChainId: params.stateOnChainId,
    kind,
    name,
    versionIndex,
  })
  if (mismatch) return mismatch

  if (params.action === 'delete') {
    await markContentVersionDeletedFromChain({
      contentOnChainId: event.contentId,
      kind: event.kind,
      name: event.name,
      versionIndex: event.versionIndex,
    })
  } else {
    await markContentVersionPurgedFromChain({
      contentOnChainId: event.contentId,
      kind: event.kind,
      name: event.name,
      versionIndex: event.versionIndex,
    })
  }

  return NextResponse.json({
    action: params.action,
    txDigest: parseString(params.body.txDigest),
    soulOnChainId: event.soulId,
    contentOnChainId: event.contentId,
    kind: event.kind,
    name: event.name,
    versionIndex: event.versionIndex,
  })
}

async function mirrorActiveBinding(params: {
  action: 'active-bind' | 'active-clear'
  body: Record<string, unknown>
  transaction: unknown
  packageId: string
  soulOnChainId: string
  contentOnChainId: string | null
  stateOnChainId: string
}) {
  const { kind, name, versionIndex } = parseContentTarget(params.body)
  if (kind == null) return badRequest('kind is required')
  if (params.action === 'active-bind' && !name) return badRequest('name is required')
  if (params.action === 'active-bind' && versionIndex == null) return badRequest('versionIndex is required')
  if (!params.contentOnChainId) {
    return NextResponse.json({ error: 'Soul content root is not available' }, { status: 409 })
  }

  const event = extractActiveBindingUpdatedEvent(params.transaction as never, params.packageId)
  const mismatch = assertEventTarget({
    event,
    soulOnChainId: params.soulOnChainId,
    contentOnChainId: params.contentOnChainId,
    stateOnChainId: params.stateOnChainId,
    kind,
  })
  if (mismatch) return mismatch
  if (params.action === 'active-bind') {
    if (!event.binding || event.binding.name !== name || event.binding.versionIndex !== versionIndex) {
      return NextResponse.json({ error: 'Transaction emitted a different active binding' }, { status: 422 })
    }
  } else if (event.binding !== null) {
    return NextResponse.json({ error: 'Transaction did not clear the active binding' }, { status: 422 })
  }

  const data = activeBindingUpdate(event.kind, event.binding)
  if (!data) {
    return NextResponse.json({ error: 'Active binding kind is not mirrored by the web projection' }, { status: 422 })
  }
  await prisma.soulAsset.updateMany({
    where: { onChainId: params.soulOnChainId, contentOnChainId: params.contentOnChainId },
    data,
  })

  return NextResponse.json({
    action: params.action,
    txDigest: parseString(params.body.txDigest),
    soulOnChainId: event.soulId,
    contentOnChainId: event.contentId,
    kind: event.kind,
    name: event.binding?.name ?? null,
    versionIndex: event.binding?.versionIndex ?? null,
  })
}

async function mirrorStateConfig(params: {
  action: 'state-config:upsert' | 'state-config:delete'
  body: Record<string, unknown>
  transaction: unknown
  packageId: string
  soulOnChainId: string
  contentOnChainId: string | null
  stateOnChainId: string
}) {
  const key = parseString(params.body.key)
  if (!key) return badRequest('key is required')

  const event = params.action === 'state-config:upsert'
    ? extractSoulStateConfigUpsertedEvent(params.transaction as never, params.packageId)
    : extractSoulStateConfigDeletedEvent(params.transaction as never, params.packageId)
  const mismatch = assertEventTarget({
    event,
    soulOnChainId: params.soulOnChainId,
    contentOnChainId: params.contentOnChainId,
    stateOnChainId: params.stateOnChainId,
  })
  if (mismatch) return mismatch
  if (event.key !== key) {
    return NextResponse.json({ error: 'Transaction emitted a different state config key' }, { status: 422 })
  }

  // The SoulStateConfigUpserted / Deleted events only carry (state_id, soul_id,
  // updater, key) — they never include the value. Trusting `params.body.value`
  // would let a stale or malicious sync request mirror a value that disagrees
  // with what's actually on chain. Read the canonical value (or absence) from
  // SoulState.config_ext[key] instead.
  const chainEntry = await getSoulStateConfigEntry({
    stateObjectId: params.stateOnChainId,
    packageId: params.packageId,
    key,
  })

  let value: string | null
  if (params.action === 'state-config:upsert') {
    if (chainEntry == null) {
      return NextResponse.json(
        { error: 'SoulState config_ext key is missing on chain' },
        { status: 409 },
      )
    }
    value = chainEntry.value
  } else {
    if (chainEntry != null) {
      return NextResponse.json(
        { error: 'SoulState config_ext key is still present on chain' },
        { status: 409 },
      )
    }
    value = null
  }

  const data = stateConfigUpdate(key, value)
  if (data) {
    await prisma.soulAsset.updateMany({
      where: { onChainId: params.soulOnChainId, stateOnChainId: params.stateOnChainId },
      data,
    })
  }

  return NextResponse.json({
    action: params.action,
    txDigest: parseString(params.body.txDigest),
    soulOnChainId: event.soulId,
    stateOnChainId: event.stateId,
    key: event.key,
  })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireHumanWalletIdentity({ mutation: request })
  if ('error' in auth) {
    return auth.error
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return badRequest('JSON body is required')

  const action = parseAction(body.action)
  if (!action) return badRequest('action is invalid')

  const txDigest = parseRequiredTxDigest(body.txDigest)
  if (!txDigest) return badRequest('txDigest must be a valid Sui transaction digest')

  const { id } = await params
  const soul = await findSoulAssetByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  const routeKey = ROUTE_KEY_BY_ACTION[action]
  const resourceKey = resourceKeyFor(action, soul.onChainId, body)
  const stored = await getStoredSoulidityTxSync({
    routeKey,
    txDigest,
    actorKey: auth.identity.memberId,
    resourceKey,
  })
  if (stored) {
    return NextResponse.json(stored.responseBody, { status: stored.statusCode })
  }

  try {
    await waitForTransactionBestEffort(txDigest)
    const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
    const transaction = await getSuccessfulTransactionBlock(txDigest)
    const senderError = assertTransactionSender(readTransactionSender(transaction), auth.walletAddresses)
    if (senderError) return senderError

    const shared = {
      body,
      transaction,
      packageId,
      soulOnChainId: soul.onChainId,
      contentOnChainId: soul.contentOnChainId,
      stateOnChainId: soul.stateOnChainId,
    }

    const response = action === 'append'
      ? await mirrorAppend(shared)
      : action === 'delete' || action === 'purge'
        ? await mirrorDeleteOrPurge({ ...shared, action })
        : action === 'active-bind' || action === 'active-clear'
          ? await mirrorActiveBinding({ ...shared, action })
          : await mirrorStateConfig({ ...shared, action })

    const responseBody = await response.clone().json().catch(() => ({}))
    if (response.ok) {
      await storeSoulidityTxSync({
        routeKey,
        txDigest,
        actorKey: auth.identity.memberId,
        resourceKey,
        statusCode: response.status,
        responseBody,
      })
    }

    return response
  } catch (error) {
    console.error('[soul-content-sync] Failed to mirror Soulidity content transaction', {
      memberId: auth.identity.memberId,
      txDigest,
      action,
      error,
    })
    return NextResponse.json({ error: 'Failed to mirror Soulidity content transaction' }, { status: 500 })
  }
}
