import { afterEach, expect, it, vi } from 'vitest'
import { createBrowserCommunityPublishController } from '../../web/lib/community/publish-browser-controller'
const m = vi.hoisted(() => ({ controller: vi.fn((params: any) => params), upload: vi.fn(), recover: vi.fn(), ack: vi.fn() }))
vi.mock('../../web/lib/community/publish-controller', () => ({ createCommunityPublishController: m.controller }))
vi.mock('../../web/lib/community/publish-journal', () => ({ browserCommunityPublishJournalStore: () => ({ journal: true }) }))
vi.mock('../../web/lib/community/publish-operation-client', () => ({ browserPublicCommunityPublishOperationStore: () => ({ operations: true }) }))
vi.mock('../../web/lib/upload/client-upload', () => ({ uploadSoulPayload: m.upload, recoverWalrusSingleBlobUpload: m.recover, acknowledgeWalrusSingleBlobUpload: m.ack }))
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })
function fixture() {
  vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'mainnet')
  const params = { client: {}, config: { deployment: { profile: { chainIdentifier: '35834a8a' } } },
    writesEnabled: () => true, getAddress: () => 'owner', sign: vi.fn(), confirmQuote: vi.fn() }
  return { params, result: createBrowserCommunityPublishController(params as any) as any }
}
it('reuses public upload, stable child scope and the actual quote approval callback', async () => {
  const f = fixture(), file = new File(['{}'], 'public-post.json')
  m.upload.mockResolvedValue({ recoveryKey: 'key', certifyTxDigest: 'digest' })
  await f.result.uploads.upload(file, 'scope', 'owner')
  expect(m.upload).toHaveBeenCalledWith(expect.objectContaining({ file, operationScope: 'scope', walletAddress: 'owner',
    uploadType: 'public', attachment: null, confirmQuote: f.params.confirmQuote }))
  await f.result.uploads.recover('scope', 'owner')
  expect(m.recover).toHaveBeenCalledWith(expect.objectContaining({ operationScope: 'scope', walletAddress: 'owner', attachment: null }))
  await f.result.uploads.acknowledge({ recoveryKey: 'key', certifyTxDigest: 'digest' })
  expect(m.ack).toHaveBeenCalledWith({ recoveryKey: 'key', certifyDigest: 'digest' })
})
it('requires paid uploader recovery identity', async () => {
  const f = fixture(); m.upload.mockResolvedValue({})
  await expect(f.result.uploads.upload(new File(['{}'], 'post.json'), 'scope', 'owner')).rejects.toThrow('RECOVERY_KEY_REQUIRED')
})
it('rejects a paid uploader network differing from the frozen release', async () => {
  const f = fixture(); vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'testnet')
  await expect(f.result.uploads.upload(new File(['{}'], 'post.json'), 'scope', 'owner')).rejects.toThrow('UPLOAD_NETWORK_MISMATCH')
  expect(() => f.result.uploads.recover('scope', 'owner')).toThrow('UPLOAD_NETWORK_MISMATCH')
  expect(m.upload).not.toHaveBeenCalled(); expect(m.recover).not.toHaveBeenCalled()
})
