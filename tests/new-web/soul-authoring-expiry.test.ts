import { expect, it, vi } from 'vitest'
import { readSoulAuthoringExpiry } from '../../web/lib/soulidity/soul-authoring-expiry'
import { marketCancelCheckpointFixture } from './fixtures/market-cancel-operation'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'

function fixture(epoch = '11') {
  const f = marketCancelCheckpointFixture(epoch, '100')
  const row = { sequenceNumber: 100n, digest: f.evidence.digest,
    summary: { bcs: { value: f.bytes }, digest: f.evidence.digest, epoch: BigInt(epoch), sequenceNumber: 100n },
    signature: { epoch: BigInt(epoch), signature: new Uint8Array(48), bitmap: new Uint8Array([1]) } }
  const client = { ledgerService: {
    getServiceInfo: vi.fn(async () => ({ response: { chainId: MAINNET_GENESIS_DIGEST } })),
    getCheckpoint: vi.fn(async (_input: unknown) => ({ response: { checkpoint: row } })),
  } }
  return { ...f, row, client, run: (saved?: typeof f.evidence) => readSoulAuthoringExpiry(client as any, '10', new AbortController().signal, saved) }
}
it('reads executed strictly later epoch, then revalidates saved exact checkpoint on cold recovery', async () => {
  const f = fixture()
  expect(await f.run()).toEqual(f.evidence)
  expect(await f.run(f.evidence)).toEqual(f.evidence)
  expect(f.client.ledgerService.getCheckpoint.mock.calls.at(-1)?.[0]).toMatchObject({ checkpointId: { oneofKind: 'sequenceNumber', sequenceNumber: 100n } })
})
it.each(['9', '10'])('cannot retire using executed epoch %s', async epoch => {
  await expect(fixture(epoch).run()).rejects.toThrow('strictly later')
})
it.each(['chain', 'summary', 'signature', 'saved'])('rejects %s drift rather than granting replacement', async problem => {
  const f = fixture()
  if (problem === 'chain') f.client.ledgerService.getServiceInfo.mockResolvedValue({ response: { chainId: 'wrong' } })
  if (problem === 'summary') f.row.summary.sequenceNumber = 101n
  if (problem === 'signature') f.row.signature.epoch = 9n
  const saved = problem === 'saved' ? marketCancelCheckpointFixture('11', '101').evidence : undefined
  await expect(f.run(saved)).rejects.toThrow()
})
