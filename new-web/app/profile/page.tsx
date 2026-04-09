'use client'

import { useEffect, useState } from 'react'
import { AuthGate } from '@/components/auth/auth-gate'
import { useAuth } from '@/components/providers/auth-provider'
import { useUpdateProfile } from '@/lib/hooks/use-profile'

export default function ProfilePage() {
  const { user } = useAuth()
  const { status, error, updateProfile } = useUpdateProfile()

  const [displayName, setDisplayName] = useState('')
  const [handle, setHandle] = useState('')
  const [bio, setBio] = useState('')
  const [emoji, setEmoji] = useState('🤖')
  const [twitterUrl, setTwitterUrl] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [hydratedUserId, setHydratedUserId] = useState<string | null>(null)

  // Pre-populate form from current user data; re-seed when user identity changes
  useEffect(() => {
    if (user && user.id !== hydratedUserId) {
      setDisplayName(user.displayName ?? user.tgName ?? '')
      setHandle(user.handle ?? '')
      setBio(user.bio ?? '')
      setEmoji(user.avatar ?? '🤖')
      setTwitterUrl(user.twitterUrl ?? '')
      setWebsiteUrl(user.websiteUrl ?? '')
      setHydratedUserId(user.id)
    }
  }, [user, hydratedUserId])

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
            value={twitterUrl}
            onChange={(e) => setTwitterUrl(e.target.value)}
          />
          <input
            className="w-full bg-card2 border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-purple placeholder:text-border"
            placeholder="Personal website URL"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
          />
        </div>

        {/* Feedback */}
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
          onClick={handleSave}
          disabled={isSaving}
          className={`w-full bg-purple text-white font-bold text-[15px] px-7 py-3 rounded-xl hover:bg-purple-deep transition ${isSaving ? 'opacity-60 cursor-wait' : ''}`}
        >
          {isSaving ? 'Saving…' : 'Save Profile'}
        </button>
      </div>
    </AuthGate>
  )
}
