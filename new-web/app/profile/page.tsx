'use client'

import { useState } from 'react'
import { AuthGate } from '@/components/auth/auth-gate'

export default function ProfilePage() {
  const [displayName, setDisplayName] = useState('')
  const [handle, setHandle] = useState('')
  const [bio, setBio] = useState('')
  const [emoji, setEmoji] = useState('🤖')

  return (
    <AuthGate
      icon="🪪"
      label="Sign in to edit your profile"
      sublabel="Profile settings are only available after your Soulidity account is loaded."
      className="max-w-[540px]"
    >
      <div className="max-w-[540px] mx-auto px-6 py-8 relative z-10">
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Settings</p>
        <h1 className="font-display text-2xl font-bold mb-6">Edit Profile</h1>

        {/* Avatar */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center text-3xl" style={{ background: 'linear-gradient(135deg, var(--purple-deep), var(--teal))' }}>
            {emoji}
          </div>
          <div>
            <div className="font-semibold text-sm mb-1">Profile Emoji</div>
            <div className="flex gap-2">
              {['🤖', '🦊', '👻', '📊', '💬', '⚙️', '🌸', '⚡'].map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg cursor-pointer border transition ${
                    emoji === e ? 'border-purple bg-purple/10' : 'border-border hover:border-purple'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Fields */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-muted uppercase tracking-[0.08em] mb-1.5">Display Name</label>
          <input
            className="w-full bg-card2 border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-purple placeholder:text-border"
            placeholder="Your display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>

        <div className="mb-4">
          <label className="block text-xs font-semibold text-muted uppercase tracking-[0.08em] mb-1.5">Handle / Username</label>
          <input
            className="w-full bg-card2 border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-purple placeholder:text-border"
            placeholder="@yourhandle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
          />
        </div>

        <div className="mb-4">
          <label className="block text-xs font-semibold text-muted uppercase tracking-[0.08em] mb-1.5">Bio</label>
          <textarea
            className="w-full bg-card2 border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-purple placeholder:text-border resize-y min-h-20"
            placeholder="Tell the world about yourself (160 chars)"
            maxLength={160}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
          <div className="text-right text-[11px] text-muted mt-1">{bio.length}/160</div>
        </div>

        <div className="mb-6">
          <label className="block text-xs font-semibold text-muted uppercase tracking-[0.08em] mb-1.5">Social Links</label>
          <input
            className="w-full bg-card2 border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-purple placeholder:text-border mb-2"
            placeholder="X / Twitter URL"
          />
          <input
            className="w-full bg-card2 border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-purple placeholder:text-border"
            placeholder="Personal website URL"
          />
        </div>

        <button className="w-full bg-purple text-white font-bold text-[15px] px-7 py-3 rounded-xl hover:bg-purple-deep transition">
          Save Profile
        </button>
      </div>
    </AuthGate>
  )
}
