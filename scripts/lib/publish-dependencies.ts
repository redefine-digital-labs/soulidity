import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'

const MAX_PACKAGES = 4096
function packageId(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    throw new Error('Publish dependency has an invalid package ID')
  }
  const id = normalizeSuiAddress(value)
  if (!isValidSuiAddress(id) || BigInt(id) === 0n) throw new Error('Publish dependency has an invalid package ID')
  return id
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

/** Follow the exact immutable linkage targets, not their original-address keys.
 * Missing/malformed package evidence must stop preparation before any signature.
 * This resolves a closure; it does not approve product versions or replace the
 * caller's reviewed-source/ABI and exact-transaction simulation gates. */
export function collectPublishDependencies(
  immediate: readonly string[], readPackage: (id: string) => unknown,
): string[] {
  if (!Array.isArray(immediate) || immediate.length === 0 || immediate.length > MAX_PACKAGES) {
    throw new Error('Publish dependency inventory is empty or exceeds the limit')
  }
  const queue: string[] = []
  const seen = new Set<string>()
  const enqueue = (value: unknown) => {
    const id = packageId(value)
    if (seen.has(id)) return
    if (seen.size >= MAX_PACKAGES) throw new Error('Publish dependency closure exceeds the limit')
    seen.add(id); queue.push(id)
  }
  immediate.forEach(enqueue)
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]
    let result: unknown
    try { result = readPackage(id) } catch {
      // Do not echo a CLI response or environment-bearing exception.
      throw new Error(`Cannot read publish dependency ${id}; preparation stopped`)
    }
    const object = record(result)
    const content = record(object?.content)
    const pkg = record(content?.Package)
    const links = record(pkg?.linkage_table)
    if (!object || !pkg || !links || packageId(object.objectId) !== id || packageId(pkg.id) !== id) {
      throw new Error(`Invalid package evidence for publish dependency ${id}`)
    }
    for (const [original, value] of Object.entries(links)) {
      packageId(original)
      const edge = record(value)
      const version = edge?.upgraded_version
      if (!edge || !(typeof version === 'string' && /^(0|[1-9][0-9]*)$/.test(version)
        || typeof version === 'number' && Number.isSafeInteger(version) && version >= 0)
        || BigInt(version) > 18446744073709551615n) {
        throw new Error(`Invalid linkage evidence for publish dependency ${id}`)
      }
      enqueue(edge.upgraded_id)
    }
  }
  return [...seen].sort()
}
