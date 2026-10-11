import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { state, unavailable, formAppend, controlledFormAppend, formGrant, controlledFormGrant } from './soul-detail-browser-state'

export function useSoulDetail(id: string) {
  const query = useQuery({ queryKey: ['soul', id], enabled: Boolean(state.appendRuntime),
    queryFn: () => state.appendRuntime.detail(), initialData: state.soul })
  return state.appendRuntime ? query : { data: state.soul, isLoading: false, error: null, refetch: async () => {} }
}
export function useCurrentAccount() { return state.account }
export function useCurrentWallet() { return { currentWallet: state.wallet } }
export function useSuiClient() { return state.crypto.client }
export function useSignPersonalMessage() { return { mutateAsync: async ({message}: {message: Uint8Array}) => ({signature: await state.crypto.signPersonalMessage(message)}) } }
export const useSignTransaction = () => ({ mutateAsync: unavailable })
export const useAuth = () => ({ getAuthHeaders: unavailable })
export function useRequireAuth() { return { requireAuth: () => {} } }
export function useRouter() { return { push: unavailable } }
export default function Link({children, href, ...rest}: any) { return <a href={href} {...rest}>{children}</a> }
export function SoulCoverImage() { return <div>Fixture cover</div> }
export function NativeWardrobePanel() { return null }
export function AgentGrantRecommendations() { return null }
export function ReportModal() { return null }
export function UpdatePriceModal() { return null }
export function DelistModal() { return null }
export const useGrant = () => ({ pending: formGrant.pending ? 'issue' : null, error: null, identityKey: state.account?.address,
  issueGrant: controlledFormGrant, revokeGrant: unavailable, revokeGrantScope: unavailable })
const records = { records: [], history: [], pending: false, pendingAction: null, error: null, status: null,
  refresh: unavailable, query: unavailable, resume: unavailable, cancel: unavailable, exportRecord: unavailable }
export function useSoulContentMutations() {
  const [error, setError] = React.useState<string | null>(null)
  return { ...records, error, author: state.account?.address, mutate: async () => {
    if (new URLSearchParams(location.search).has('mutation-reject')) {
      const message = 'Controlled wallet rejection: content remains unchanged.'
      setError(message)
      throw new Error(message)
    }
    return unavailable()
  } }
}
export const useSoulAccessMutations = () => ({ ...records, author: state.account?.address, identityKey: state.account?.address })
export const usePaidAccess = () => ({ ...records, pending:null, identityKey:state.account?.address, configurePaidAccess: unavailable, deletePaidAccess: unavailable,
  revokePaidAccess: unavailable, preparePurchase: unavailable, execute: unavailable })
export const useSoulContentAppend = () => ({ pending: formAppend.pending, error: null, recoveries: [], archivedRecoveries: [],
  pendingRestores: [], importedRecovery: null, queryStatus: null, append: controlledFormAppend, refresh: unavailable,
  query: unavailable, resume: unavailable, restore: unavailable, rebase: unavailable, queryImported: unavailable,
  finish: unavailable, exportRecovery: unavailable, importRecovery: unavailable })

// Replaced only at the read hook's test-bundle imports. The implementation called
// by crypto.open is the production opener, not this adapter.
export const getBrowserContentAccessConfig = () => state.crypto.accessConfig ?? state.crypto.config
export const getBrowserContentSealConfig = () => state.crypto.sealConfig
export const openBrowserSoulContent = async (params: any) => {
  try { return await state.crypto.open(params) }
  finally { state.notify() }
}
