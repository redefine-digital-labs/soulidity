/**
 * Shared helper for resolving soul asset access for the desktop download flow.
 *
 * Wraps `resolveSoulAccessPayload` with a simplified interface suitable for
 * the desktop persona-bundle endpoint. Existing human/agent access routes
 * are not modified — this is an additive helper.
 */

import { resolveSoulAccessPayload, SoulAccessDeniedError } from './access'
import { getRequiredSoulidityEnv } from './env'
import { findSoulAssetDetailByRouteId, toSoulAssetDetail } from './repository'
import type { SoulAccessResponse } from './types'

export type DesktopSoulAccessResult =
  | {
      ok: true
      blobUrl: string
      blobId: string
      isEncrypted: boolean
      accessPayload: SoulAccessResponse
    }
  | {
      ok: false
      error: string
      status: number
    }

export async function resolveDesktopSoulAccess(params: {
  soulOnChainId: string
  viewerAddresses: string[]
  viewerMemberId?: string
}): Promise<DesktopSoulAccessResult> {
  const soulRow = await findSoulAssetDetailByRouteId(params.soulOnChainId)
  if (!soulRow) {
    return { ok: false, error: 'Soul not found', status: 404 }
  }

  const soul = toSoulAssetDetail(soulRow, {
    viewerMemberId: params.viewerMemberId ?? null,
    viewerAddresses: params.viewerAddresses,
    quote: null,
  })

  try {
    const accessPayload = await resolveSoulAccessPayload({
      soul,
      viewerAddresses: params.viewerAddresses,
      packageId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'),
    })

    return {
      ok: true,
      blobUrl: accessPayload.artifact.walrusBlobUrl,
      blobId: accessPayload.artifact.walrusBlobId,
      isEncrypted: Boolean(soul.sealSidecar),
      accessPayload,
    }
  } catch (error) {
    if (error instanceof SoulAccessDeniedError) {
      return { ok: false, error: error.message, status: error.status }
    }
    throw error
  }
}
