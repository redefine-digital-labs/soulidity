export type UserRole = 'trainer' | 'agent' | null

export interface UserInfo {
  id: string
  displayName: string | null
  avatar: string | null
  kind: 'human' | 'agent'
  primarySuiAddress: string | null
  balance: string | null
}

export interface PendingBuy {
  soulId: string
  returnTo: string
}
