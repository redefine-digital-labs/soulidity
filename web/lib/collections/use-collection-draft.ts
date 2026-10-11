'use client'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { collectionDraftStore, type CollectionDraftSnapshot } from './collection-draft-store'

/** One provider lifetime per scope. Serial saves preserve edit ordering; CAS
 * fails closed if another tab has advanced the same device-local draft. */
export function useCollectionDraft(scope: string, snapshot: CollectionDraftSnapshot,
  restore: (value: CollectionDraftSnapshot) => void) {
  const [ready, setReady] = useState(false), [status, setStatus] = useState('Loading local draft…')
  const [settled, setSettled] = useState(false)
  const revision = useRef(0), halted = useRef(false), alive = useRef(false)
  const failure = useRef<unknown>(null)
  const chain = useRef(Promise.resolve()), sequence = useRef(0), pending = useRef(0)
  const baseline = useRef<CollectionDraftSnapshot | null>(null)
  const restoreRef = useRef(restore)
  useLayoutEffect(() => { restoreRef.current = restore }, [restore])
  useEffect(() => {
    alive.current = true
    let cancelled = false
    collectionDraftStore.read(scope).then(result => {
      if (cancelled) return
      revision.current = result.revision
      baseline.current = result.draft ?? snapshot
      if (result.draft) restoreRef.current(result.draft)
      setReady(true)
      setSettled(true)
    }).catch(error => {
      if (cancelled) return
      halted.current = true; setStatus(`Draft could not be opened. Existing data was not replaced. ${String(error.message ?? error)}`)
      setSettled(true)
    })
    return () => { cancelled = true; alive.current = false }
  }, [scope])
  const save = useCallback((value: CollectionDraftSnapshot) => {
    const version = ++sequence.current; pending.current++
    // File references are immutable; copy all editable metadata immediately.
    const captured = { ...structuredClone({ fields: value.fields, rows: value.rows, errors: value.errors }),
      files: value.files.map(file => ({ ...file })) }
    if (alive.current) setStatus('Saving encrypted local draft… Keep this page open.')
    const task = chain.current.then(async () => {
      if (halted.current) throw failure.current ?? Error('Saving stopped. Keep this page open and retry, or reopen the latest draft.')
      revision.current = await collectionDraftStore.write(scope, revision.current, captured)
      baseline.current = captured
      if (alive.current && version === sequence.current) setStatus('Draft saved on this device only. Reopen Create Collection to continue; clearing browser data removes it.')
    }).catch(error => {
      failure.current ??= error
      halted.current = true
      if (alive.current) setStatus(`Draft NOT saved. Keep this page open. ${String(error.message ?? error)}`)
      throw error
    }).finally(() => { pending.current-- })
    chain.current = task.catch(() => {})
    return task
  }, [scope])
  useEffect(() => {
    if (!ready) return
    const prior = baseline.current
    if (prior && JSON.stringify([prior.fields, prior.rows, prior.errors]) === JSON.stringify([snapshot.fields, snapshot.rows, snapshot.errors])
      && prior.files.length === snapshot.files.length && prior.files.every((file, i) => file.role === snapshot.files[i].role
        && file.row === snapshot.files[i].row && file.file === snapshot.files[i].file)) {
      if (!pending.current) setStatus('Draft saved on this device only. Reopen Create Collection to continue; clearing browser data removes it.')
      return
    }
    void save(snapshot).catch(() => {})
  }, [ready, snapshot, save])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (pending.current || halted.current) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])
  return { ready, settled, status, save, retry: () => {
    if (!ready) { window.location.reload(); return }
    halted.current = false; failure.current = null; void save(snapshot).catch(() => {})
  } }
}
