/** Public-only payloads. Actor/type/channel/counts and accepted-answer authority
 * live in chain objects, never in an untrusted document. */
export const COMMUNITY_DOCUMENT_MAX_BYTES = 1024 * 1024
export interface PublicPostDocument { schema: 'soulidity.public-post.v1'; title: string; content: string; tags: string[] }
export interface PublicCommentDocument { schema: 'soulidity.public-comment.v1'; content: string }
export type PublicCommunityDocument = PublicPostDocument | PublicCommentDocument
const encoder = new TextEncoder()
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`COMMUNITY_DOCUMENT_${code}`) }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  check(value && typeof value === 'object' && !Array.isArray(value), 'SCHEMA_INVALID')
  check(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'FIELDS_INVALID')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number): string {
  check(typeof value === 'string', 'TEXT_INVALID')
  const result = value.trim()
  // Deliberately retain original JS UTF-16 length limits, not code-point counts.
  check(result.length > 0 && result.length <= max, 'TEXT_LENGTH_INVALID')
  return result
}
function bounded<T extends PublicCommunityDocument>(value: T): T {
  check(encoder.encode(JSON.stringify(value)).byteLength <= COMMUNITY_DOCUMENT_MAX_BYTES, 'BYTE_LIMIT')
  return value
}
/** Composer normalization preserves the original case-sensitive tag semantics. */
export function createPublicPostDocument(input: { title: unknown; content: unknown; tags?: unknown }): PublicPostDocument {
  const raw = input.tags == null ? [] : typeof input.tags === 'string' ? input.tags.split(',') : input.tags
  check(Array.isArray(raw) && raw.every(tag => typeof tag === 'string'), 'TAGS_INVALID')
  const tags = [...new Set(raw.map(tag => tag.trim()).filter(Boolean))]
  return bounded({ schema: 'soulidity.public-post.v1', title: text(input.title, 500), content: text(input.content, 50000), tags })
}
export function createPublicCommentDocument(content: unknown): PublicCommentDocument {
  return bounded({ schema: 'soulidity.public-comment.v1', content: text(content, 10000) })
}
/** Readers reject noncanonical text/tags rather than silently changing published
 * bytes. No opaque extra fields (credentials, voter identities, private reports). */
export function validatePublicCommunityDocument(input: unknown): PublicCommunityDocument {
  const schema = (input as { schema?: unknown } | null)?.schema
  if (schema === 'soulidity.public-post.v1') {
    const value = object(input, ['schema', 'title', 'content', 'tags'])
    check(Array.isArray(value.tags), 'TAGS_INVALID')
    const normalized = createPublicPostDocument({ title: value.title, content: value.content, tags: value.tags })
    check(value.title === normalized.title && value.content === normalized.content
      && JSON.stringify(value.tags) === JSON.stringify(normalized.tags), 'NONCANONICAL')
    return normalized
  }
  check(schema === 'soulidity.public-comment.v1', 'SCHEMA_INVALID')
  const value = object(input, ['schema', 'content']), normalized = createPublicCommentDocument(value.content)
  check(value.content === normalized.content, 'NONCANONICAL')
  return normalized
}
export function encodePublicCommunityDocument(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(validatePublicCommunityDocument(value)))
}
export function decodePublicCommunityDocument(bytes: Uint8Array): PublicCommunityDocument {
  check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= COMMUNITY_DOCUMENT_MAX_BYTES, 'BYTE_LIMIT')
  return validatePublicCommunityDocument(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
}
