// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { NativePublicPaidContentReaderV2 } from '../../web/components/souls/native-public-paid-content-reader-v2'
const m = vi.hoisted(() => ({ open: vi.fn(), ownerOpen: vi.fn(), preview: vi.fn(), reuse: vi.fn(), sign: vi.fn(), address: '0x' + '11'.repeat(32), client: {} }))
vi.mock('../../web/lib/hooks/use-wallet-sign', () => ({ useWalletSign: () => ({ suiWallet: { address: m.address }, suiGrpcClient: m.client,
  getWalletAddress: () => m.address, signPersonalMessage: m.sign }) }))
vi.mock('../../web/lib/sui/package-object-client', () => ({ withPackageObjectIdentity: (client: any) => client }))
vi.mock('../../web/lib/soulidity/browser-content-open', () => ({ getBrowserContentSealConfig: () => ({}) }))
vi.mock('../../web/lib/soulidity/canonical-native-workbench', () => ({ parseCanonicalNativeWorkbenchTarget: () => ({}) }))
vi.mock('../../web/lib/soulidity/native-public-paid-content-open-v2', () => ({ openNativePublicPaidContentV2: m.open }))
vi.mock('../../web/lib/soulidity/commerce/native-public-read-paid-delivery-v2', () => ({ openReusableNativePublicReadContentV2: m.reuse }))
vi.mock('../../web/lib/soulidity/commerce/native-public-read-paid-preview-v2', () => ({ readContractCheckedNativePublicReadPaidPreviewV2: m.preview }))
vi.mock('../../web/lib/soulidity/native-public-owner-content-open-v2', () => ({ openNativePublicOwnerContentV2: m.ownerOpen }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
async function render(sourceKey = 'original-soul') {
  await act(async () => root.render(<NativePublicPaidContentReaderV2 soulId="same-soul" index={0} releaseJson="{}" sourceKey={sourceKey} />))
}
async function click(label: string) {
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === label)!.click())
}
beforeEach(async () => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  m.open.mockReset(); m.ownerOpen.mockReset(); m.preview.mockReset(); m.reuse.mockReset(); m.sign.mockReset(); m.address = '0x' + '11'.repeat(32)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); await render()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
it('opens content only on explicit action and clears bytes and the visible body on close', async () => {
  const bytes = new TextEncoder().encode('LOCAL TEST BODY'); m.open.mockResolvedValue({ bytes, mimeType: 'text/plain', fileName: 'soul.md', downloadAllowed: false })
  expect(m.open).not.toHaveBeenCalled(); await click('Read protected content')
  expect(host.textContent).toContain('LOCAL TEST BODY'); await click('Close content')
  expect(bytes.every(b => b === 0)).toBe(true); expect(host.textContent).not.toContain('LOCAL TEST BODY')
})
it.each(['wallet', 'source'] as const)('changing %s clears the previous plaintext immediately', async mode => {
  const bytes = new TextEncoder().encode('LOCAL TEST BODY'); m.open.mockResolvedValue({ bytes, mimeType: 'text/markdown', fileName: 'soul.md' })
  await click('Read protected content'); expect(host.textContent).toContain('LOCAL TEST BODY')
  if (mode === 'wallet') m.address = '0x' + '22'.repeat(32)
  await render(mode === 'source' ? 'changed-source' : 'original-soul')
  expect(bytes.every(b => b === 0)).toBe(true); expect(host.textContent).not.toContain('LOCAL TEST BODY')
})
it('a late result from the previous wallet is wiped and never rendered', async () => {
  let finish!: (value: any) => void
  m.open.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await click('Read protected content'); m.address = '0x' + '22'.repeat(32); await render()
  const bytes = new TextEncoder().encode('LATE TEST BODY')
  await act(async () => finish({ bytes, mimeType: 'text/plain', fileName: 'soul.md' }))
  expect(bytes.every(b => b === 0)).toBe(true); expect(host.textContent).not.toContain('LATE TEST BODY')
})
it('revokes image preview URLs and wipes bytes on close',async()=>{
 const create=vi.fn(()=> 'blob:private-preview'),revoke=vi.fn();vi.stubGlobal('URL',class extends URL{static createObjectURL=create;static revokeObjectURL=revoke})
 const bytes=new Uint8Array([1,2,3]);m.open.mockResolvedValue({bytes,mimeType:'image/png',fileName:'pet.png'})
 await click('Read protected content');expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:private-preview')
 await click('Close content');expect(revoke).toHaveBeenCalledWith('blob:private-preview');expect(bytes.every(b=>b===0)).toBe(true);expect(host.querySelector('img')).toBeNull()
})
it.each(['wallet','source','unmount'])('revokes an active image preview when %s invalidates the view',async mode=>{
 const create=vi.fn(()=>'blob:private-image'),revoke=vi.fn();vi.stubGlobal('URL',class extends URL{static createObjectURL=create;static revokeObjectURL=revoke})
 const bytes=new Uint8Array([1,2,3]);m.open.mockResolvedValue({bytes,mimeType:'image/png',fileName:'pet.png'});await click('Read protected content')
 if(mode==='wallet')m.address='0x'+'22'.repeat(32)
 if(mode==='unmount')await act(async()=>root.render(<></>));else await render(mode==='source'?'changed-source':'original-soul')
 expect(revoke).toHaveBeenCalledWith('blob:private-image');expect(bytes.every(b=>b===0)).toBe(true);expect(host.querySelector('img')).toBeNull()
})
it('offers an SVG as binary download without embedding it', async () => {
  const create = vi.fn((_blob: Blob) => 'blob:private-download'), revoke = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke })
  const bytes = new TextEncoder().encode('<svg onload="alert(1)"></svg>')
  m.open.mockResolvedValue({ bytes, mimeType: 'image/svg+xml', fileName: 'unsafe.svg', downloadAllowed: true })
  await click('Read protected content')
  expect(host.querySelector('img,svg,iframe,object,embed')).toBeNull()
  expect(host.querySelector('a[download="unsafe.svg"]')?.getAttribute('href')).toBe('blob:private-download')
  expect(create.mock.calls[0][0].type).toBe('application/octet-stream')
  await click('Close content')
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:private-download')
  expect(bytes.every(value => value === 0)).toBe(true)
  expect(host.querySelector('a[download]')).toBeNull()
})
it.each(['wallet', 'source', 'unmount'])('revokes a binary download when %s invalidates the view', async mode => {
  const create = vi.fn(() => 'blob:private-file'), revoke = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke })
  const bytes = new Uint8Array([0, 253, 255])
  m.open.mockResolvedValue({ bytes, mimeType: 'text/plain', fileName: 'binary.txt', downloadAllowed: true })
  await click('Read protected content')
  expect(host.querySelector('a[download="binary.txt"]')?.getAttribute('href')).toBe('blob:private-file')
  if (mode === 'wallet') m.address = '0x' + '22'.repeat(32)
  if (mode === 'unmount') await act(async () => root.render(<></>))
  else await render(mode === 'source' ? 'changed-source' : 'original-soul')
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:private-file')
  expect(bytes.every(value => value === 0)).toBe(true)
  expect(host.querySelector('a[download]')).toBeNull()
})

it('lets a new wallet read while an old prompt is pending, and an old rejection cannot wipe new content',async()=>{
 let reject!:(e:Error)=>void;m.open.mockImplementationOnce(()=>new Promise((_resolve,no)=>{reject=no}))
 await click('Read protected content');m.address='0x'+'22'.repeat(32);await render()
 const bytes=new TextEncoder().encode('NEW WALLET CONTENT');m.open.mockResolvedValueOnce({bytes,mimeType:'text/plain',fileName:'new.txt'})
 await click('Read protected content');expect(m.open).toHaveBeenCalledTimes(2);expect(host.textContent).toContain('NEW WALLET CONTENT')
 await act(async()=>reject(Error('OLD PROMPT REJECTED')))
 expect(host.textContent).toContain('NEW WALLET CONTENT');expect(new TextDecoder().decode(bytes)).toBe('NEW WALLET CONTENT');expect(host.textContent).not.toContain('OLD PROMPT REJECTED')
})

it('selects owner policy for owner-only content and never falls back after rejection',async()=>{
 await act(async()=>root.render(<NativePublicPaidContentReaderV2 soulId="same-soul" index={0} releaseJson="{}" sourceKey="owner-source" ownerAddress={m.address} ownerRead paidRead={false}/>))
 m.ownerOpen.mockRejectedValue(Error('OWNER_POLICY_DENIED'));await click('Read protected content')
 expect(m.ownerOpen).toHaveBeenCalledOnce();expect(m.open).not.toHaveBeenCalled();expect(host.textContent).toContain('OWNER_POLICY_DENIED')
})
it('disables owner-only read for another wallet and clears content when access mode changes',async()=>{
 const bytes=new TextEncoder().encode('OWNER BODY');m.ownerOpen.mockResolvedValue({bytes,mimeType:'text/plain',fileName:'soul.md'})
 const props={soulId:'same-soul',index:0,releaseJson:'{}',sourceKey:'owner-source',ownerAddress:m.address,ownerRead:true,paidRead:false}
 await act(async()=>root.render(<NativePublicPaidContentReaderV2 {...props}/>));await click('Read protected content');expect(host.textContent).toContain('OWNER BODY')
 await act(async()=>root.render(<NativePublicPaidContentReaderV2 {...props} ownerAddress={'0x'+'22'.repeat(32)}/>))
 expect(bytes.every(v=>v===0)).toBe(true);expect(host.textContent).not.toContain('OWNER BODY');expect(host.querySelector('button')!.disabled).toBe(true)
})


const selectedPaidRecord = {
  soulId: 'same-soul', index: 2, releaseJson: '{}', sourceKey: 'appended-soul', expectedOwnerSourceKey: 'committed-record-two',
  ownerAddress: '0x' + '99'.repeat(32), ownerRead: true, paidPreview: { kind: 3, scope: '8' },
}
it('checks the exact appended version, shows current Entry reuse and opens through the bound protected reader', async () => {
  await act(async () => root.render(<NativePublicPaidContentReaderV2 {...selectedPaidRecord} />))
  m.preview.mockResolvedValue({ status: 'NO_NEW_PURCHASE_QUOTE', qualification: { decision: { action: 'REUSE_ENTRY' } } })
  await click('核对当前资格与总价')
  expect(m.preview).toHaveBeenCalledWith(expect.objectContaining({
    soulId: selectedPaidRecord.soulId, buyer: m.address, recordIndex: 2, kind: 3, requiredScope: 8n,
    expectedSourceKey: 'committed-record-two', economics: undefined,
  }))
  expect(host.textContent).toContain('现有同类订阅覆盖此版本的范围')
  expect(host.textContent).not.toContain('合约核对总价')
  expect(m.sign).not.toHaveBeenCalled()
  expect(m.open).not.toHaveBeenCalled()
  m.reuse.mockResolvedValue({ status: 'CONTENT_OPENED',
    content: { bytes: new TextEncoder().encode('Appended record body'), mimeType: 'text/plain', fileName: 'appended.txt' } })
  await click('Read protected content')
  expect(m.reuse).toHaveBeenCalledWith(expect.objectContaining({ qualification: expect.objectContaining({
    recordIndex: 2, expectedSourceKey: 'committed-record-two', buyer: m.address, kind: 3, requiredScope: 8n,
  }) }))
  expect(m.open).not.toHaveBeenCalled()
  expect(host.textContent).toContain('Appended record body')
})
it('shows the checked additive total and separates Gas without signing', async () => {
  await act(async () => root.render(<NativePublicPaidContentReaderV2 {...selectedPaidRecord} />))
  m.preview.mockResolvedValue({ status: 'CONTRACT_QUOTE_CHECKED', contractQuote: { contractQuote: { total: '104' } },
    qualification: { decision: { action: 'PURCHASE_REQUIRED' }, quote: { ask: '101', platformFee: '3', total: '104' }, coinType: '0x2::sui::SUI', purchaseBlockers: [] } })
  await click('核对当前资格与总价')
  expect(host.textContent).toContain('合约核对总价（最小单位）104')
  expect(host.textContent).toContain('内容发行方收款 101 · 平台费 3')
  expect(host.textContent).toContain('SUI Gas 在交易审阅时另算')
  expect(m.open).not.toHaveBeenCalled()
  expect(m.sign).not.toHaveBeenCalled()
  m.preview.mockResolvedValue({ status: 'QUOTE_UNAVAILABLE', qualification: { decision: { action: 'PURCHASE_REQUIRED' } } })
  await click('核对当前资格与总价')
  expect(host.textContent).toContain('暂无法核对完整总价')
  expect(host.textContent).not.toContain('104')
})
it('aborts a pending preview and hides the result when the library selection changes', async () => {
  await act(async () => root.render(<NativePublicPaidContentReaderV2 {...selectedPaidRecord} />))
  let finish!: (value: unknown) => void
  m.preview.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await click('核对当前资格与总价')
  const { signal } = m.preview.mock.calls[0][0]
  await act(async () => root.render(<NativePublicPaidContentReaderV2 {...selectedPaidRecord} index={3} expectedOwnerSourceKey="other" />))
  expect(signal.aborted).toBe(true)
  await act(async () => finish({ status: 'NO_NEW_PURCHASE_QUOTE', qualification: { decision: { action: 'REUSE_ENTRY' } } }))
  expect(host.textContent).not.toContain('现有同类订阅')
})

it('keeps content closed when the actual read no longer has reusable access', async () => {
  await act(async () => root.render(<NativePublicPaidContentReaderV2 {...selectedPaidRecord} />))
  m.reuse.mockResolvedValue({ status: 'CURRENT_ACCESS_NOT_REUSABLE' })
  await click('Read protected content')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('当前资格无法复用')
  expect(host.querySelector('section[aria-label^="Opened content"]')).toBeNull()
  expect(m.open).not.toHaveBeenCalled()
  expect(m.sign).not.toHaveBeenCalled()
})
