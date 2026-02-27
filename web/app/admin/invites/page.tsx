'use client'
import { useEffect, useState } from 'react'

interface Invite {
  code: string
  created_at: string
  used_by: string | null
  active: number
}

export default function InvitesPage() {
  const [invites, setInvites] = useState<Invite[]>([])

  useEffect(() => { loadInvites() }, [])

  function loadInvites() {
    fetch('/api/invites').then(r => r.json()).then(setInvites)
  }

  async function createCode() {
    await fetch('/api/invites', { method: 'POST' })
    loadInvites()
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Invite Codes</h1>
        <button onClick={createCode} className="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-700">
          Generate Code
        </button>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left text-sm text-gray-500">
            <th className="p-2">Code</th>
            <th className="p-2">Status</th>
            <th className="p-2">Used By</th>
            <th className="p-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {invites.map(inv => (
            <tr key={inv.code} className="border-b hover:bg-gray-50">
              <td className="p-2 font-mono font-bold">{inv.code}</td>
              <td className="p-2">
                <span className={`px-2 py-0.5 rounded text-xs ${inv.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {inv.active ? 'Active' : 'Used'}
                </span>
              </td>
              <td className="p-2 text-sm text-gray-500">{inv.used_by ?? '-'}</td>
              <td className="p-2 text-sm text-gray-500">{new Date(inv.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
