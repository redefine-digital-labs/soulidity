'use client'

import { useState } from 'react'
import { AuthGate } from '@/components/auth/auth-gate'
import { useAuth, type AuthUser } from '@/components/providers/auth-provider'
import { useUpdateProfile } from '@/lib/hooks/use-profile'

function ProfileForm({ user }: { user: AuthUser }) {
  const { status, error, updateProfile } = useUpdateProfile()

  const [displayName, setDisplayName] = useState(() => user.displayName ?? user.tgName ?? '')
  const [handle, setHandle] = useState(() => user.handle ?? '')
  const [bio, setBio] = useState(() => user.bio ?? '')
  const [emoji, setEmoji] = useState(() => user.avatar ?? '🤖')
  const [twitterUrl, setTwitterUrl] = useState(() => user.twitterUrl ?? '')
  const [websiteUrl, setWebsiteUrl] = useState(() => user.websiteUrl ?? '')

  async function handleSave() {
    try {
      await updateProfile({
        displayName: displayName.trim() || null,
        avatar: emoji,
        bio: bio.trim() || null,
        handle: handle.trim() || null,
        twitterUrl: twitterUrl.trim() || null,
        websiteUrl: websiteUrl.trim() || null,
      })
    } catch { /* error set in hook */ }
  }

  const isSaving = status === 'saving'

  return (
    <div className="max-w-[540px] mx-auto px-6 py-8 relative z-10">
      <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Settings</p>
      <h1 className="font-display text-2xl font-bold mb-6">Edit Profile</h1>

      <div className="flex items-center gap-4 mb-6">
        <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center text-3xl" style={{ background: 'linear-gradient(135deg, var(--purple-deep), var(--teal))' }}>
          {emoji}
        </div>
        <div>
          <div className="font-semibold text-sm mb-1">Profile Emoji</div>
          <div className="flex gap-2">
            {['🤖', '🦊', '👻', '📊', '💬', '⚙️', '🌸', '⚡'].map((value) => (
              <button
                key={value}
                onClick={() => setEmoji(value)}
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg cursor-pointer border transition ${
                  emoji === value ? 'border-purple bg-purple/10' : 'border-border hover:border-purple'
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-xs font-semibold text-muted uppercase tracking-[0.08em] mb-1.5">Display Name</label>
        <input
          className="w-full bg-card2 border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-purple placeholder:text-border"
          placeholder="Your display name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </div>

      <div className="mb-4">
        <label className="block text-xs font-semibold text-muted uppercase tracking-[0.08em] mb-1.5">Handle / Username</label>
        <input
          className="w-full bg-card2 border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-purple placeholder:text-border"
          placeholder="@yourhandle"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
        />
      </div>

      <div className="mb-4">
        <label className="block text-xs font-semibold text-muted uppercase tracking-[0.08em] mb-1.5">Bio</label>
        <textarea
          className="w-full bg-card2 border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-purple placeholder:text-border resize-y min-h-20"
          placeholder="Tell the world about yourself (160 chars)"
          maxLength={160}
          value={bio}
          onChange={(event) => setBio(event.target.value)}
        />
        <div className="text-right text-[11px] text-muted mt-1">{bio.length}/160</div>
      </div>

      <div className="mb-6">
        <label className="block text-xs font-semibold text-muted uppercase tracking-[0.08em] mb-1.5">Social Links</label>
        <input
          className="w-full bg-card2 border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-purple placeholder:text-border mb-2"
          placeholder="X / Twitter URL"
          value={twitterUrl}
          onChange={(event) => setTwitterUrl(event.target.value)}
        />
        <input
          className="w-full bg-card2 border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-purple placeholder:text-border"
          placeholder="Personal website URL"
          value={websiteUrl}
          onChange={(event) => setWebsiteUrl(event.target.value)}
        />
      </div>

      {status === 'success' && (
        <div className="mb-4 rounded-lg border border-teal/30 bg-teal/8 px-4 py-2.5">
          <p className="text-xs font-semibold text-teal">Profile saved successfully</p>
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger/8 px-4 py-2.5">
          <p className="text-xs font-semibold text-danger">{error}</p>
        </div>
      )}

      <button
        onClick={() => void handleSave()}
        disabled={isSaving}
        className={`w-full bg-purple text-white font-bold text-[15px] px-7 py-3 rounded-xl hover:bg-purple-deep transition ${isSaving ? 'opacity-60 cursor-wait' : ''}`}
      >
        {isSaving ? 'Saving…' : 'Save Profile'}
      </button>
    </div>
  )
}

export default function ProfilePage() {
  const { user } = useAuth()

  return (
    <AuthGate
      icon="🪪"
      label="Sign in to edit your profile"
      sublabel="Profile settings are only available after your Soulidity account is loaded."
      className="max-w-[540px]"
    >
      {user ? <ProfileForm key={user.id} user={user} /> : null}
    </AuthGate>
  )
}
