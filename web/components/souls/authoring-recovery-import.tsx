'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button, buttonStyles } from '@/components/ui/button'
import { usePublish } from '@/lib/hooks/use-publish'
import { useLogin } from '@/lib/hooks/use-login'
import { importSoulAuthoringRecovery, SOUL_AUTHORING_RECOVERY_MAX_TEXT, type SoulAuthoringRecovery } from '@/lib/soulidity/soul-authoring-recovery'
import { soulAuthoringRecoveryHref } from '@/lib/soulidity/soul-authoring-restore'

/** Selecting a file only stages it in memory. Restore is a separate explicit
 * action, and opening the saved operation never signs automatically. */
export function AuthoringRecoveryImport() {
  const flow = usePublish(async () => false), login = useLogin()
  const [staged, setStaged] = useState<SoulAuthoringRecovery | null>(null)
  const [error, setError] = useState<string | null>(null), [reading, setReading] = useState(false)
  const [restored, setRestored] = useState<{ href: string; isCurrent: () => boolean } | null>(null)
  const input = useRef<HTMLInputElement>(null), generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  const busy = reading || flow.loadingRecovery || ['building', 'signing', 'syncing'].includes(flow.status)
  async function choose(file: File) {
    const current = ++generation.current
    setReading(true); setError(null); setStaged(null); setRestored(null)
    try {
      if (!file.size || file.size > SOUL_AUTHORING_RECOVERY_MAX_TEXT) throw new Error('Recovery file exceeds the supported size.')
      const text = await file.text()
      if (current !== generation.current) return
      setStaged(importSoulAuthoringRecovery(text))
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : 'Cannot read this recovery file.')
    } finally { if (current === generation.current) setReading(false) }
  }
  async function restore() {
    if (!staged || busy) return
    const current = generation.current, result = await flow.importRecovery(staged)
    if (current === generation.current && result?.isCurrent()) setRestored(result)
  }
  return <section aria-label="Import creation recovery" className="space-y-3 rounded-xl border border-border p-4">
    <p className="text-sm">Continue a creation from another browser</p>
    <p className="text-xs text-muted">Use your latest recovery file and stop editing this creation on the other device. Private files stay encrypted. Checking and restoring does not sign or pay.</p>
    <input ref={input} type="file" accept="application/json,.json" className="hidden" disabled={busy}
      onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void choose(file) }} />
    <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>Choose Creation Recovery</Button>
    {staged && <div className="space-y-2 text-xs">
      <p>Creation: {staged.manifest.request.collection?.name ?? staged.manifest.request.mints[0]?.name}</p>
      <p className="break-all">Original wallet: {staged.manifest.request.author}</p>
      <p>{staged.history.length + (staged.head ? 1 : 0)} saved transactions. Their status must be checked; the file is not proof of completion.</p>
      {flow.suiWallet ? <Button disabled={busy} onClick={() => void restore()}>{busy ? 'Checking recovery…' : 'Check & Restore Creation'}</Button>
        : <Button onClick={login}>Connect Original Wallet</Button>}
    </div>}
    {(error || flow.error) && <p role="alert" className="text-xs text-danger">{error || flow.error}</p>}
    {flow.recovery && !restored?.isCurrent() && <Link href={soulAuthoringRecoveryHref(flow.recovery)}
      className={buttonStyles({ variant: 'outline' })}>Open This Device's Saved Creation</Link>}
    {restored?.isCurrent() && <div role="status" className="space-y-2 text-sm">
      <p>Creation restored on this device. No transaction was submitted.</p>
      <Link className={buttonStyles({ variant: 'primary' })} href={restored.href}>Open Restored Creation</Link>
    </div>}
  </section>
}
