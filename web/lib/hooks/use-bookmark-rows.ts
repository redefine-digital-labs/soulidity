'use client'

import { useEffect, useRef, useState } from 'react'
import { useCommittedSession, useSessionState, type SessionLease } from './use-committed-session'
import { useSuiClient } from '@mysten/dapp-kit'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { usePrivateBookmarks } from './use-private-bookmarks'
import { createBrowserPrivateBookmarkRows, PRIVATE_BOOKMARK_PAGE_SIZE, type PrivateBookmarkRowsPage } from '../bookmarks/browser-private-bookmark-rows'
import type { PrivateBookmarkEntry } from '../bookmarks/private-bookmark-library'
import { getBrowserSoulDetailConfig } from '../soulidity/browser-soul-detail'

type Scanner = ReturnType<typeof createBrowserPrivateBookmarkRows>
type Active = { identity: object; lease: SessionLease; abort: AbortController; scanner: Scanner; busy: boolean }
type View = { identity: object; page: PrivateBookmarkRowsPage | null; loading: boolean; error: string | null }
function unavailablePage(entries: readonly PrivateBookmarkEntry[], page: number, error: string): PrivateBookmarkRowsPage {
  const pageCount = Math.max(1, Math.ceil(entries.length / PRIVATE_BOOKMARK_PAGE_SIZE))
  if (!Number.isSafeInteger(page) || page < 0 || page >= pageCount) throw new Error('PRIVATE_BOOKMARK_ROWS_PAGE_INVALID')
  return { page, pageCount, total: entries.length, hasPrevious: page > 0, hasNext: page + 1 < pageCount, partial: entries.length > 0,
    rows: entries.slice(page * PRIVATE_BOOKMARK_PAGE_SIZE, (page + 1) * PRIVATE_BOOKMARK_PAGE_SIZE)
      .map(entry => ({ ...entry, status: 'UNAVAILABLE', detail: null, error })) }
}

/** Private IDs never enter a global query key, mutation cache or persistence.
 * This view owns one bounded page and destroys it on lock/wallet/client/release
 * changes, including away-and-back transitions before an old read finishes.
 */
export function useBookmarkRows(enabled = true) {
  const bookmarks = usePrivateBookmarks(), client = useSuiClient()
  const [retryGeneration, setRetryGeneration] = useState(0)
  let config: ReturnType<typeof getBrowserSoulDetailConfig> | null = null, configError: string | null = null
  try { config = getBrowserSoulDetailConfig() } catch (error) { configError = error instanceof Error ? error.message : 'Soul information is unavailable.' }
  const key = JSON.stringify([enabled, retryGeneration, bookmarks.privacyKey, bookmarks.owner, bookmarks.deployment, config, configError])
  const identity = useCommittedSession(key, bookmarks.entries, client, null)
  const active = useRef<Active | null>(null)
  const [visible, setView] = useSessionState<View>(identity, { identity, page: null,
    loading: enabled && bookmarks.entries !== null && !!bookmarks.owner && !!bookmarks.deployment, error: null })
  const matches = (owned: Active) => owned.lease.matches() && active.current === owned && !owned.abort.signal.aborted
  async function run(owned: Active, work: () => Promise<PrivateBookmarkRowsPage>, requestedPage = 0) {
    if (!matches(owned) || owned.busy) return
    owned.busy = true
    setView(old => ({ identity, page: old.identity === identity ? old.page : null, loading: true, error: null }))
    try {
      const page = await work()
      if (matches(owned)) setView({ identity, page, loading: false, error: null })
    } catch (error) {
      if (matches(owned)) {
        const reason = error instanceof Error ? error.message : 'Public Soul information is unavailable. Retry this page.'
        setView({ identity, page: bookmarks.entries === null ? null : unavailablePage(bookmarks.entries, requestedPage, reason),
          loading: false, error: reason })
      }
    } finally { owned.busy = false }
  }
  useEffect(() => {
    if (!enabled || bookmarks.entries === null || !bookmarks.owner || !bookmarks.deployment) {
      return
    }
    const lease = identity.capture()
    if (!lease?.matches()) return
    const abort = new AbortController(), grpc = (client as unknown as { grpc?: SuiGrpcClient }).grpc
    lease.requests.add(abort)
    let owned: Active | null = null
    void Promise.resolve().then(() => {
      if (!lease.matches() || abort.signal.aborted) return
      if (!config) throw new Error(configError ?? 'Soul release configuration is unavailable.')
      if (!grpc) throw new Error('Reconnect a wallet with the verified chain reader.')
      owned = { identity, lease, abort, busy: false, scanner: createBrowserPrivateBookmarkRows({ entries: bookmarks.entries!,
        owner: bookmarks.owner!, deployment: bookmarks.deployment!, config, signal: abort.signal }, { client: () => grpc }) }
      active.current = owned
      const captured = owned; void run(captured, () => captured.scanner.load())
    }).catch(error => {
      if (!lease.matches() || abort.signal.aborted) return
      const reason = error instanceof Error ? error.message : 'Soul information is unavailable.'
      setView({ identity, page: unavailablePage(bookmarks.entries!, 0, reason), loading: false, error: reason })
    })
    return () => { abort.abort(); lease.requests.delete(abort); if (active.current === owned) active.current = null }
    // The identity captures every private-view input and client reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity])
  const load = (page: number) => {
    const owned = active.current
    if (owned?.identity === identity) return run(owned, () => owned.scanner.load(page), page)
    if (enabled && bookmarks.entries !== null && identity.matches()) {
      const error = visible.error ?? 'Soul information is unavailable. Your private bookmarks are retained.'
      setView({ identity, page: unavailablePage(bookmarks.entries, page, error), loading: false, error })
    }
    return Promise.resolve()
  }
  return {
    page: visible.page, loading: visible.loading, error: visible.error,
    total: bookmarks.entries?.length ?? null,
    previous: () => load(Math.max(0, (visible.page?.page ?? 0) - 1)),
    next: () => load((visible.page?.page ?? 0) + 1),
    refresh: () => {
      if (!identity.matches()) return Promise.resolve()
      if (active.current?.identity !== identity) { setRetryGeneration(value => value + 1); return Promise.resolve() }
      return load(visible.page?.page ?? 0)
    },
    retryFailed: () => {
      if (!identity.matches()) return Promise.resolve()
      const owned = active.current
      if (owned?.identity === identity && visible.page && !visible.error)
        return run(owned, () => owned.scanner.retryFailed(), visible.page.page)
      if (owned?.identity === identity) return load(visible.page?.page ?? 0)
      setRetryGeneration(value => value + 1); return Promise.resolve()
    },
  }
}
