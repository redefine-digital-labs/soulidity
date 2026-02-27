'use client'
import { useEffect, useState } from 'react'

interface Member {
  id: string
  tg_id: string
  tg_name: string | null
  level: number
  joined_at: string
}

const LEVELS = ['', 'New', 'Growing', 'Veteran']

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([])

  useEffect(() => {
    fetch('/api/members').then(r => r.json()).then(setMembers)
  }, [])

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Members ({members.length})</h1>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left text-sm text-gray-500">
            <th className="p-2">TG ID</th>
            <th className="p-2">Name</th>
            <th className="p-2">Level</th>
            <th className="p-2">Joined</th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <tr key={m.id} className="border-b hover:bg-gray-50">
              <td className="p-2 font-mono text-sm">{m.tg_id}</td>
              <td className="p-2">{m.tg_name ?? '-'}</td>
              <td className="p-2">{LEVELS[m.level] ?? m.level}</td>
              <td className="p-2 text-sm text-gray-500">{new Date(m.joined_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {members.length === 0 && <div className="text-center text-gray-400 py-8">No members yet</div>}
    </div>
  )
}
