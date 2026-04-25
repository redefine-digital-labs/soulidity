import { PrismaRuntime } from '@db/prisma-client'
import { prisma } from '@/lib/prisma'

export const SPRITE_UPLOAD_ALLOWED_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const SPRITE_UPLOAD_TOKEN_VALID_MS = 15 * 60 * 1000
export const SPRITE_UPLOAD_WRITE_RATE_LIMIT = {
  max: 10,
  windowMs: 5 * 60 * 1000,
} as const

const SPRITE_UPLOAD_NONCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SpriteUploadTokenPayload {
  kind: 'persona-sprite'
  memberId: string
  nonce: string
}

export interface SpriteUploadBindingInput {
  memberId: string
  nonce: string
  blobUrl: string
  pathname: string
  contentType: string
}

export interface ConsumedSpriteUploadBinding {
  memberId: string
  nonce: string
  blobUrl: string
  pathname: string
  contentType: string
}

export type ConsumeSpriteUploadBindingResult =
  | { ok: true; binding: ConsumedSpriteUploadBinding }
  | { ok: false; status: number; error: string; cleanupBlobUrl?: string }

export function isValidSpriteUploadNonce(value: unknown): value is string {
  return typeof value === 'string' && SPRITE_UPLOAD_NONCE_PATTERN.test(value)
}

export function parseSpriteUploadClientPayload(raw: string | null): { nonce: string } | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { nonce?: unknown; kind?: unknown }
    if (parsed.kind !== 'persona-sprite' || !isValidSpriteUploadNonce(parsed.nonce)) {
      return null
    }
    return { nonce: parsed.nonce }
  } catch {
    return null
  }
}

export function parseSpriteUploadTokenPayload(raw: string | null | undefined): SpriteUploadTokenPayload | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SpriteUploadTokenPayload>
    if (
      parsed.kind !== 'persona-sprite'
      || typeof parsed.memberId !== 'string'
      || !parsed.memberId
      || !isValidSpriteUploadNonce(parsed.nonce)
    ) {
      return null
    }
    return {
      kind: 'persona-sprite',
      memberId: parsed.memberId,
      nonce: parsed.nonce,
    }
  } catch {
    return null
  }
}

export function isAllowedSpriteContentType(contentType: string): boolean {
  return SPRITE_UPLOAD_ALLOWED_CONTENT_TYPES.includes(contentType as (typeof SPRITE_UPLOAD_ALLOWED_CONTENT_TYPES)[number])
}

export async function pruneExpiredSpriteUploadBindings(
  deleteBlob: (blobUrl: string) => Promise<void>,
  now = new Date(),
): Promise<void> {
  // Consumed rows still need blob deletion: `safeDelete` in /upload/from-blob
  // swallows transient outages, and dropping the row here would orphan the
  // staging blob with no later handle to retry. Vercel Blob `del` is
  // idempotent for already-removed blobs, so re-deleting in the success path
  // is a no-op.
  const expired = await prisma.soulSpriteUploadBinding.findMany({
    where: { expiresAt: { lt: now } },
    select: {
      id: true,
      blobUrl: true,
    },
  })

  const reapableIds: string[] = []
  for (const binding of expired) {
    try {
      await deleteBlob(binding.blobUrl)
      reapableIds.push(binding.id)
    } catch (error) {
      console.error('[upload/sprite-token] failed to delete expired temp Vercel Blob', binding.blobUrl, error)
    }
  }

  if (reapableIds.length > 0) {
    await prisma.soulSpriteUploadBinding.deleteMany({
      where: { id: { in: reapableIds } },
    })
  }
}

export async function recordSpriteUploadBinding(
  input: SpriteUploadBindingInput,
  options: { deleteBlob: (blobUrl: string) => Promise<void> },
): Promise<void> {
  if (!isValidSpriteUploadNonce(input.nonce) || !isAllowedSpriteContentType(input.contentType)) {
    return
  }

  const now = new Date()
  await pruneExpiredSpriteUploadBindings(options.deleteBlob, now)

  try {
    await prisma.soulSpriteUploadBinding.create({
      data: {
        memberId: input.memberId,
        nonce: input.nonce,
        blobUrl: input.blobUrl,
        pathname: input.pathname,
        contentType: input.contentType,
        expiresAt: new Date(now.getTime() + SPRITE_UPLOAD_TOKEN_VALID_MS),
      },
    })
  } catch (error) {
    if (error instanceof PrismaRuntime.PrismaClientKnownRequestError && error.code === 'P2002') {
      // P2002 may originate from the `nonce` or `blobUrl` unique index. If a
      // different blob is already bound to this nonce (replay with reused
      // client nonce), the just-staged blob will never be consumable, so we
      // must delete it to avoid an orphan storage leak.
      const existingByNonce = await prisma.soulSpriteUploadBinding.findUnique({
        where: { nonce: input.nonce },
        select: { blobUrl: true },
      })
      if (existingByNonce && existingByNonce.blobUrl !== input.blobUrl) {
        try {
          await options.deleteBlob(input.blobUrl)
        } catch (deleteError) {
          console.error(
            '[upload/sprite-token] failed to delete duplicate-nonce orphan sprite blob',
            input.blobUrl,
            deleteError,
          )
        }
      }
      console.warn('[upload/sprite-token] duplicate sprite upload binding ignored', {
        nonce: input.nonce,
        blobUrl: input.blobUrl,
        existingBlobUrl: existingByNonce?.blobUrl ?? null,
      })
      return
    }
    throw error
  }
}

export async function consumeSpriteUploadBinding(params: {
  memberId: string
  nonce: string
  blobUrl: string
}): Promise<ConsumeSpriteUploadBindingResult> {
  if (!isValidSpriteUploadNonce(params.nonce)) {
    return { ok: false, status: 400, error: 'uploadNonce is invalid' }
  }

  const result = await prisma.$transaction(async (tx) => {
    const binding = await tx.soulSpriteUploadBinding.findUnique({
      where: { nonce: params.nonce },
    })
    if (!binding) {
      return { ok: false, status: 409, error: 'Upload binding is not ready' } as const
    }
    if (binding.memberId !== params.memberId) {
      return { ok: false, status: 403, error: 'Upload binding does not belong to this member' } as const
    }
    if (binding.blobUrl !== params.blobUrl) {
      return { ok: false, status: 403, error: 'Upload binding does not match this blob URL' } as const
    }
    if (binding.consumedAt) {
      return { ok: false, status: 409, error: 'Upload binding has already been consumed' } as const
    }
    if (binding.expiresAt.getTime() <= Date.now()) {
      return { ok: false, status: 410, error: 'Upload binding has expired', cleanupBlobUrl: binding.blobUrl } as const
    }
    if (!isAllowedSpriteContentType(binding.contentType)) {
      return { ok: false, status: 400, error: 'Upload binding has an invalid content type', cleanupBlobUrl: binding.blobUrl } as const
    }

    const consumed = await tx.soulSpriteUploadBinding.updateMany({
      where: {
        nonce: params.nonce,
        memberId: params.memberId,
        blobUrl: params.blobUrl,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    })
    if (consumed.count !== 1) {
      return { ok: false, status: 409, error: 'Upload binding was consumed by another request' } as const
    }

    return {
      ok: true,
      binding: {
        memberId: binding.memberId,
        nonce: binding.nonce,
        blobUrl: binding.blobUrl,
        pathname: binding.pathname,
        contentType: binding.contentType,
      },
    } as const
  })
  return result
}
