'use client'

import { useState } from 'react'

export function CollectionRecoveryDownload({ json, filename }: { json: string; filename: string }) {
  const [failed, setFailed] = useState(false)

  function download() {
    let url: string | undefined
    setFailed(false)
    try {
      url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.append(link)
      try { link.click() } finally { link.remove() }
    } catch {
      setFailed(true)
    } finally {
      if (url) {
        const retained = url
        window.setTimeout(() => URL.revokeObjectURL(retained), 1000)
      }
    }
  }

  return <div>
    <button type="button" className="text-xs underline" onClick={download}>Download recovery JSON</button>
    {failed && <p role="status" className="text-xs">Download could not start. Copy the recovery JSON below.</p>}
  </div>
}
