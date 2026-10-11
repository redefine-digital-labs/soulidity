import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { NativeEquipmentPreview } from '../../../web/components/souls/native-equipment-preview'
import { NativeCurrentAppearance } from '../../../web/components/souls/native-current-appearance'
import { SoulCoverImage } from '../../../web/components/souls/soul-cover-image'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
const publicMode = new URLSearchParams(location.search).get('public') === '1'
const cardsMode = new URLSearchParams(location.search).get('cards') === '1'
const queries = new QueryClient()
let protectedScene = false
let data: any
const client = { grpc: {} }, wallet = {}
const empty = () => localStorage.getItem('s8-preview-empty') === 'yes'
export const useCurrentAccount = () => ({ address: data.snapshot.owner })
export const useSuiClient = () => client
export const useCurrentWallet = () => ({ currentWallet: wallet })
export const useSignPersonalMessage = () => ({ mutateAsync: async () => { throw Error('No signing in public-media fixture') } })
export const getBrowserNativeArtworkConfig = () => ({ target: {} })
export const readBrowserNativeArtwork = () => { throw Error('Historical artwork must not be requested') }
export const getBrowserNativeProtectedArtworkConfig = () => { throw Error('No protected substitution allowed') }
export const readBrowserNativeEquipmentReadTarget = () => { throw Error('No protected substitution allowed') }
export const readBrowserNativeEquipmentRenderTarget = async () => {
  const scene = structuredClone(empty() ? data.emptyScene : data.scene)
  if(protectedScene && scene.status === 'AVAILABLE')scene.scene.layers[0].protected=true
  return scene
}
function App() {
  const [cleared, setCleared] = useState(empty())
  return <main className="p-6"><p>Controlled raw-reader snapshots and public PNG; original preview and real renderer. No wallet or transactions.</p>
    <button onClick={() => { localStorage.setItem('s8-preview-empty', cleared ? 'no' : 'yes'); setCleared(!cleared)
      queries.setQueryData(['native-equipment',data.snapshot.soulId,data.snapshot.stateId],{empty:!cleared}) }}>
      {cleared ? 'Fixture: restore equipped snapshot' : 'Fixture: switch to saved empty snapshot'}</button>
    {publicMode ? <><button onClick={()=>{protectedScene=!protectedScene
      queries.setQueryData(['native-equipment',data.snapshot.soulId,data.snapshot.stateId],{protectedScene})}}>Fixture: toggle protected scene</button>
      {cardsMode ? <div style={{display:'flex',gap:24,alignItems:'start'}}>{[44,240].map(size=><a key={size} href="#card-opened" aria-label={`Soul card ${size}`} style={{display:'block',width:size,height:size===44?44:300}}>
        <SoulCoverImage compact={size===44} soul={{provenanceKind:'animacraft',onChainId:data.snapshot.soulId,stateOnChainId:data.snapshot.stateId,
          currentOwnerAddress:data.snapshot.owner,currentOwnershipEpoch:data.snapshot.ownershipEpoch}}
          imageUrl="forbidden-original.png" fallback={<span>Forbidden old fallback</span>}
          className="h-full w-full" /></a>)}</div> : <NativeCurrentAppearance soulId={data.snapshot.soulId} stateId={data.snapshot.stateId}
        owner={data.snapshot.owner} ownershipEpoch={data.snapshot.ownershipEpoch} className="h-96" />}</>
      : <NativeEquipmentPreview snapshot={cleared ? data.emptySnapshot : data.snapshot} />}
  </main>
}
async function main() {
  const originalFetch = window.fetch.bind(window)
  data = await (await originalFetch('./preview.json')).json()
  window.fetch = (input, init) => {
    const url = String(input)
    if (url.endsWith(`/v1/blobs/${data.mediaBlobId}`)) return originalFetch('./media.png', init)
    throw Error('Unexpected fixture network request')
  }
  createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queries}><App /></QueryClientProvider>)
}
void main()
