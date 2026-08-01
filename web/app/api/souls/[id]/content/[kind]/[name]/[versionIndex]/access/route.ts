import { NextResponse } from 'next/server'
import { hasCredentialedSealServerConfigs, hasSealSessionConfig } from '@/lib/services/seal'
import {
  getAnonymousRateLimitFingerprint,
  getRequestIp,
  takeRateLimitToken,
} from '@/lib/rate-limit'
import { ContentAccessDeniedError, resolveContentAccessPayload } from '@/lib/soulidity/access'
import { requireHumanWalletIdentity } from '@/lib/soulidity/server'
import {
  findContentVersionByRouteId,
  findSoulAssetByRouteId,
} from '@/lib/soulidity/repository'
import {
  badRequest,
  decodeRouteName,
  parseContentKindParam,
  parseContentVersionIndexParam,
} from '@/lib/soulidity/content-route'
import { READ_PUBLIC } from '@soulidity/sdk'
import type { SoulContentVersionRecord } from '@soulidity/sdk'

export const dynamic = 'force-dynamic'

const HUMAN_CONTENT_ACCESS_RATE_LIMIT = {
  max: 45,
  windowMs: 60 * 1000,
} as const

const ANONYMOUS_CONTENT_ACCESS_RATE_LIMIT = {
  max: 30,
  windowMs: 60 * 1000,
} as const

// A slot is reachable without wallet auth or Seal configuration only when the
// resolver's `READ_PUBLIC` plaintext branch will fire — i.e., the slot is
// readable, the public read mode is set, the slot is not Seal-encrypted, and
// the on-chain `download_policy` is `public`. Sealed-public slots still go
// through the auth-required path because the response embeds Seal session
// parameters.
function isPublicPlaintextEligible(version: SoulContentVersionRecord) {
  if (version.deletedAt != null || version.purgedAt != null) return false
  if ((version.readModeMask & READ_PUBLIC) === 0) return false
  if (version.sealEncrypted) return false
  return version.downloadPolicy === 'public'
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; kind: string; name: string; versionIndex: string }> },
) {
  const { id, kind: kindParam, name: nameParam, versionIndex: versionIndexParam } = await params
  const kind = parseContentKindParam(kindParam)
  if (kind == null) return badRequest('kind must be a content kind id or known kind name')
  const versionIndex = parseContentVersionIndexParam(versionIndexParam)
  if (versionIndex == null) return badRequest('versionIndex must be a non-negative integer')
  const name = decodeRouteName(nameParam).trim()
  if (!name) return badRequest('name is required')

  const [soul, version] = await Promise.all([
    findSoulAssetByRouteId(id),
    findContentVersionByRouteId(id, kind, name, versionIndex),
  ])
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }
  if (!version) {
    return NextResponse.json({ error: 'Content version not found' }, { status: 404 })
  }

  const soulRef = {
    onChainId: soul.onChainId,
    stateOnChainId: soul.stateOnChainId,
    contentOnChainId: soul.contentOnChainId,
    paidAccessListOnChainId: soul.paidAccessListOnChainId,
  }

  // Public plaintext slots return a Walrus URL with no Seal session, so
  // anonymous visitors must be able to reach the resolver without wallet auth
  // or Seal configuration. Per-IP/fingerprint rate limiting protects the
  // anonymous bucket from abuse.
  if (isPublicPlaintextEligible(version)) {
    const fingerprint =
      getRequestIp(request.headers)
      ?? getAnonymousRateLimitFingerprint(request.headers)
      ?? 'shared'
    const anonymousRateLimit = await takeRateLimitToken(
      `anon-content-access:${fingerprint}`,
      ANONYMOUS_CONTENT_ACCESS_RATE_LIMIT,
    )
    if (anonymousRateLimit.limited) {
      return NextResponse.json(
        { error: 'Too many Soulidity content access requests, try again later' },
        { status: 429, headers: { 'Retry-After': String(anonymousRateLimit.retryAfterSeconds) } },
      )
    }

    try {
      const payload = await resolveContentAccessPayload({
        soul: soulRef,
        version,
        viewerAddresses: [],
      })
      return NextResponse.json(payload)
    } catch (error: unknown) {
      if (error instanceof ContentAccessDeniedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      console.error('[soul-content-access] Failed to resolve public plaintext content access payload', {
        soulId: soul.onChainId,
        kind,
        name,
        versionIndex,
        error,
      })
      return NextResponse.json({ error: 'Failed to prepare Soulidity content access payload' }, { status: 500 })
    }
  }

  // Sealed / owner / grant / paid paths embed Seal session parameters and
  // expose access keyed to the viewer's wallet — these still require an
  // authenticated wallet, configured Seal session, and per-member rate limit.
  const auth = await requireHumanWalletIdentity()
  if ('error' in auth) {
    return auth.error
  }

  const rateLimit = await takeRateLimitToken(
    `human-content-access:${auth.identity.memberId}`,
    HUMAN_CONTENT_ACCESS_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity content access requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  if (!hasSealSessionConfig()) {
    return NextResponse.json({ error: 'Seal session is not configured' }, { status: 503 })
  }
  if (hasCredentialedSealServerConfigs()) {
    return NextResponse.json(
      { error: 'Credentialed Seal key servers are not supported for browser access' },
      { status: 503 },
    )
  }

  try {
    const payload = await resolveContentAccessPayload({
      soul: soulRef,
      version,
      viewerAddresses: auth.walletAddresses,
    })
    return NextResponse.json(payload)
  } catch (error: unknown) {
    if (error instanceof ContentAccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[soul-content-access] Failed to resolve Soulidity content access payload', {
      memberId: auth.identity.memberId,
      soulId: soul.onChainId,
      kind,
      name,
      versionIndex,
      error,
    })
    return NextResponse.json({ error: 'Failed to prepare Soulidity content access payload' }, { status: 500 })
  }
}
