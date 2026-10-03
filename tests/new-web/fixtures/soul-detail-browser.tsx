import React, { Suspense, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SoulDetailPage from '../../../web/app/souls/[id]/page'
import { createContentBrowserCrypto } from './content-browser-crypto'
import { createContentAppendBrowserRuntime } from './content-append-browser-runtime'
import { createMutationUiRuntime } from './content-mutation-ui-runtime'
import { browserContentAppendStore } from '../../../web/lib/soulidity/content-append-store'
import { state, formAppend, formGrant } from './soul-detail-browser-state'

async function main() {
  const connected = new URLSearchParams(location.search).has('append-connected')
  const mutation = new URLSearchParams(location.search).has('mutation-success')
  state.crypto = mutation ? await createMutationUiRuntime() : connected ? await createContentAppendBrowserRuntime()
    : await createContentBrowserCrypto({ emptyMemory: new URLSearchParams(location.search).has('empty') })
  state.appendRuntime = connected || mutation ? state.crypto : null
  state.account = state.crypto.account
  state.soul = connected || mutation ? await state.appendRuntime.detail() : await (await fetch('./detail.json')).json()
  if (connected) window.confirm = () => true // Test key/ledger only; no user wallet, payment or production approval.
  const original = structuredClone(state.soul!)
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const params = Promise.resolve({ id: original.onChainId })
  function App() {
    const [, redraw] = useState(0)
    const [storage, setStorage] = useState('Not inspected')
    state.notify = () => redraw(n => n + 1)
    function switchViewer() {
      state.visitor = !state.visitor
      state.account = state.visitor ? {address: '0x' + '99'.padStart(64, '0')} : state.crypto.account
      state.soul = { ...original, viewerAddress: state.account!.address, isOwner: !state.visitor,
        isCreator: false, isGrantedAgent: false, currentKioskCapOnChainId: state.visitor ? null : original.currentKioskCapOnChainId }
      state.notify()
    }
    return <QueryClientProvider client={query}>
      <aside style={{padding: 12, background: '#e0f2fe', color: '#111'}}>
        <strong>Controlled local read journey — original Soul detail UI</strong>
        <p>{mutation ? 'Original mutation hook, runner, native storage and raw readers. One pre-signed fixture transaction; controlled ledger, no real wallet or broadcast.' : connected ? 'Original append hook, preparation, runner and IndexedDB. Controlled upload/ledger; test confirmations accepted automatically. No real transaction.' : 'Real read hook / Seal / AES; controlled authority and key service. Writes disabled. No live wallet or chain acceptance.'}</p>
        <button disabled={connected || mutation} onClick={switchViewer}>Fixture viewer: {mutation ? original.isOwner ? 'owner' : 'visitor' : state.visitor ? 'unauthorized' : 'owner'} — switch</button>
        <output aria-label="Fixture read evidence">{JSON.stringify(state.crypto.stats ?? {})}</output>
        {new URLSearchParams(location.search).has('grant-form') && <section>
          <p>Grant form completion only. No grant issued, transaction or permission change.</p>
          <output aria-label="Submitted grant">{formGrant.submitted}</output>
          <button disabled={!formGrant.complete} onClick={()=>formGrant.complete?.()}>Fixture finish grant form</button>
        </section>}
        {connected && <section aria-label="Append storage evidence">
          <button onClick={() => void (async () => {
            const store = browserContentAppendStore(state.crypto.client)
            const scope = {originalPackageId: original.originalPackageId, author: state.account!.address, contentObjectId: original.contentOnChainId}
            const active = await store.list(scope), archived = await store.listArchived(scope)
            setStorage(JSON.stringify({active: active.length, archived: archived.length,
              records: archived.map(r => ({name:r.scope.name,version:r.scope.versionIndex,content:r.scope.contentObjectId,bytes:r.ciphertext.length}))}))
          })().catch(e => setStorage(String(e)))}>Inspect saved encrypted records</button>
          <output aria-label="Saved encrypted records">{storage}</output>
        </section>}
        {new URLSearchParams(location.search).has('append-form') && <section aria-label="Controlled form completion">
          <p>Form-only append completion seam. No transaction, new version or persistence is simulated.</p>
          <output aria-label="Submitted memory">{formAppend.submitted}</output>
          <button disabled={!formAppend.complete} onClick={() => formAppend.complete?.()}>Fixture resolve append</button>
          <button disabled={!formAppend.fail} onClick={() => formAppend.fail?.()}>Fixture reject append</button>
          <button disabled={!formAppend.cancel} onClick={() => formAppend.cancel?.()}>Fixture cancel preparation</button>
        </section>}
      </aside>
      <Suspense fallback="Loading original Soul detail…"><SoulDetailPage params={params}/></Suspense>
    </QueryClientProvider>
  }
  createRoot(document.getElementById('root')!).render(<App />)
}
void main().catch(error => { document.getElementById('root')!.textContent = String(error) })
