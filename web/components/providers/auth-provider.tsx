'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { readMyWalletProfile, readPublicProfileMetadata, type WalletProfileReadClient, type WalletProfileSnapshot } from '@soulidity/sdk'
import { getBrowserProfileConfig } from '@/lib/profile/profile-config'

export interface AuthUser {
  id: string
  tgName: string | null
  displayName: string | null
  avatar: string | null
  bio: string | null
  coverImageUrl: string | null
  handle: string | null
  twitterUrl: string | null
  websiteUrl: string | null
  level: number
  kind: string
  primarySuiAddress: string | null
  isAdmin: boolean
}
interface AuthContextValue {
  user: AuthUser | null
  walletAddress: string | null
  profile: WalletProfileSnapshot | null
  profileError: string | null
  loading: boolean
  authenticated: boolean
  login: () => void
  logout: () => Promise<void>
  refresh: () => Promise<void>
  /** Unconverted callers must stop, never obtain an invented bearer identity.
   * Remove this API with remaining owned endpoint callers at SPA cutover. */
  getAuthHeaders: () => Promise<Record<string, string>>
}
interface WalletBinding { address: string; client: WalletProfileReadClient }
interface AuthInternalContextValue {
  bindWallet: (binding: WalletBinding | null) => void
  registerDisconnectHandler: (handler: () => Promise<void>) => void
}
const retiredHeaders = async (): Promise<Record<string, string>> => {
  throw new Error('Owned account API retired; this action must use its chain-backed browser service.')
}
const AuthContext = createContext<AuthContextValue>({ user: null, walletAddress: null, profile: null, profileError: null,
  loading: false, authenticated: false, login: () => {}, logout: async () => {}, refresh: async () => {}, getAuthHeaders: retiredHeaders })
const LoginModalContext = createContext({ open: false, setOpen: (_open: boolean) => {} })
const AuthInternalContext = createContext<AuthInternalContextValue>({ bindWallet: () => {}, registerDisconnectHandler: () => {} })
export const useAuth = () => useContext(AuthContext)
export const useLoginModal = () => useContext(LoginModalContext)
export const useAuthInternal = () => useContext(AuthInternalContext)

function walletPrincipal(address: string): AuthUser {
  // Before explicit profile creation, identity is the actual connected address,
  // never a fabricated SQL member ID. Connection grants no chain authority.
  return { id: address, primarySuiAddress: address, tgName: null, displayName: null, avatar: null, bio: null,
    coverImageUrl: null, handle: null, twitterUrl: null, websiteUrl: null, level: 0, kind: 'human', isAdmin: false }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [profile, setProfile] = useState<WalletProfileSnapshot | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const binding = useRef<WalletBinding | null>(null)
  const pending = useRef<AbortController | null>(null)
  const disconnect = useRef<(() => Promise<void>) | null>(null)
  const refresh = useCallback(async () => {
    pending.current?.abort(new Error('Profile read superseded'))
    const wallet = binding.current
    if (!wallet) return
    const controller = new AbortController(); pending.current = controller
    setLoading(true); setProfileError(null)
    try {
      const config = getBrowserProfileConfig()
      const next = await readMyWalletProfile({ client: wallet.client, deployment: config.deployment,
        owner: wallet.address, signal: controller.signal })
      const metadata = next ? (await readPublicProfileMetadata({ client: wallet.client,
        reference: next.metadata, storage: config.storage, signal: controller.signal })).metadata : null
      controller.signal.throwIfAborted()
      if (binding.current !== wallet) return
      setProfile(next)
      setUser({ ...walletPrincipal(wallet.address), ...(metadata ?? {}), id: next?.id ?? wallet.address, handle: next?.handle ?? null })
    } catch (error) {
      if (controller.signal.aborted || binding.current !== wallet) return
      setProfileError(error instanceof Error ? error.message : 'Profile chain read failed')
      throw error
    } finally {
      if (pending.current === controller) { pending.current = null; setLoading(false) }
    }
  }, [])
  const bindWallet = useCallback((next: WalletBinding | null) => {
    if (next?.address === binding.current?.address && next?.client === binding.current?.client) return
    pending.current?.abort(new Error('Wallet changed')); pending.current = null
    binding.current = next
    setProfile(null); setProfileError(null); setUser(next ? walletPrincipal(next.address) : null); setLoading(false)
    if (next) { setOpen(false); void refresh().catch(() => {}) }
  }, [refresh])
  const registerDisconnectHandler = useCallback((handler: () => Promise<void>) => { disconnect.current = handler }, [])
  const logout = useCallback(async () => {
    await disconnect.current?.()
    bindWallet(null)
  }, [bindWallet])
  const value = useMemo<AuthContextValue>(() => ({ user, walletAddress: user?.primarySuiAddress ?? null, profile,
    profileError, loading, authenticated: !!user, login: () => setOpen(true), logout, refresh, getAuthHeaders: retiredHeaders }),
  [user, profile, profileError, loading, logout, refresh])
  const internal = useMemo(() => ({ bindWallet, registerDisconnectHandler }), [bindWallet, registerDisconnectHandler])
  return <AuthContext.Provider value={value}>
    <LoginModalContext.Provider value={{ open, setOpen }}>
      <AuthInternalContext.Provider value={internal}>{children}</AuthInternalContext.Provider>
    </LoginModalContext.Provider>
  </AuthContext.Provider>
}
