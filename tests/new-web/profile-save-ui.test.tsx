// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ProfilePage from '../../web/app/profile/page'
import {useUpdateProfile} from '../../web/lib/hooks/use-profile'

const f = vi.hoisted(() => ({ grpc:{},wallet:{name:"wallet-a"},account:{address:"fixture"} as any,auth: {} as any, snapshot: {} as any, run: vi.fn(), fetch: vi.fn(), sign: vi.fn(), upload: vi.fn(),
  refresh: vi.fn(),controller:null as any,approve:vi.fn(),
  deployment: { originalPackageId: `0x${'1'.repeat(64)}`, callablePackageId: `0x${'2'.repeat(64)}`,
    registryId: `0x${'3'.repeat(64)}`, chainIdentifier: '01010101' } }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => f.auth }))
vi.mock('../../web/components/auth/auth-gate', () => ({ AuthGate: ({ children }: any) => children }))
vi.mock('../../web/components/ui/cover-image-picker', () => ({ CoverImagePicker: () => <div data-testid="cover-picker" /> }))
vi.mock('../../web/components/upload/upload-cost-review', () => ({ useUploadCostReview: () => ({ requestUploadCostApproval:f.approve }) }))
vi.mock('../../web/lib/hooks/use-wallet-sign', () => ({ useWalletSign: () => ({ suiGrpcClient:f.grpc,walletAccount:f.account,currentWallet:f.wallet, getWalletAddress: () => f.auth.walletAddress, signTransaction: f.sign }) }))
vi.mock('../../web/lib/profile/profile-config', () => ({ getBrowserProfileConfig: () => ({ deployment: f.deployment,
  storage: { aggregatorUrl: 'https://agg.example', blobType: `0x${'7'.repeat(64)}::blob::Blob` }, writesEnabled: true }) }))
vi.mock('../../web/lib/profile/profile-operation-client', () => ({ browserPublicProfileOperationStore: () => ({}) }))
vi.mock('../../web/lib/profile/profile-cover-cache', () => ({ browserProfileCoverCache: () => ({}) }))
vi.mock('../../web/lib/profile/profile-save-controller', () => ({ browserProfileDraftStore: () => ({}),
  createProfileSaveController: (params:any) => {f.controller=params;return { run: f.run, inspect: () => f.snapshot }}, ProfileDraftPersistenceError: class extends Error {} }))
vi.mock('../../web/lib/upload/client-upload', () => ({ uploadSoulPayload: f.upload,
  acknowledgeWalrusSingleBlobUpload: vi.fn(), recoverWalrusSingleBlobUpload: vi.fn() }))

let host: HTMLDivElement, root: Root
const wallet = `0x${'4'.repeat(64)}`
function intent() {
  return { deployment: f.deployment, owner: wallet, expected: null, handle: 'alice', metadata: {
    schema: 'soulidity.public-profile.v1', displayName: 'Alice', avatar: '🦊', bio: 'bio', coverImageUrl: null,
    twitterUrl: null, websiteUrl: null } }
}
function button(text: string) {
  const value = [...host.querySelectorAll('button')].find(node => node.textContent === text)
  if (!value) throw new Error(`Missing button: ${text}`)
  return value
}
async function click(text: string) { await act(async () => button(text).click()) }
async function render() { await act(async () => root.render(<ProfilePage />)) }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', f.fetch)
  f.auth = { user: { id: wallet, primarySuiAddress: wallet, displayName: 'Alice', handle: 'alice', avatar: '🦊', bio: 'bio',
    coverImageUrl: null, twitterUrl: null, websiteUrl: null }, walletAddress: wallet, profile: null,
    profileError: null, loading: false, refresh: f.refresh }
  f.snapshot = { draft: null, operation: null }
  f.run.mockReset().mockImplementation(async args => ({ status: 'saved', intent: args.intent }))
  f.refresh.mockResolvedValue(undefined)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
it('original Save passes canonical public form to the browser controller, not an owned API', async () => {
  await render(); await click('Save Profile')
  expect(f.run).toHaveBeenCalledOnce()
  expect(f.run.mock.calls[0][0]).toMatchObject({ mode: 'save', intent: intent(), coverFile: null })
  expect(host.textContent).toContain('Profile saved successfully')
  expect(f.fetch).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled()
})
it('profile read failure is visible, blocks Save, and retry only refreshes chain data', async () => {
  f.auth.profileError = 'RPC unavailable'; await render()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('RPC unavailable')
  expect(button('Save Profile').disabled).toBe(true)
  await click('Save Profile'); expect(f.run).not.toHaveBeenCalled()
  await click('Retry chain read'); expect(f.refresh).toHaveBeenCalledOnce()
  expect(f.fetch).not.toHaveBeenCalled()
})
it('shows the frozen record after reload and query passes no edited form or upload request', async () => {
  const frozen = intent(); frozen.metadata.displayName = 'Frozen earlier name'
  f.snapshot = { draft: { intent: frozen, cover: null }, operation: null }
  f.run.mockResolvedValue({ status: 'pending', intent: frozen })
  await render()
  expect(host.querySelector('[aria-label="Pending profile save"]')?.textContent).toContain('Frozen earlier name')
  expect(button('Save Profile').disabled).toBe(true)
  expect(host.querySelector('fieldset')?.disabled).toBe(true)
  await click('Check result')
  expect(f.run.mock.calls[0][0].mode).toBe('query')
  expect(host.textContent).not.toContain('Profile saved successfully')
  expect(f.sign).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled()
})
it('a pending save retains recovery UI and cannot show success until the controller confirms it', async () => {
  f.run.mockImplementation(async args => {
    f.snapshot = { draft: { intent: args.intent, cover: null }, operation: null }
    return { status: 'pending', intent: args.intent }
  })
  await render(); await click('Save Profile')
  expect(host.textContent).toContain('The save is not yet confirmed')
  expect(host.textContent).not.toContain('Profile saved successfully')
  expect(button('Save Profile').disabled).toBe(true)
  expect(button('Export recovery record')).toBeTruthy()
})
it('wallet switching drops the old success result and never refreshes the new wallet for it', async () => {
  let resolve!: (value: unknown) => void
  f.run.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await render(); await click('Save Profile')
  f.auth = { ...f.auth, walletAddress: `0x${'5'.repeat(64)}`, user: { ...f.auth.user,
    id: `0x${'5'.repeat(64)}`, primarySuiAddress: `0x${'5'.repeat(64)}`, displayName: 'Bob' } }
  await render()
  await act(async () => resolve({ status: 'saved', intent: intent() }))
  expect(host.textContent).not.toContain('Profile saved successfully')
  expect((host.querySelector('input[placeholder="Your display name"]') as HTMLInputElement).value).toBe('Bob')
  expect(f.refresh).not.toHaveBeenCalled()
})
it('archive failures keep the frozen record visible instead of permitting a replacement Save', async () => {
  f.snapshot = { draft: { intent: intent(), cover: null }, operation: null }
  f.run.mockRejectedValueOnce(new Error('PROFILE_UPLOAD_UNRESOLVED_CANNOT_DISCARD'))
  await render(); await click('Archive safe record')
  expect(host.textContent).toContain('PROFILE_UPLOAD_UNRESOLVED_CANNOT_DISCARD')
  expect(button('Save Profile').disabled).toBe(true)
  expect(button('Export recovery record')).toBeTruthy()
})
it('revokes old profile signing and upload approval after a same-owner wallet switch',async()=>{
  let operation!:ReturnType<typeof useUpdateProfile>
  function Probe(){operation=useUpdateProfile();return null}
  await act(async()=>root.render(<Probe/>))
  const old=f.controller
  let approve!:(value:boolean)=>void
  f.approve.mockImplementationOnce(()=>new Promise(resolve=>{approve=resolve}))
  f.upload.mockImplementationOnce(async options=>{
    await options.confirmQuote({})
    return {recoveryKey:'old-key'}
  })
  const upload=old.uploads.upload(new File(['cover'],'cover.png'),'scope',wallet)
  const rejected=expect(upload).rejects.toThrow('Profile context changed')
  f.wallet={name:'replacement'}
  await act(async()=>root.render(<Probe/>))
  expect(old.getAddress()).toBeNull();expect(()=>old.sign({})).toThrow('Profile context changed')
  approve(true);await rejected
  expect(operation.status).toBe('idle');expect(f.sign).not.toHaveBeenCalled()
})
it('does not apply a profile save after wallet ABA',async()=>{
  let operation!:ReturnType<typeof useUpdateProfile>,finish!:(value:any)=>void
  function Probe(){operation=useUpdateProfile();return null}
  await act(async()=>root.render(<Probe/>))
  f.run.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  let saving!:Promise<unknown>
  await act(async()=>{saving=operation.updateProfile({})})
  const old=f.controller
  f.auth.walletAddress=`0x${'5'.repeat(64)}`;await act(async()=>root.render(<Probe/>))
  f.auth.walletAddress=wallet;await act(async()=>root.render(<Probe/>))
  await act(async()=>{finish({status:'saved'});await saving})
  expect(operation.status).toBe('idle');expect(old.getAddress()).toBeNull();expect(f.refresh).not.toHaveBeenCalled()
})
