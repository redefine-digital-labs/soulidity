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
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8 animate-fade-up">
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="text-gradient">邀请码管理</span>
        </h1>
        <button onClick={createCode} className="btn btn-primary">
          生成邀请码
        </button>
      </div>

      <div className="glass-panel overflow-hidden animate-fade-up" style={{ animationDelay: '50ms' }}>
        <table className="dark-table">
          <thead>
            <tr>
              <th>邀请码</th>
              <th>状态</th>
              <th>使用者</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            {invites.map(inv => (
              <tr key={inv.code}>
                <td className="data-value" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{inv.code}</td>
                <td>
                  <span className={`badge ${inv.active ? 'badge-emerald' : 'badge-muted'}`}>
                    {inv.active ? '可用' : '已使用'}
                  </span>
                </td>
                <td>{inv.used_by ?? <span style={{ color: 'var(--text-muted)' }}>-</span>}</td>
                <td className="data-value" style={{ color: 'var(--text-muted)' }}>{new Date(inv.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {invites.length === 0 && (
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>暂无邀请码</div>
        )}
      </div>
    </div>
  )
}
