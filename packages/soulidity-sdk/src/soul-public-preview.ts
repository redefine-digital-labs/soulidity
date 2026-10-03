import { normalizeTags } from './tags'

export const SOUL_PUBLIC_PREVIEW_KEY = 'soul_public_preview_v1'
export const SOUL_PUBLIC_PREVIEW_SCHEMA = 'soulidity.soul-public-preview.v1'
export interface SoulPublicPreviewInput {
  tags: readonly string[]
  previewImages: readonly string[]
}
export interface SoulPublicPreview extends SoulPublicPreviewInput {
  schema: typeof SOUL_PUBLIC_PREVIEW_SCHEMA
}
export class SoulPublicPreviewError extends Error {
  readonly name = 'SoulPublicPreviewError'
  constructor(readonly code: 'SCHEMA_INVALID' | 'TAGS_INVALID' | 'PREVIEWS_INVALID' | 'URL_INVALID' | 'ENCODING_INVALID') {
    super(`SOUL_PUBLIC_PREVIEW_${code}`)
  }
}
function check(condition: unknown, code: SoulPublicPreviewError['code']): asserts condition {
  if (!condition) throw new SoulPublicPreviewError(code)
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const utf8 = new TextEncoder()
const MAX_ENCODED_BYTES = 64 * 1024
const wellFormed = (value: string) => Array.from(value).every(char => {
  const point = char.codePointAt(0)!
  return point < 0xd800 || point > 0xdfff
})

/** A public URL reference, not a claim that the host or image is trustworthy.
 * Do not pass protected content URLs, signed download links or decrypted data.
 * No network lookup is performed by this pure serialization boundary. */
function publicPreviewUrl(value: unknown): string {
  check(typeof value === 'string' && value.length > 0 && value.length <= 2048
    && wellFormed(value) && !/[\s\u0000-\u001f\u007f\\]/.test(value), 'URL_INVALID')
  let url: URL
  try { url = new URL(value) } catch { throw new SoulPublicPreviewError('URL_INVALID') }
  check((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && !url.hash,
    'URL_INVALID')
  // DNS hostnames only: local/private IP aliases (including URL-normalized
  // decimal/hex IPv4 and IPv6 literals) must not become public preview links.
  check(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(url.hostname)
    && !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname), 'URL_INVALID')
  for (const key of url.searchParams.keys()) {
    check(!/^(?:access[_-]?token|token|auth|authorization|api[_-]?key|key|password|secret|jwt|sig|signature|x-amz-.+|x-goog-.+)$/i.test(key),
      'URL_INVALID')
  }
  return value
}

/** Bounds are checked before normalization: never silently truncate user
 * entries. Trimming/lowercasing/deduplication retain existing tag semantics. */
export function validateSoulPublicPreview(input: unknown): Readonly<SoulPublicPreview> {
  check(record(input) && Object.keys(input).length === 3
    && ['schema', 'tags', 'previewImages'].every(key => Object.hasOwn(input, key))
    && input.schema === SOUL_PUBLIC_PREVIEW_SCHEMA, 'SCHEMA_INVALID')
  check(Array.isArray(input.tags) && input.tags.length <= 12, 'TAGS_INVALID')
  const tags: string[] = []
  for (const tag of input.tags) {
    check(typeof tag === 'string' && wellFormed(tag) && tag.trim().length <= 50
      && tag.trim().toLowerCase().length <= 50 && !/[\u0000-\u001f\u007f]/.test(tag), 'TAGS_INVALID')
    tags.push(tag)
  }
  check(Array.isArray(input.previewImages) && input.previewImages.length <= 8, 'PREVIEWS_INVALID')
  const previewImages = Array.from(input.previewImages, publicPreviewUrl)
  return Object.freeze({ schema: SOUL_PUBLIC_PREVIEW_SCHEMA,
    tags: Object.freeze(normalizeTags(tags)), previewImages: Object.freeze(previewImages) })
}

/** Stable field order is schema → tags → previewImages. */
export function encodeSoulPublicPreview(input: unknown): string {
  const text = JSON.stringify(validateSoulPublicPreview(input))
  check(utf8.encode(text).length <= MAX_ENCODED_BYTES, 'ENCODING_INVALID')
  return text
}

/** Strict stored representation: rejects duplicate JSON keys, unknown fields,
 * non-normalized tags and invisible discarded data, not merely parsed shape. */
export function decodeSoulPublicPreview(valueUtf8: unknown): Readonly<SoulPublicPreview> {
  check(typeof valueUtf8 === 'string' && utf8.encode(valueUtf8).length <= MAX_ENCODED_BYTES, 'ENCODING_INVALID')
  let raw: unknown
  try { raw = JSON.parse(valueUtf8) } catch { throw new SoulPublicPreviewError('ENCODING_INVALID') }
  const value = validateSoulPublicPreview(raw)
  check(JSON.stringify(value) === valueUtf8, 'ENCODING_INVALID')
  return value
}

export function buildSoulPublicPreviewStateConfig(input: SoulPublicPreviewInput): { key: typeof SOUL_PUBLIC_PREVIEW_KEY; valueUtf8: string } {
  check(record(input) && Object.keys(input).length === 2 && Object.hasOwn(input, 'tags')
    && Object.hasOwn(input, 'previewImages'), 'SCHEMA_INVALID')
  return { key: SOUL_PUBLIC_PREVIEW_KEY, valueUtf8: encodeSoulPublicPreview({
    schema: SOUL_PUBLIC_PREVIEW_SCHEMA, tags: input.tags, previewImages: input.previewImages,
  }) }
}
