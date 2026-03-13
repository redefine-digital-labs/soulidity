'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'

interface AuthUser {
  id: string
  tgName: string | null
  avatar: string | null
  level: number
  kind: string
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  logout: () => Promise<void>
  refresh: () => Promise<void>
  getAuthHeaders: () => Promise<Record<string, string>>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  logout: async () => {},
  refresh: async () => {},
  getAuthHeaders: async () => ({}),
})

function usePrivySafe() {
  try {
    // Dynamic import to avoid crash when PrivyProvider is absent
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { usePrivy } = require('@privy-io/react-auth')
    return usePrivy() as {
      ready: boolean
      authenticated: boolean
      logout: () => Promise<void>
      getAccessToken: () => Promise<string | null>
    }
  } catch {
    return {
      ready: true,
      authenticated: false,
      logout: async () => {},
      getAccessToken: async () => null as string | null,
    }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, logout: privyLogout, getAccessToken } = usePrivySafe()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (!authenticated) return {}
    const token = await getAccessToken()
    if (!token) return {}
    return { Authorization: `Bearer ${token}` }
  }, [authenticated, getAccessToken])

  const fetchUser = useCallback(async () => {
    if (!ready) return
    if (!authenticated) {
      setUser(null)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch('/api/auth/me', { cache: 'no-store', headers })
      if (res.ok) {
        const data = await res.json()
        if (data.user) {
          setUser(data.user)
          return
        }

        // user is null — try linking via privy-callback
        const linkRes = await fetch('/api/auth/privy-callback', {
          method: 'POST',
          headers,
        })
        if (linkRes.ok) {
          // Retry /api/auth/me after linking
          const retryRes = await fetch('/api/auth/me', { cache: 'no-store', headers })
          if (retryRes.ok) {
            const retryData = await retryRes.json()
            setUser(retryData.user ?? null)
            return
          }
        }

        setUser(null)
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [ready, authenticated, getAuthHeaders])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  const logout = useCallback(async () => {
    await privyLogout()
    setUser(null)
  }, [privyLogout])

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh: fetchUser, getAuthHeaders }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
