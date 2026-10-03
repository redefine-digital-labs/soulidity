// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useCommunityPostDetail } from '../../web/lib/hooks/use-community-post-detail'
const f = vi.hoisted(() => ({ owner: 'wallet', config: {} as any, configError: false, options: {} as any, read: vi.fn(async () => ({ post: 'verified' })) }))
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: any) => { f.options = options; return {} } }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => ({ walletAddress: f.owner }) }))
vi.mock('../../web/lib/hooks/use-wallet-sign', () => ({ useWalletSign: () => ({ suiGrpcClient: 'client' }) }))
vi.mock('../../web/lib/community/public-post-vote-read', () => ({ getBrowserCommunityVoteConfig: () => { if (f.configError) throw new Error('config unavailable'); return f.config } }))
vi.mock('../../web/lib/community/post-detail-read', () => ({ readBrowserCommunityPostDetail: f.read }))
let root: Root, host: HTMLDivElement
const postId = `0x${'1'.repeat(64)}`
function Harness({ id }: { id: string | null }) { useCommunityPostDetail(id); return null }
beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  f.owner = 'wallet'; f.configError = false; f.config = { deployment: { registryId: 'release-a' }, storage: { aggregatorUrl: 'storage-a' }, voteRegistryId: 'votes-a' }; f.read.mockClear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function render(id: string | null = postId) { await act(async () => root.render(<Harness id={id} />)) }
it('keys release/storage/Post/viewer and sends the query cancellation signal', async () => {
  await render(); const signal = new AbortController().signal
  await expect(f.options.queryFn({ signal })).resolves.toEqual({ post: 'verified' })
  expect(f.options.queryKey).toEqual(['community-chain-post', f.config, postId, 'wallet'])
  expect(f.read).toHaveBeenCalledWith({ client: 'client', config: f.config, postId, viewerAddress: 'wallet', signal })
})
it('rejects a SQL UUID instead of sending it to a chain reader', async () => {
  await render('db-post-uuid'); await expect(f.options.queryFn({ signal: new AbortController().signal })).rejects.toThrow('CHAIN_POST_ID_REQUIRED')
  expect(f.read).not.toHaveBeenCalled()
})
it('changes query identity when wallet or release changes', async () => {
  await render(); const first = f.options.queryKey
  f.owner = 'other'; await render(); expect(f.options.queryKey).not.toEqual(first)
  f.owner = 'wallet'; f.config.voteRegistryId = 'votes-b'; await render(); expect(f.options.queryKey).not.toEqual(first)
})
it('reports missing config as error and disables absent target', async () => {
  f.configError = true; await render(); await expect(f.options.queryFn({})).rejects.toThrow('config unavailable')
  expect(f.read).not.toHaveBeenCalled(); await render(null); expect(f.options.enabled).toBe(false)
})
