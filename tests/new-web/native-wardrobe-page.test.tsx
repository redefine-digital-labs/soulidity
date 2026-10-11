// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ soul: null as any, wardrobe: vi.fn() }))
vi.mock('../../web/lib/hooks/use-souls', () => ({ useSoulDetail: () => ({ data: m.soul, isLoading: false, error: null }) }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => ({ user: null, getAuthHeaders: vi.fn() }) }))
vi.mock('../../web/lib/hooks/use-require-auth', () => ({ useRequireAuth: () => ({ requireAuth: vi.fn() }) }))
vi.mock('../../web/lib/hooks/use-wallet-sign', () => ({ useWalletSign: () => ({ suiWallet: null, suiClient: {}, signAndExecute: vi.fn() }) }))
vi.mock('../../web/lib/hooks/use-soul-content-actions', () => ({ useSoulContentActions: () => ({
  pendingAction: null, contentActionError: null, contentAppend: { notice: null, pending: false },
  contentMutations: { pending: false },
}) }))
// This suite verifies original Wardrobe routing/royalties; wallet and recovery
// behavior is exercised in the connected detail-page and real-browser suites.
vi.mock('../../web/lib/hooks/use-grant', () => ({ useGrant: () => ({ pending: null }) }))
vi.mock('../../web/lib/hooks/use-paid-access', () => ({ usePaidAccess: () => ({ pending: null }) }))
vi.mock('../../web/lib/hooks/use-soul-content-append', () => ({ useSoulContentAppend: () => ({
  recoveries: [], archivedRecoveries: [], pendingRestores: [], pending: false,
}) }))
vi.mock('../../web/components/souls/content-mutation-recovery', () => ({ ContentMutationRecoveryPanel: () => null }))
vi.mock('../../web/components/souls/soul-access-recovery', () => ({ SoulAccessRecoveryPanel: () => null }))
vi.mock('../../web/components/souls/native-wardrobe', () => ({ NativeWardrobePanel: (props: any) => {
  m.wardrobe(props)
  return <section aria-label="Native equipment route">{props.soulObjectId}</section>
} }))
vi.mock('../../web/components/souls/soul-cover-image', () => ({ SoulCoverImage: () => null }))
vi.mock('../../web/components/souls/listing-modals', () => ({ UpdatePriceModal: () => null, DelistModal: () => null }))
vi.mock('../../web/components/souls/agent-grant-recommendations', () => ({ AgentGrantRecommendations: () => null }))
vi.mock('../../web/components/souls/purge-confirm-modal', () => ({ PurgeConfirmModal: () => null }))
vi.mock('../../web/components/shared/report-modal', () => ({ ReportModal: () => null }))
vi.mock('../../web/node_modules/next/navigation.js', () => ({ useRouter: () => ({ push: vi.fn() }) }))
import SoulDetailPage from '../../web/app/souls/[id]/page'

let root: Root, host: HTMLDivElement
let client: QueryClient
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const params = Promise.resolve({ id: id(12) })
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  m.wardrobe.mockClear()
  m.soul = { onChainId: id(12), stateOnChainId: id(13), name: 'Completed Soul', provenanceKind: 'animacraft',
    animacraftProvenance: null, currentOwnerAddress: id(1), creatorAddress: id(2), creatorRoyaltyBps: 500,
    originalPackageId: id(6), viewerAddress: null, currentOwnershipEpoch: '2', sourceRoyaltyBps: null,
    listingStatus: 'unlisted', chainListingStatus: 'HELD', purchaseAvailable: false,
    isOwner: false, isGrantedAgent: false, tags: [], contentVersions: [],
    activeGrants: [], activeGrantCount: '0', grantCapacity: '4', paidAccessEntries: [], paidAccessKindConfigs: [],
    createdAtMs: '1788652800000', observedAtMs: '1788652800000', createdAt: '2026-09-06T00:00:00Z' }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove() })
const render = async () => { await act(async () => root.render(<QueryClientProvider client={client}><SoulDetailPage params={params} /></QueryClientProvider>)) }
const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('[role=tab]')]
const openWardrobe = async () => { await act(async () => tabs().find(tab => tab.textContent === 'Wardrobe')!.click()) }

it.each([null, undefined, { animacraftVersion: 5, makerRoyaltyBps: 500 }])(
  'opens the one native equipment route regardless of obsolete provenance metadata: %j', async provenance => {
    m.soul.animacraftProvenance = provenance
    await render(); await openWardrobe()
    expect(m.wardrobe).toHaveBeenCalledWith({ soulObjectId: id(12), stateObjectId: id(13) })
    expect(host.querySelector('[aria-label="Native equipment route"]')?.textContent).toBe(id(12))
    expect(host.textContent).not.toContain('Physical Wardrobe v7')
  },
)
it('keeps ordinary Soul tabs and never mounts an Animacraft equipment caller', async () => {
  m.soul.provenanceKind = 'native'
  await render()
  expect(tabs().map(tab => tab.textContent)).toEqual(['Info', 'Persona Sprite0', 'Skills0', 'Memory0', 'Grants0'])
  expect(m.wardrobe).not.toHaveBeenCalled()
})
it('unmounts equipment when navigation replaces the Soul with an ordinary one', async () => {
  await render(); await openWardrobe(); m.wardrobe.mockClear()
  m.soul = { ...m.soul, onChainId: id(99), provenanceKind: 'native' }
  await render()
  expect(m.wardrobe).not.toHaveBeenCalled()
  expect(host.querySelector('[aria-label="Native equipment route"]')).toBeNull()
  expect(tabs().find(tab => tab.getAttribute('aria-selected') === 'true')?.textContent).toBe('Info')
})
it('shows native source and Soul creator royalties from verified observations, ignoring retired metadata', async () => {
  m.soul.listingStatus = 'listed'
  m.soul.chainListingStatus = 'LISTED'
  m.soul.sourceRoyaltyBps = 150
  m.soul.animacraftProvenance = { animacraftVersion: 5, makerRoyaltyBps: 950 }
  m.soul.quote = { priceAtomic: '1000000', totalAtomic: '1000000', makerRoyaltyBps: 150, soulCreatorRoyaltyBps: 350 }
  await render()
  expect(host.textContent).toContain('Maker-source royalty1.50%')
  expect(host.textContent).toContain('Soul creator royalty3.50%')
  expect(host.textContent).not.toContain('9.50%')
  expect(host.textContent).not.toContain('5.00%')
})
it('does not invent a Maker royalty from the Soul creator rate when its source is not verified', async () => {
  await render()
  expect(host.textContent).toContain('Maker-source royaltyNot verified')
  expect(host.textContent).toContain('Soul creator royalty5.00%')
})
it('keeps ordinary creator and Collection royalties distinct without adding a native Maker royalty', async () => {
  m.soul.provenanceKind = 'native'
  m.soul.collection = { onChainId: id(90), name: 'Ordinary Collection', extraRoyaltyBps: 200 }
  await render()
  expect(host.textContent).toContain('Creator royalty5.00%')
  expect(host.textContent).toContain('Collection royalty2.00%')
  expect(host.textContent).not.toContain('Maker-source royalty')
})
it('does not use retired version flags to block the current verified listing journey', async () => {
  m.soul.isOwner = true
  m.soul.animacraftProvenance = { animacraftVersion: 5 }
  m.soul.collectionOnChainId = id(90)
  await render()
  expect(host.querySelector(`a[href="/souls/${id(12)}/sell"]`)).not.toBeNull()
  expect(host.textContent).not.toContain('Animacraft v5')
  expect(host.textContent).toContain('Native Collection resale is not yet available')
})
