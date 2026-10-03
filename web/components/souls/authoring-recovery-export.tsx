'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

export function AuthoringRecoveryExport({ disabled, onExport }: {
  disabled: boolean
  onExport: () => Promise<{ text: string; filename: string; isCurrent: () => boolean } | null>
}) {
  const [notice, setNotice] = useState<string | null>(null)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  async function download() {
    setNotice(null)
    let url: string | undefined
    try {
      const result = await onExport()
      if (!result || !mounted.current || !result.isCurrent()) return
      url = URL.createObjectURL(new Blob([result.text], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url; link.download = result.filename
      document.body.append(link); link.click(); link.remove()
      setNotice('Recovery download requested. Keep the file private; local creation records are unchanged.')
    } catch {
      setNotice('Download could not start. Local creation records are unchanged; retry export.')
    } finally {
      if (url) { const retained = url; window.setTimeout(() => URL.revokeObjectURL(retained), 1000) }
    }
  }
  return <div className="space-y-2">
    <Button variant="outline" disabled={disabled} onClick={() => void download()}>Export Creation Recovery</Button>
    <p className="text-xs text-muted">Includes encrypted private files, public metadata and saved transaction signatures. Keep private. Export does not submit a transaction or prove completion.</p>
    {notice && <p role="status" className="text-xs text-muted">{notice}</p>}
  </div>
}
