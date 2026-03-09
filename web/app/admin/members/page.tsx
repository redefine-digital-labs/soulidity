'use client'
import { useEffect, useState } from 'react'

interface Member {
  id: string
  tg_id: string
  tg_name: string | null
  level: number
  joined_at: string
}

const LEVELS = ['', '新人', '成长中', '资深']

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([])

  useEffect(() => {
    fetch('/api/members').then(r => r.json()).then(setMembers)
  }, [])

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="text-gradient">成员管理</span>
          <span className="ml-3 text-base" style={{ color: 'var(--text-muted)' }}>({members.length})</span>
        </h1>
      </div>

      <div className="glass-panel overflow-hidden animate-fade-up" style={{ animationDelay: '50ms' }}>
        <table className="dark-table">
          <thead>
            <tr>
              <th>TG ID</th>
              <th>昵称</th>
              <th>等级</th>
              <th>加入时间</th>
            </tr>
          </thead>
          <tbody>
            {members.map(m => (
              <tr key={m.id}>
                <td className="data-value" style={{ color: 'var(--text-primary)' }}>{m.tg_id}</td>
                <td style={{ color: 'var(--text-primary)' }}>{m.tg_name ?? <span style={{ color: 'var(--text-muted)' }}>-</span>}</td>
                <td>
                  <span className="badge badge-cyan">{LEVELS[m.level] ?? m.level}</span>
                </td>
                <td className="data-value" style={{ color: 'var(--text-muted)' }}>{new Date(m.joined_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {members.length === 0 && (
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>暂无成员</div>
        )}
      </div>
    </div>
  )
}
