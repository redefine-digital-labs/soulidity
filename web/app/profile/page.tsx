'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { AuthGate } from '@/components/auth/auth-gate'
import { useAuth, type AuthUser } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { CoverImagePicker } from '@/components/ui/cover-image-picker'
import { useUpdateProfile } from '@/lib/hooks/use-profile'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { uploadSoulPayload } from '@/lib/upload/client-upload'
import { useUploadCostReview } from '@/components/upload/upload-cost-review'

function formatAddress(value: string | null | undefined) {
  if (!value) return '—'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

type WalletStatus = 'idle' | 'syncing' | 'success' | 'error'

function ProfileForm({ user }: { user: AuthUser }) {
  const { status, error, updateProfile } = useUpdateProfile()
  const { getAuthHeaders, refresh } = useAuth()
  const { suiWallet, suiClient, signAndExecute } = useWalletSign()
  const { requestUploadCostApproval } = useUploadCostReview()

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

  const uploadCoverImage = useCallback(async () => {
    if (!coverImageFile) return coverImagePreviewUrl
    if (!suiWallet) {
      throw new Error('Connect a Sui wallet before uploading a profile cover')
    }

    const headers = await getAuthHeaders()
    const upload = await uploadSoulPayload({
      file: coverImageFile,
      uploadType: 'public',
      kind: 'soul-content',
      authHeaders: headers,
      walletAddress: suiWallet.address,
      suiClient,
      signAndExecute,
      confirmQuote: requestUploadCostApproval,
    })
    return upload.blobUrl
  }, [coverImageFile, coverImagePreviewUrl, getAuthHeaders, requestUploadCostApproval, signAndExecute, suiClient, suiWallet])

  const handleSyncWallet = useCallback(async () => {
    setWalletStatus('syncing')
    setWalletError(null)

    try {
      const headers = await getAuthHeaders()
      const response = await fetch('/api/profile/wallet', {
        method: 'POST',
        headers,
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || `Wallet sync failed: ${response.status}`)
      }

      const data = await response.json() as { primarySuiAddress: string }
      setWalletAddress(data.primarySuiAddress)
      setWalletStatus('success')
      await refresh()
    } catch (syncError) {
      setWalletError(syncError instanceof Error ? syncError.message : 'Wallet sync failed')
      setWalletStatus('error')
    }
  }, [getAuthHeaders, refresh])

  async function handleSave() {
    setSaveError(null)
    try {
      const nextCoverImageUrl = await uploadCoverImage()
      const savedProfile = await updateProfile({
        displayName: displayName.trim() || null,
        avatar: emoji,
        bio: bio.trim() || null,
        coverImageUrl: nextCoverImageUrl,
        handle: handle.trim() || null,
        twitterUrl: twitterUrl.trim() || null,
        websiteUrl: websiteUrl.trim() || null,
      }) as { coverImage?: string | null }

      if (coverPreviewObjectUrlRef.current) {
        URL.revokeObjectURL(coverPreviewObjectUrlRef.current)
        coverPreviewObjectUrlRef.current = null
      }
      setCoverImageFileRaw(null)
      setCoverImagePreviewUrl(savedProfile.coverImage ?? nextCoverImageUrl ?? null)
    } catch (saveFailure) {
      setSaveError(saveFailure instanceof Error ? saveFailure.message : 'Profile update failed')
    }
  }

  const isSaving = status === 'saving'
  const isSyncingWallet = walletStatus === 'syncing'

  return (
    <div id="profile" className="max-w-[640px] mx-auto px-6 py-8 relative z-10">
      <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Settings</p>
      <h1 className="font-display text-2xl font-bold mb-2">Edit Profile</h1>
      <p className="text-sm text-muted mb-6">
        These settings power your public page at <span className="font-mono text-foreground">/community/u/{user.id}</span>.
      </p>

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
            {isSyncingWallet ? 'Linking…' : walletAddress ? 'Re-sync wallet' : 'Link wallet'}
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
        disabled={isSaving}
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
      {user ? <ProfileForm key={user.id} user={user} /> : null}
    </AuthGate>
  )
}
