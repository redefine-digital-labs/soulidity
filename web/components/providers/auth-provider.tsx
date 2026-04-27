'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

const CSRF_COOKIE_NAME = 'csrf-token'

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
  loading: boolean
  authenticated: boolean
  /** Open the wallet connect modal. The wallet bridge runs the rest of the
   *  challenge → sign → login flow once a wallet is connected. */
  login: () => void
  /** Server logout + disconnect any connected wallet. */
  logout: () => Promise<void>
  /** Re-fetch /api/auth/me. */
  refresh: () => Promise<void>
  /** Header bag to include on cookie-auth mutating requests. */
  getAuthHeaders: () => Promise<Record<string, string>>
}

interface LoginModalContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

interface AuthInternalContextValue {
  /** Called by WalletAuthBridge after a wallet connects. */
  completeWalletLogin: (
    address: string,
    signMessage: (msg: Uint8Array) => Promise<string>,
  ) => Promise<void>
  /** Bridge installs its disconnect callback so logout() can clear the wallet. */
  registerDisconnectHandler: (handler: () => Promise<void>) => void
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  authenticated: false,
  login: () => {},
  logout: async () => {},
  refresh: async () => {},
  getAuthHeaders: async () => ({}),
})

const LoginModalContext = createContext<LoginModalContextValue>({
  open: false,
  setOpen: () => {},
})

const AuthInternalContext = createContext<AuthInternalContextValue>({
  completeWalletLogin: async () => {},
  registerDisconnectHandler: () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

export function useLoginModal() {
  return useContext(LoginModalContext)
}

export function useAuthInternal() {
  return useContext(AuthInternalContext)
}

function readCsrfTokenCookie(): string | null {
  if (typeof document === 'undefined') return null
  for (const part of document.cookie.split(';')) {
    const cookie = part.trim()
    if (cookie.startsWith(`${CSRF_COOKIE_NAME}=`)) {
      const value = cookie.slice(CSRF_COOKIE_NAME.length + 1).trim()
      return value.length > 0 ? value : null
    }
  }
  return null
}

interface WalletLoginResponse {
  ok: true
  walletAddress: string
  csrfToken: string
}

async function runWalletLogin(
  address: string,
  signMessage: (msg: Uint8Array) => Promise<string>,
): Promise<WalletLoginResponse> {
  const challengeRes = await fetch('/api/auth/wallet-challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  })
  if (!challengeRes.ok) {
    const body = await challengeRes.json().catch(() => ({}))
    throw new Error(body.error ?? 'Failed to issue wallet challenge')
  }
  const challenge = await challengeRes.json() as {
    nonce: string
    message: string
  }

  const messageBytes = new TextEncoder().encode(challenge.message)
  const signature = await signMessage(messageBytes)

  const loginRes = await fetch('/api/auth/wallet-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address,
      signature,
      nonce: challenge.nonce,
    }),
  })
  if (!loginRes.ok) {
    const body = await loginRes.json().catch(() => ({}))
    throw new Error(body.error ?? 'Wallet login failed')
  }
  return await loginRes.json() as WalletLoginResponse
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [csrfToken, setCsrfToken] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : readCsrfTokenCookie(),
  )
  const [showLoginModal, setShowLoginModal] = useState(false)
  const loginRunningForAddressRef = useRef<string | null>(null)
  const disconnectHandlerRef = useRef<(() => Promise<void>) | null>(null)

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setUser(data.user ?? null)
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return
        setUser(data?.user ?? null)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setUser(null)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const completeWalletLogin = useCallback(async (
    address: string,
    signMessage: (msg: Uint8Array) => Promise<string>,
  ) => {
    if (loginRunningForAddressRef.current === address) return
    loginRunningForAddressRef.current = address
    setLoading(true)
    try {
      const result = await runWalletLogin(address, signMessage)
      setCsrfToken(result.csrfToken)
      await fetchUser()
    } catch (error) {
      console.error('Wallet login failed', error)
      try {
        await disconnectHandlerRef.current?.()
      } catch {
        // ignore disconnect failure
      }
      setUser(null)
      setLoading(false)
    } finally {
      loginRunningForAddressRef.current = null
    }
  }, [fetchUser])

  const registerDisconnectHandler = useCallback((handler: () => Promise<void>) => {
    disconnectHandlerRef.current = handler
  }, [])

  const login = useCallback(() => {
    setShowLoginModal(true)
  }, [])

  const logout = useCallback(async () => {
    const headers: Record<string, string> = {}
    const token = csrfToken ?? readCsrfTokenCookie()
    if (token) headers['x-csrf-token'] = token
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers })
    } catch {
      // ignore — we still clear local state below
    }
    setCsrfToken(null)
    setUser(null)
    try {
      await disconnectHandlerRef.current?.()
    } catch {
      // ignore
    }
  }, [csrfToken])

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = csrfToken ?? readCsrfTokenCookie()
    if (!token) return {}
    return { 'x-csrf-token': token }
  }, [csrfToken])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    authenticated: !!user,
    login,
    logout,
    refresh: fetchUser,
    getAuthHeaders,
  }), [user, loading, login, logout, fetchUser, getAuthHeaders])

  const modalValue = useMemo<LoginModalContextValue>(() => ({
    open: showLoginModal,
    setOpen: setShowLoginModal,
  }), [showLoginModal])

  const internalValue = useMemo<AuthInternalContextValue>(() => ({
    completeWalletLogin,
    registerDisconnectHandler,
  }), [completeWalletLogin, registerDisconnectHandler])

  return (
    <AuthContext.Provider value={value}>
      <LoginModalContext.Provider value={modalValue}>
        <AuthInternalContext.Provider value={internalValue}>
          {children}
        </AuthInternalContext.Provider>
      </LoginModalContext.Provider>
    </AuthContext.Provider>
  )
}
