import React from 'react'
import { createRoot } from 'react-dom/client'
import Gas from '../../../web/app/create/gas/page'
import Success from '../../../web/app/create/success/page'
import ImportGas from '../../../web/app/import/gas/page'
import ImportSuccess from '../../../web/app/import/success/page'
import WrapPreview from '../../../web/app/wrap-link/personal/preview/page'
import WrapSuccess from '../../../web/app/wrap-link/personal/success/page'
import WrapSelect from '../../../web/app/wrap-link/personal/page'
import WrapConfigure from '../../../web/app/wrap-link/personal/configure/page'
import CollectionPreview from '../../../web/app/collections/create/preview/page'
import CollectionSuccess from '../../../web/app/collections/create/success/page'
import CollectionInfo from '../../../web/app/collections/create/page'
import CollectionSouls from '../../../web/app/collections/create/souls/page'
import { CreateCollectionProvider } from '../../../web/components/providers/create-collection-provider'
import { CreateSoulProvider } from '../../../web/components/providers/create-soul-provider'
import CreateInfo from '../../../web/app/create/page'
import CreateContent from '../../../web/app/create/content/page'
import CreatePreview from '../../../web/app/create/preview/page'
import CollectionDetail from '../../../web/app/collections/[id]/page'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFixture, setScenario, setArchiveFailure, toGas, coldWrapEntry, initializeRecoveryFixture, verifyDownloadedRecovery } from './ordinary-create-browser-stubs'
function App() {
  const f = useFixture()
  return <><aside style={{ padding: 12, background: '#352548' }}>
    <strong>{new URLSearchParams(location.search).has('recovery-export') || new URLSearchParams(location.search).has('recovery-import')
      ? 'Controlled recovery fixture — original page/controller and real IndexedDB; test ciphertext, no wallet or payments'
      : 'Controlled browser fixture — original pages/controller; fake ledger/storage, no wallet or payments'}</strong>
    <div>Outcome: {f.scenario} · preparations:{f.preparations} · registrations:{f.registrations} · mint attempts:{f.mintAttempts}</div>
    {['FAILED', 'EXPIRED', 'SUCCEEDED'].map(s => <button style={{ margin: 6 }} key={s} onClick={() => setScenario(s)}>Fixture {s}</button>)}
    <label><input type="checkbox" checked={f.archiveFails} onChange={e => setArchiveFailure(e.target.checked)} />Fixture archive failure</label>
    <button onClick={coldWrapEntry}>{new URLSearchParams(location.search).get('flow') === 'collection'
      ? 'Fixture reopen Collection entry (retain saved packets)' : 'Fixture return without NFT or files'}</button>
    {(new URLSearchParams(location.search).has('recovery-export') || new URLSearchParams(location.search).has('recovery-import')) && <label>Verify downloaded recovery (test only)
      <input type="file" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void verifyDownloadedRecovery(file).catch(error => alert(String(error))) }} /></label>}
  </aside>
  {f.route.startsWith('/collections/0x') ? <React.Suspense fallback={<p>Loading Collection</p>}><CollectionDetail params={detailParams} /></React.Suspense>
    : f.route.startsWith('/create?') || f.route === '/create' ? <CreateInfo /> : f.route === '/create/content' ? <CreateContent /> : f.route === '/create/preview' ? <CreatePreview />
    : f.route === '/create/gas' ? <Gas /> : f.route === '/create/success' ? <Success />
    : f.route === '/collections/create' ? <CollectionInfo /> : f.route === '/collections/create/souls' ? <CollectionSouls />
    : f.route === '/collections/create/preview' ? <CollectionPreview /> : f.route === '/collections/create/success' ? <CollectionSuccess />
    : f.route === '/import/gas' ? <ImportGas /> : f.route === '/import/success' ? <ImportSuccess />
    : f.route === '/wrap-link/personal/preview' ? <WrapPreview /> : f.route === '/wrap-link/personal/success' ? <WrapSuccess />
    : f.route === '/wrap-link/personal' ? <WrapSelect /> : f.route === '/wrap-link/personal/configure' ? <WrapConfigure />
    : <main><h1>New creation entry</h1><button onClick={toGas}>Open next creation fee step</button></main>}
  <details open><summary>Controlled evidence log</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{f.events.join('\n')}</pre></details></>
}
const detailParams = Promise.resolve({ id: '0x' + '1e'.padStart(64, '0') })
const queryClient = new QueryClient()
const content = new URLSearchParams(location.search).get('flow') === 'collection'
  ? <CreateCollectionProvider><App /></CreateCollectionProvider> : <App />
void initializeRecoveryFixture().then(() => {
  createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><CreateSoulProvider>{content}</CreateSoulProvider></QueryClientProvider>)
}).catch(error => { document.getElementById('root')!.textContent = String(error) })
