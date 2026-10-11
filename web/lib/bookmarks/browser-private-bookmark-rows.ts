import { profileReadStep, assertPrivateWalletBookmarksDeployment, type PrivateWalletBookmarksDeployment } from '@soulidity/sdk'
import { createNativeReceiveClient } from '../animacraft/native-receive'
import { readBrowserSoulDetail, type BrowserSoulDetailConfig } from '../soulidity/browser-soul-detail'
import type { ChainSoulDetail } from '../soulidity/soul-detail-model'
import { PRIVATE_BOOKMARK_MAX_BYTES, bookmarkCheck as check, bookmarkId, type PrivateBookmarkEntry } from './private-bookmark-library'

export type PrivateBookmarkRow = Readonly<PrivateBookmarkEntry & (
  { status: 'AVAILABLE'; detail: ChainSoulDetail; error: null }
  | { status: 'UNAVAILABLE'; detail: null; error: string }
)>
export interface PrivateBookmarkRowsPage {
  page: number; pageCount: number; total: number; rows: readonly PrivateBookmarkRow[]
  hasPrevious: boolean; hasNext: boolean; partial: boolean
}
export const PRIVATE_BOOKMARK_PAGE_SIZE = 20

/** At most one page of public details is kept, with four concurrent readers.
 * Every private entry remains addressable through pagination, including failed
 * details. A failed hydration is not permission to remove it from the library.
 * The caller must discard this instance on wallet/client/release replacement.
 */
export function createBrowserPrivateBookmarkRows(params: {
  entries: readonly PrivateBookmarkEntry[]; owner: string; deployment: PrivateWalletBookmarksDeployment
  config: BrowserSoulDetailConfig; signal: AbortSignal
}, dependencies: { client?: typeof createNativeReceiveClient; detail?: typeof readBrowserSoulDetail } = {}) {
  const { signal: lifetime, owner } = params, deployment = assertPrivateWalletBookmarksDeployment(params.deployment)
  const config = structuredClone(params.config), entries = structuredClone(params.entries)
  check(bookmarkId(owner) && config.chainIdentifier === deployment.chainIdentifier
    && config.native.soulidityOriginalPackageId === deployment.originalPackageId
    && config.native.soulidityCallablePackageId === deployment.callablePackageId
    && config.native.soulidityCallableDigest === deployment.callableDigest, 'ROWS_RELEASE_MISMATCH')
  check(Array.isArray(entries) && entries.length <= Math.floor(PRIVATE_BOOKMARK_MAX_BYTES / 66), 'ROWS_BUDGET')
  const seen = new Set<string>()
  for (const entry of entries) {
    check(entry && Object.keys(entry).length === 2 && bookmarkId(entry.soulId) && !seen.has(entry.soulId)
      && typeof entry.createdAt === 'string' && entry.createdAt.length <= 32 && Number.isFinite(Date.parse(entry.createdAt))
      && new Date(entry.createdAt).toISOString() === entry.createdAt, 'ROWS_ENTRY_INVALID')
    seen.add(entry.soulId)
  }
  check(new TextEncoder().encode(JSON.stringify(entries)).length <= PRIVATE_BOOKMARK_MAX_BYTES, 'ROWS_BUDGET')
  lifetime.throwIfAborted()
  const client = (dependencies.client ?? createNativeReceiveClient)(lifetime), detail = dependencies.detail ?? readBrowserSoulDetail
  const pageCount = Math.max(1, Math.ceil(entries.length / PRIVATE_BOOKMARK_PAGE_SIZE))
  let current: PrivateBookmarkRowsPage | null = null, busy = false
  async function read(page: number, retry: boolean): Promise<PrivateBookmarkRowsPage> {
    lifetime.throwIfAborted(); check(!busy, 'ROWS_BUSY')
    check(Number.isSafeInteger(page) && page >= 0 && page < pageCount, 'ROWS_PAGE_INVALID')
    const cached = retry ? current : null
    check(!retry || cached && cached.page === page, 'ROWS_RETRY_UNAVAILABLE')
    busy = true
    const cancel = new AbortController(), signal = AbortSignal.any([lifetime, cancel.signal, AbortSignal.timeout(120000)])
    try {
      const selected = entries.slice(page * PRIVATE_BOOKMARK_PAGE_SIZE, (page + 1) * PRIVATE_BOOKMARK_PAGE_SIZE)
      const rows: PrivateBookmarkRow[] = new Array(selected.length)
      let position = 0
      await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
        while (position < selected.length) {
          signal.throwIfAborted(); const index = position++, entry = selected[index], prior = cached?.rows[index]
          if (prior?.status === 'AVAILABLE') { rows[index] = prior; continue }
          try {
            const value = await profileReadStep(signal, () => detail({ soulId: entry.soulId, viewerAddress: owner,
              config, signal, getViewerAddress: () => { signal.throwIfAborted(); return owner } }, { client: () => client }))
            signal.throwIfAborted()
            check(value.onChainId === entry.soulId && value.originalPackageId === deployment.originalPackageId
              && value.viewerAddress === owner, 'ROWS_DETAIL_SCOPE_MISMATCH')
            rows[index] = { ...entry, status: 'AVAILABLE', detail: value, error: null }
          } catch (error) {
            signal.throwIfAborted()
            rows[index] = { ...entry, status: 'UNAVAILABLE', detail: null,
              error: error instanceof Error ? error.message : 'Public Soul information is unavailable. Retry this page.' }
          }
        }
      }))
      signal.throwIfAborted()
      current = { page, pageCount, total: entries.length, rows, hasPrevious: page > 0, hasNext: page + 1 < pageCount,
        partial: rows.some(row => row.status === 'UNAVAILABLE') }
      return structuredClone(current)
    } finally { cancel.abort(); busy = false }
  }
  return {
    load: (page = 0) => read(page, false),
    retryFailed: () => { check(current, 'ROWS_RETRY_UNAVAILABLE'); return read(current.page, true) },
  }
}
