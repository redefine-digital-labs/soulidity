'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { AuthGate } from '@/components/auth/auth-gate'
import { useAuth, type AuthUser } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { CoverImagePicker } from '@/components/ui/cover-image-picker'
import { useUpdateProfile } from '@/lib/hooks/use-profile'

function formatAddress(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

type WalletStatus = 'idle' | 'syncing' | 'success' | 'error'

function ProfileForm({ user }: { user: AuthUser }) {
  const { status, error, updateProfile, pending, recoveryExport, resumeProfile, queryProfile, discardProfile } = useUpdateProfile()
  const { profileError, refresh } = useAuth()

  const [displayName, setDisplayName] = useState(() => user.displayName ?? user.tgName ?? '')
  const [handle, setHandle] = useState(() => user.handle ?? '')
  const [bio, setBio] = useState(() => user.bio ?? '')
  const [emoji, setEmoji] = useState(() => user.avatar ?? '🤖')
  const [twitterUrl, setTwitterUrl] = useState(() => user.twitterUrl ?? '')
  const [websiteUrl, setWebsiteUrl] = useState(() => user.websiteUrl ?? '')
  const [walletAddress, setWalletAddress] = useState<string | null>(() => user.primarySuiAddress)
  const [walletStatus, setWalletStatus] = useState<WalletStatus>('idle')
  const [walletError, setWalletError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const coverPreviewObjectUrlRef = useRef<string | null>(null)
  const [coverImageFile, setCoverImageFileRaw] = useState<File | null>(null)
  const [coverImagePreviewUrl, setCoverImagePreviewUrl] = useState<string | null>(() => user.coverImageUrl ?? null)

  useEffect(() => {
    return () => {
      if (coverPreviewObjectUrlRef.current) {
        URL.revokeObjectURL(coverPreviewObjectUrlRef.current)
      }
    }
  }, [])

  const setCoverImage = useCallback((file: File | null) => {
    if (coverPreviewObjectUrlRef.current) {
      URL.revokeObjectURL(coverPreviewObjectUrlRef.current)
      coverPreviewObjectUrlRef.current = null
    }

    if (file) {
      const nextUrl = URL.createObjectURL(file)
      coverPreviewObjectUrlRef.current = nextUrl
      setCoverImagePreviewUrl(nextUrl)
      setCoverImageFileRaw(file)
      return
    }

    setCoverImagePreviewUrl(null)
    setCoverImageFileRaw(null)
  }, [])

  const handleSyncWallet = useCallback(async () => {
    setWalletStatus('syncing')
    setWalletError(null)

    try {
      await refresh()
      setWalletAddress(user.primarySuiAddress)
      setWalletStatus('success')
    } catch (syncError) {
      setWalletError(syncError instanceof Error ? syncError.message : 'Wallet sync failed')
      setWalletStatus('error')
    }
  }, [refresh, user.primarySuiAddress])

  async function handleSave() {
    setSaveError(null)
    try {
      if (profileError) throw new Error('Reload your chain profile before saving. A failed read does not mean this wallet has no profile.')
      const savedProfile = await updateProfile({
        displayName: displayName.trim() || null,
        avatar: emoji,
        bio: bio.trim() || null,
        coverImageUrl: coverImageFile ? user.coverImageUrl : coverImagePreviewUrl,
        handle: handle.trim() || null,
        twitterUrl: twitterUrl.trim() || null,
        websiteUrl: websiteUrl.trim() || null,
      }, coverImageFile)
      if (savedProfile.status !== 'saved') return

      if (coverPreviewObjectUrlRef.current) {
        URL.revokeObjectURL(coverPreviewObjectUrlRef.current)
        coverPreviewObjectUrlRef.current = null
      }
      setCoverImageFileRaw(null)
      setCoverImagePreviewUrl(savedProfile.intent.metadata.coverImageUrl)
    } catch (saveFailure) {
      setSaveError(saveFailure instanceof Error ? saveFailure.message : 'Profile update failed')
    }
  }

  const isSaving = status === 'saving'
  const isSyncingWallet = walletStatus === 'syncing'
  const frozen = pending?.draft?.intent ?? pending?.operation?.intent

  function exportRecovery() {
    if (!recoveryExport) return
    const url = URL.createObjectURL(new Blob([recoveryExport], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'public-profile-recovery.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function recover(action: 'query' | 'resume' | 'discard') {
    setSaveError(null)
    try {
      const result = await (action === 'query' ? queryProfile() : action === 'resume' ? resumeProfile(coverImageFile) : discardProfile())
      if (result.status === 'saved') {
        setDisplayName(result.intent.metadata.displayName ?? ''); setHandle(result.intent.handle ?? '')
        setBio(result.intent.metadata.bio ?? ''); setEmoji(result.intent.metadata.avatar ?? '🤖')
        setTwitterUrl(result.intent.metadata.twitterUrl ?? ''); setWebsiteUrl(result.intent.metadata.websiteUrl ?? '')
        setCoverImageFileRaw(null); setCoverImagePreviewUrl(result.intent.metadata.coverImageUrl)
      }
    } catch (failure) { setSaveError(failure instanceof Error ? failure.message : 'Profile recovery failed') }
  }

  return (
    <div id="profile" className="max-w-[640px] mx-auto px-6 py-8 relative z-10">
      <p className="text-[11px] font-bold text-action-label uppercase tracking-[0.1em] mb-1.5">Settings</p>
      <h1 className="font-display text-2xl font-bold mb-2">Edit Profile</h1>
      <p className="text-sm text-muted mb-6">
        These settings power your public page at <span className="font-mono text-foreground">/community/u/{user.id}</span>.
      </p>
      {profileError && <div role="alert" className="mb-6 rounded-xl border border-danger p-4">
        <p className="text-sm text-danger">Profile could not be read: {profileError}</p>
        <p className="text-xs text-muted mt-1">Your existing profile has not been changed. Reload before creating or saving.</p>
        <Button variant="outline" size="sm" onClick={() => void handleSyncWallet()} disabled={isSyncingWallet}>Retry chain read</Button>
      </div>}

      <fieldset disabled={isSaving || !!pending}>
      <section id="cover" className="mb-8 rounded-xl border border-border bg-card px-5 py-5">
        <div className="mb-3">
          <h2 className="text-sm font-bold text-foreground">Profile Cover</h2>
          <p className="text-xs text-muted mt-1">
            Update the banner shown on your public profile. PNG, JPEG, and WebP are supported.
          </p>
        </div>
        <CoverImagePicker
          file={coverImageFile}
          previewUrl={coverImagePreviewUrl}
          onChange={setCoverImage}
          label="Upload profile cover"
          sublabel="Square crop · exported at 1024×1024 · shown as your public hero"
          icon="🌌"
        />
      </section>

      <section id="wallet" className="mb-8 rounded-xl border border-border bg-card px-5 py-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-bold text-foreground">Sui Wallet</h2>
            <p className="text-xs text-muted mt-1">
              Your public profile and Soulidity actions use your connected Sui wallet.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void handleSyncWallet()} disabled={isSyncingWallet}>
            {isSyncingWallet ? 'Reading…' : 'Refresh wallet data'}
          </Button>
        </div>
        <div className="mt-4 rounded-lg border border-border bg-card2/60 px-4 py-3">
          <div className="text-xs uppercase tracking-[0.08em] text-muted mb-1">Primary wallet</div>
          <div className="font-mono text-sm text-foreground">
            {walletAddress ? formatAddress(walletAddress) : 'Not linked yet'}
          </div>
          {walletError && (
            <p className="text-xs font-semibold text-danger mt-2">{walletError}</p>
          )}
          {walletStatus === 'success' && !walletError && (
            <p className="text-xs font-semibold text-teal mt-2">Wallet is linked and ready.</p>
          )}
        </div>
      </section>

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

      </fieldset>
      {coverImageFile && <Button size="sm" variant="outline" onClick={() => {
        const url = URL.createObjectURL(coverImageFile), link = document.createElement('a')
        link.href = url; link.download = coverImageFile.name; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }}>Download cropped cover for recovery</Button>}
      {pending && <section aria-label="Pending profile save" className="mb-4 rounded-xl border border-border p-4">
        <h2 className="text-sm font-bold">Unfinished profile save</h2>
        <p className="text-xs text-muted mt-2">This save is frozen for {frozen?.owner}. Checking does not upload or request a signature. Resume uses the original form and transaction, not edits made afterward.</p>
        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ handle: frozen?.handle, ...frozen?.metadata }, null, 2)}</pre>
        {pending.draft?.cover && !pending.draft.coverReceipt && <label className="block text-xs mt-3">
          The cropped cover is cached for recovery. If that cache is missing, select its downloaded copy ({pending.draft.cover.byteLength} bytes), not the uncropped original.
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={isSaving}
            onChange={event => setCoverImage(event.target.files?.[0] ?? null)} />
        </label>}
        <div className="flex flex-wrap gap-2 mt-3">
          <Button size="sm" variant="outline" disabled={isSaving} onClick={() => void recover('query')}>Check result</Button>
          <Button size="sm" disabled={isSaving} onClick={() => void recover('resume')}>Resume original save</Button>
          <Button size="sm" variant="outline" disabled={isSaving} onClick={() => void recover('discard')}>Archive safe record</Button>
        </div>
        <p className="text-xs text-muted mt-2">Signed or uncertain transactions cannot be discarded. Archiving retains public receipts in this browser.</p>
      </section>}
      {recoveryExport && (pending || error) && <Button size="sm" variant="outline" onClick={exportRecovery}>Export recovery record</Button>}
      {status === 'pending' && <p role="status" className="text-xs text-muted my-3">The save is not yet confirmed. Check its result before starting another.</p>}
      {status === 'success' && (
        <div className="mb-4 rounded-lg border border-teal/30 bg-teal/8 px-4 py-2.5">
          <p className="text-xs font-semibold text-teal">Profile saved successfully</p>
        </div>
      )}
      {(error || saveError) && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger/8 px-4 py-2.5">
          <p className="text-xs font-semibold text-danger">{error || saveError}</p>
        </div>
      )}

      <Button
        full
        size="lg"
        onClick={() => void handleSave()}
        disabled={isSaving || !!profileError || !!pending}
      >
        {isSaving ? 'Saving…' : 'Save Profile'}
      </Button>
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
      className="max-w-[640px]"
    >
      {user ? <ProfileForm key={user.primarySuiAddress ?? user.id} user={user} /> : null}
    </AuthGate>
  )
}
