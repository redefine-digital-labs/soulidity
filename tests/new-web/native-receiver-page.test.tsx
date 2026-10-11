// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AnimacraftIntegrationClient } from '../../web/app/integrations/animacraft/integration-client'
import { NATIVE_RECEIVER_SCHEMA, type NativeRequest } from '../../web/lib/animacraft/native-handoff'

const f = vi.hoisted(() => ({ auth: {} as any, receive: vi.fn(), login: vi.fn() }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => f.auth }))
vi.mock('../../web/lib/hooks/use-login', () => ({ useLogin: () => f.login }))
vi.mock('../../web/lib/animacraft/browser-native-receive', () => ({ receiveBrowserNativeRequest: (...args: any[]) => f.receive(...args) }))
vi.mock('next/link', () => ({ default: ({ href, children }: any) => <a href={href}>{children}</a> }))
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const handoff = { source: 'animacraft-v8', root: id(1), owner: id(2), returnOrigin: 'https://animacraft.soulidity.ai', returnNonce: 'a'.repeat(32) }
const request = (): NativeRequest => ({ schemaVersion: NATIVE_RECEIVER_SCHEMA, type: 'SYNC', requestId: 'b'.repeat(32),
  nonce: handoff.returnNonce, rootId: handoff.root, signer: handoff.owner,
  payload: { txDigest: '8'.repeat(43), soulOnChainId: id(3), contentSidecars: [0, 1, 2].map(kind => ({ kind, name: kind === 0 ? 'soul' : 'default', versionIndex: 0,
    sidecar: { version: 1, mode: 'seal-envelope', sealPackageId: id(4), documentId: 'fixture-document', encryptedDek: 'fixture-ciphertext',
      iv: 'fixture-iv', cipher: 'AES-GCM-256', mimeType: 'text/markdown', fileName: 'fixture.md', contentHash: 'f'.repeat(64) } })) } })
let root: Root, host: HTMLDivElement, opener: { postMessage: ReturnType<typeof vi.fn> }
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
async function render() { await act(async () => root.render(<AnimacraftIntegrationClient handoff={handoff} />)); await flush() }
async function send(data = request(), source: any = opener, origin = handoff.returnOrigin) {
  await act(async () => window.dispatchEvent(new MessageEvent('message', { data, source, origin }))); await flush()
}
beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // Keep the browser storage contract explicit: Node's experimental global
  // localStorage can shadow jsdom's implementation without a backing file.
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    get length() { return storage.size },
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(String(key)) ?? null,
    key: (index: number) => [...storage.keys()][index] ?? null,
    removeItem: (key: string) => { storage.delete(String(key)) },
    setItem: (key: string, value: string) => { storage.set(String(key), String(value)) },
  } satisfies Storage)
  f.auth = { user: { id: id(2), primarySuiAddress: id(2) }, loading: false }
  f.receive.mockReset().mockImplementation(async (req, getAddress) => {
    expect(getAddress()).toBe(req.signer)
    return { status: 'COMPLETE', soulId: req.payload.soulOnChainId, transactionDigest: req.payload.txDigest }
  })
  opener = { postMessage: vi.fn() }; vi.stubGlobal('opener', opener)
  window.localStorage.clear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('actual message wiring rejects foreign senders and receives a verified Soul without an owned API', async () => {
  const fetcher = vi.fn(() => { throw new Error('Owned HTTP must not be used') }); vi.stubGlobal('fetch', fetcher)
  await render(); await send(request(), {}, handoff.returnOrigin); await send(request(), opener, 'https://untrusted.example')
  expect(f.receive).not.toHaveBeenCalled()
  await send()
  expect(f.receive).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled()
  expect(opener.postMessage).toHaveBeenCalledWith(expect.objectContaining({ result: { status: 'COMPLETE', soulId: id(3), transactionDigest: '8'.repeat(43) } }), handoff.returnOrigin)
  expect(host.textContent).toContain('Soul received')
  expect(host.querySelector(`a[href="/souls/${id(3)}"]`)).not.toBeNull()
})

it('pending envelopes show an actionable no-remint alert and Retry re-verifies the original request', async () => {
  f.receive.mockRejectedValueOnce(Object.assign(new Error('private diagnostic'), { code: 'NATIVE_RECEIVE_ENVELOPE_PENDING' }))
  await render(); await send()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('do not mint again')
  expect(host.textContent).not.toContain('private diagnostic')
  expect(host.querySelector(`a[href="/souls/${id(3)}"]`)).toBeNull()
  const retry = [...host.querySelectorAll('button')].find(button => button.textContent === 'Retry verification')!
  expect(retry.disabled).toBe(false)
  await act(async () => retry.click()); await flush()
  expect(f.receive).toHaveBeenCalledTimes(2)
  expect(f.receive.mock.calls[1][0]).toEqual(request())
  expect(host.textContent).toContain('Soul received'); expect(host.querySelector('[role="alert"]')).toBeNull()
})

it('a wallet switch invalidates late results and supplies the live account to verification', async () => {
  let finish!: (value: unknown) => void; let getAddress!: () => string | null
  f.receive.mockImplementation((_request, address) => { getAddress = address; return new Promise(resolve => { finish = resolve }) })
  await render(); await send()
  f.auth = { user: { id: id(9), primarySuiAddress: id(9) }, loading: false }; await render()
  expect(getAddress()).toBe(id(9))
  await act(async () => finish({ status: 'COMPLETE', soulId: id(3), transactionDigest: '8'.repeat(43) })); await flush()
  expect(opener.postMessage).not.toHaveBeenCalled()
  expect(host.textContent).not.toContain('Soul received')
  expect(host.querySelector(`a[href="/souls/${id(3)}"]`)).toBeNull()
})
