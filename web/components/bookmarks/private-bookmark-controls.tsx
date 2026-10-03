'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePrivateBookmarks, type PrivateBookmarksActions } from '@/lib/hooks/use-private-bookmarks'

export function PrivateBookmarkControls() {
  const actions = usePrivateBookmarks()
  return <Controls key={actions.privacyKey} actions={actions} />
}

function Controls({ actions }: { actions: PrivateBookmarksActions }) {
  const [localError, setLocalError] = useState<string | null>(null)
  const [fileBusy, setFileBusy] = useState(false)
  const [candidate, setCandidate] = useState<{ encoded: string; requestId: string; backupOnly: boolean } | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [confirmRebase, setConfirmRebase] = useState(false)
  const live = useRef(true), fileAttempt = useRef(0)
  useEffect(() => { live.current = true; return () => { live.current = false; fileAttempt.current++ } }, [])
  const working = actions.busy || actions.loading || fileBusy
  const invoke = async (operation: () => void | Promise<unknown>) => {
    if (!live.current) return
    setLocalError(null)
    try { await operation() } catch (error) {
      if (live.current) setLocalError(error instanceof Error ? error.message : 'Unable to update private bookmarks.')
    }
  }
  const selectFile = (file: File, backupOnly: boolean) => {
    const attempt = ++fileAttempt.current
    setCandidate(null); setConfirmation(''); setFileBusy(true)
    void invoke(async () => {
      try {
        if (file.size > 30 * 1024 * 1024) throw new Error('Encrypted recovery file is too large.')
        const encoded = await file.text()
        if (!live.current || attempt !== fileAttempt.current) return
        // Only display the public request identifier here. The provider validates
        // the complete schema, scope, ciphertext and payment evidence on import.
        const value = JSON.parse(encoded) as { record?: { context?: { requestId?: unknown } } }
        const requestId = value?.record?.context?.requestId
        if (typeof requestId !== 'string' || !/^[0-9a-f]{64}$/.test(requestId) || /^0+$/.test(requestId))
          throw new Error('The recovery file has no valid public request ID.')
        setCandidate({ encoded, requestId, backupOnly })
      } finally { if (live.current && attempt === fileAttempt.current) setFileBusy(false) }
    })
  }
  return <section aria-label="Private bookmarks" className="ph-no-capture space-y-3 rounded-xl border border-[var(--border-soft)] p-4 [&_button]:max-w-full [&_button]:whitespace-normal">
    <h3 className="text-sm font-semibold">Private bookmarks</h3>
    <p className="text-xs text-muted">Only your wallet can unlock this encrypted bookmark list. No public bookmark count is published.</p>
    {!actions.connected ? <p className="text-sm text-muted">Connect your wallet to access private bookmarks.</p> : <>
      <div className="flex flex-wrap gap-2">
        {actions.locked && <Button size="sm" disabled={working} onClick={() => void invoke(actions.unlock)}>Unlock private bookmarks</Button>}
        <Button size="sm" variant="outline" disabled={working} onClick={() => void invoke(actions.refresh)}>Refresh bookmark head</Button>
        <Button size="sm" variant="outline" onClick={actions.lock}>Lock private bookmarks</Button>
      </div>
      {actions.locked && <p className="text-sm text-muted">Bookmarks are locked or unavailable, not empty. Unlock to view them.</p>}
      {!actions.locked && !actions.error && actions.entries?.length === 0 && <p className="text-sm text-muted">No private bookmarks yet.</p>}
      {actions.endEpoch !== null && !actions.locked && <p className="text-xs text-muted">Encrypted storage expires at Walrus epoch {actions.endEpoch}.</p>}
      {actions.endEpoch === null && !actions.locked && actions.revision !== '0'
        && <p className="text-xs text-muted">This verified local copy does not establish the current remote storage expiry. Unlock again to refresh storage validity.</p>}
      <p className="text-xs text-muted">Adding, removing or renewing bookmarks pays for encrypted storage and a separate bookmark-head update. Review the displayed WAL and SUI costs before approval.</p>
      {!actions.writesEnabled && <p role="status" className="text-xs text-muted">Bookmark writes are disabled for this release. Unlock and transaction queries remain available.</p>}
      <Button size="sm" variant="outline" disabled={working || actions.pending || actions.locked || !actions.writesEnabled}
        onClick={() => void invoke(actions.renew)}>Renew encrypted bookmark storage</Button>
      {actions.pending && <div className="space-y-2 rounded-lg border border-[var(--border-soft)] p-3 text-sm">
        <p>An encrypted bookmark request is pending. Query its original transactions first. Unknown signed transactions cannot be discarded or replaced.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={working} onClick={() => void invoke(actions.query)}>Query bookmark request</Button>
          <Button size="sm" variant="outline" disabled={working || !actions.writesEnabled} onClick={() => void invoke(actions.retry)}>Resume same bookmark request</Button>
          <Button size="sm" variant="outline" disabled={working || !actions.writesEnabled} onClick={() => setConfirmRebase(true)}>Review bookmark rebase</Button>
          <Button size="sm" variant="outline" disabled={working} onClick={() => setConfirmArchive(true)}>Review bookmark archive</Button>
        </div>
        {confirmRebase && <div className="space-y-2">
          <p>Rebase unlocks the latest bookmarks and preserves the original requested add or remove action. It creates a new request and may require new paid storage; previous paid storage is retained.</p>
          <Button size="sm" disabled={working || !actions.writesEnabled} onClick={() => void invoke(async () => {
            await actions.rebase(); if (live.current) setConfirmRebase(false)
          })}>Confirm bookmark rebase</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmRebase(false)}>Cancel rebase</Button>
        </div>}
        {confirmArchive && <div className="space-y-2">
          <p>Archive retains encrypted recovery and does not delete existing bookmarks or paid storage. An unknown signed transaction must first be resolved.</p>
          <Button size="sm" disabled={working} onClick={() => void invoke(async () => {
            await actions.dismiss(); if (live.current) setConfirmArchive(false)
          })}>Confirm bookmark archive</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmArchive(false)}>Cancel archive</Button>
        </div>}
      </div>}
      <details className="space-y-2 text-xs text-muted">
        <summary className="cursor-pointer">Encrypted bookmark backup and recovery</summary>
        <p>Download encrypted recovery before clearing browser data or changing devices. Only the original wallet can unlock it. Expired storage is not an empty bookmark list.</p>
        <Button size="sm" variant="outline" disabled={!actions.canExport} onClick={() => void invoke(() => {
          const encoded = actions.exportRecovery(), url = URL.createObjectURL(new Blob([encoded], { type: 'application/json' }))
          try { const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'soulidity-private-bookmark-recovery.json'; anchor.click() }
          finally { URL.revokeObjectURL(url) }
        })}>Download encrypted bookmark recovery</Button>
        {(['Restore pending bookmark request', 'Unlock current bookmark backup'] as const).map((label, i) => <label key={label} className="block">
          {label}
          <input type="file" accept="application/json,.json" className="mt-1 block max-w-full" disabled={working}
            onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) selectFile(file, i === 1) }} />
        </label>)}
        {candidate && <div className="space-y-2 rounded-lg border border-[var(--border-soft)] p-3">
          <p>This file claims public request ID <span className="break-all font-mono">{candidate.requestId}</span>. Verify this against your intended backup before continuing.</p>
          <label className="block">Confirm public bookmark request ID
            <Input value={confirmation} autoComplete="off" onChange={event => setConfirmation(event.target.value)} disabled={working} />
          </label>
          <Button size="sm" disabled={working || confirmation !== candidate.requestId} onClick={() => void invoke(async () => {
            if (confirmation !== candidate.requestId) throw new Error('Confirm the exact public request ID first.')
            await actions.importRecovery(candidate.encoded, candidate.backupOnly)
            if (live.current) { setCandidate(null); setConfirmation('') }
          })}>{candidate.backupOnly ? 'Confirm and unlock bookmark backup' : 'Confirm and restore bookmark request'}</Button>
          <Button size="sm" variant="ghost" disabled={working} onClick={() => { setCandidate(null); setConfirmation('') }}>Cancel import</Button>
        </div>}
      </details>
    </>}
    {working && <p role="status" className="text-sm text-muted">Working on private bookmarks…</p>}
    {(actions.error || localError) && <p role="alert" className="break-words text-sm text-danger">{actions.error || localError}</p>}
    {actions.notice && <p role="status" className="text-sm text-muted">{actions.notice}</p>}
  </section>
}
