'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { usePrivy } from '@privy-io/react-auth'

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, logout: privyLogout, getAccessToken } = usePrivy()
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
        setUser(data.user ?? null)
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
