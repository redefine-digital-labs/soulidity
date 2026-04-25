import { PrismaRuntime } from '@db/prisma-client'
import { prisma } from '@/lib/prisma'

export const SOUL_UPLOAD_TOKEN_VALID_MS = 15 * 60 * 1000
export const SOUL_UPLOAD_WRITE_RATE_LIMIT = {
  max: 10,
  windowMs: 5 * 60 * 1000,
} as const

export const SOUL_UPLOAD_KINDS = ['persona-sprite', 'soul-content'] as const
export type SoulUploadKind = (typeof SOUL_UPLOAD_KINDS)[number]

export const SOUL_UPLOAD_TYPES = ['public', 'encrypted'] as const
export type SoulUploadType = (typeof SOUL_UPLOAD_TYPES)[number]

const SOUL_UPLOAD_NONCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SoulUploadTokenPayload {
  kind: SoulUploadKind
  uploadType: SoulUploadType
  memberId: string
  nonce: string
}

export interface SoulUploadBindingInput {
  memberId: string
  nonce: string
  blobUrl: string
  pathname: string
  contentType: string
  kind: SoulUploadKind
  uploadType: SoulUploadType
}

export interface ConsumedSoulUploadBinding {
  memberId: string
  nonce: string
  blobUrl: string
  pathname: string
  contentType: string
  kind: SoulUploadKind
  uploadType: SoulUploadType
}

export type ConsumeSoulUploadBindingResult =
  | { ok: true; binding: ConsumedSoulUploadBinding }
  | { ok: false; status: number; error: string; cleanupBlobUrl?: string }

// Per-kind+uploadType allowlists. The legacy `validateSoulUploadFile`
// signature check still runs server-side after we fetch the staged blob, so
// these lists only need to keep accidental mis-uploads out of the staging
// store; the source-of-truth validation is in `runSoulUploadPipeline`.
const PERSONA_SPRITE_PUBLIC_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
const PERSONA_SPRITE_ENCRYPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
const SOUL_CONTENT_PUBLIC_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
] as const
const SOUL_CONTENT_ENCRYPTED_TYPES = [
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
  'application/json',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const

export function getAllowedContentTypesFor(kind: SoulUploadKind, uploadType: SoulUploadType): readonly string[] {
  if (kind === 'persona-sprite') {
    return uploadType === 'public' ? PERSONA_SPRITE_PUBLIC_TYPES : PERSONA_SPRITE_ENCRYPTED_TYPES
  }
  return uploadType === 'public' ? SOUL_CONTENT_PUBLIC_TYPES : SOUL_CONTENT_ENCRYPTED_TYPES
}

export function isAllowedContentTypeFor(kind: SoulUploadKind, uploadType: SoulUploadType, contentType: string): boolean {
  return getAllowedContentTypesFor(kind, uploadType).includes(contentType as (typeof PERSONA_SPRITE_PUBLIC_TYPES)[number])
}

export function isValidSoulUploadNonce(value: unknown): value is string {
  return typeof value === 'string' && SOUL_UPLOAD_NONCE_PATTERN.test(value)
}

export function isSoulUploadKind(value: unknown): value is SoulUploadKind {
  return typeof value === 'string' && (SOUL_UPLOAD_KINDS as readonly string[]).includes(value)
}

export function isSoulUploadType(value: unknown): value is SoulUploadType {
  return typeof value === 'string' && (SOUL_UPLOAD_TYPES as readonly string[]).includes(value)
}

export interface ParsedSoulUploadClientPayload {
  kind: SoulUploadKind
  uploadType: SoulUploadType
  nonce: string
}

export function parseSoulUploadClientPayload(raw: string | null): ParsedSoulUploadClientPayload | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { kind?: unknown; uploadType?: unknown; nonce?: unknown }
    if (!isSoulUploadKind(parsed.kind)) return null
    if (!isSoulUploadType(parsed.uploadType)) return null
    if (!isValidSoulUploadNonce(parsed.nonce)) return null
    return { kind: parsed.kind, uploadType: parsed.uploadType, nonce: parsed.nonce }
  } catch {
    return null
  }
}

export function parseSoulUploadTokenPayload(raw: string | null | undefined): SoulUploadTokenPayload | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SoulUploadTokenPayload>
    if (!isSoulUploadKind(parsed.kind)) return null
    if (!isSoulUploadType(parsed.uploadType)) return null
    if (typeof parsed.memberId !== 'string' || !parsed.memberId) return null
    if (!isValidSoulUploadNonce(parsed.nonce)) return null
    return {
      kind: parsed.kind,
      uploadType: parsed.uploadType,
      memberId: parsed.memberId,
      nonce: parsed.nonce,
    }
  } catch {
    return null
  }
}

export async function pruneExpiredSoulUploadBindings(
  deleteBlob: (blobUrl: string) => Promise<void>,
  now = new Date(),
): Promise<void> {
  // Consumed rows still need blob deletion: `safeDelete` in /upload/from-blob
  // swallows transient outages, and dropping the row here would orphan the
  // staging blob with no later handle to retry. Vercel Blob `del` is
  // idempotent for already-removed blobs, so re-deleting in the success path
  // is a no-op.
  const expired = await prisma.soulUploadBinding.findMany({
    where: { expiresAt: { lt: now } },
    select: { id: true, blobUrl: true },
  })

  const reapableIds: string[] = []
  for (const binding of expired) {
    try {
      await deleteBlob(binding.blobUrl)
      reapableIds.push(binding.id)
    } catch (error) {
      console.error('[upload/token] failed to delete expired temp Vercel Blob', binding.blobUrl, error)
    }
  }

  if (reapableIds.length > 0) {
    await prisma.soulUploadBinding.deleteMany({
      where: { id: { in: reapableIds } },
    })
  }
}

export async function recordSoulUploadBinding(
  input: SoulUploadBindingInput,
  options: { deleteBlob: (blobUrl: string) => Promise<void> },
): Promise<void> {
  if (!isValidSoulUploadNonce(input.nonce)) return
  if (!isAllowedContentTypeFor(input.kind, input.uploadType, input.contentType)) return

  const now = new Date()
  await pruneExpiredSoulUploadBindings(options.deleteBlob, now)

  try {
    await prisma.soulUploadBinding.create({
      data: {
        memberId: input.memberId,
        nonce: input.nonce,
        blobUrl: input.blobUrl,
        pathname: input.pathname,
        contentType: input.contentType,
        kind: input.kind,
        uploadType: input.uploadType,
        expiresAt: new Date(now.getTime() + SOUL_UPLOAD_TOKEN_VALID_MS),
      },
    })
  } catch (error) {
    if (error instanceof PrismaRuntime.PrismaClientKnownRequestError && error.code === 'P2002') {
      // P2002 may originate from the `nonce` or `blobUrl` unique index. If a
      // different blob is already bound to this nonce (replay with reused
      // client nonce), the just-staged blob will never be consumable, so we
      // must delete it to avoid an orphan storage leak.
      const existingByNonce = await prisma.soulUploadBinding.findUnique({
        where: { nonce: input.nonce },
        select: { blobUrl: true },
      })
      if (existingByNonce && existingByNonce.blobUrl !== input.blobUrl) {
        try {
          await options.deleteBlob(input.blobUrl)
        } catch (deleteError) {
          console.error(
            '[upload/token] failed to delete duplicate-nonce orphan blob',
            input.blobUrl,
            deleteError,
          )
        }
      }
      console.warn('[upload/token] duplicate soul upload binding ignored', {
        nonce: input.nonce,
        blobUrl: input.blobUrl,
        existingBlobUrl: existingByNonce?.blobUrl ?? null,
      })
      return
    }
    throw error
  }
}

export async function consumeSoulUploadBinding(params: {
  memberId: string
  nonce: string
  blobUrl: string
  expectedKind: SoulUploadKind
  expectedUploadType: SoulUploadType
}): Promise<ConsumeSoulUploadBindingResult> {
  if (!isValidSoulUploadNonce(params.nonce)) {
    return { ok: false, status: 400, error: 'uploadNonce is invalid' }
  }

  const result = await prisma.$transaction(async (tx) => {
    const binding = await tx.soulUploadBinding.findUnique({
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
    if (binding.kind !== params.expectedKind || binding.uploadType !== params.expectedUploadType) {
      return {
        ok: false,
        status: 400,
        error: 'Upload binding kind/type does not match this finalize request',
        cleanupBlobUrl: binding.blobUrl,
      } as const
    }
    if (binding.consumedAt) {
      return { ok: false, status: 409, error: 'Upload binding has already been consumed' } as const
    }
    if (binding.expiresAt.getTime() <= Date.now()) {
      return { ok: false, status: 410, error: 'Upload binding has expired', cleanupBlobUrl: binding.blobUrl } as const
    }
    if (!isAllowedContentTypeFor(binding.kind as SoulUploadKind, binding.uploadType as SoulUploadType, binding.contentType)) {
      return { ok: false, status: 400, error: 'Upload binding has an invalid content type', cleanupBlobUrl: binding.blobUrl } as const
    }

    const consumed = await tx.soulUploadBinding.updateMany({
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
        kind: binding.kind as SoulUploadKind,
        uploadType: binding.uploadType as SoulUploadType,
      },
    } as const
  })
  return result
}
