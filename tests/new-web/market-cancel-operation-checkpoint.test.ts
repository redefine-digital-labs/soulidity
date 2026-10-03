import { expect, it } from 'vitest'
import { toBase64 } from '@mysten/sui/utils'
import { MarketCancelCheckpointSummaryBcs, marketCancelCheckpointDigest, validateMarketCancelCheckpoint } from '../../web/lib/animacraft/market-cancel-checkpoint'
import { marketCancelCheckpointFixture } from './fixtures/market-cancel-operation'

it.each([false,true])('parses exact CheckpointSummary including end-of-epoch=%s and preserves evidence independently', end => {
  const f=marketCancelCheckpointFixture('11','100',end)
  const result=validateMarketCancelCheckpoint(f.evidence,'10')
  expect(result).toEqual(f.evidence)
  const parsed=MarketCancelCheckpointSummaryBcs.parse(f.bytes)
  expect(parsed.epoch).toBe('11');expect(parsed.sequence_number).toBe('100')
  // Three u64s precede the content digest vector's explicit 32-byte prefix.
  expect(f.bytes[24]).toBe(32)
  if(end)expect(parsed.end_of_epoch_data?.next_epoch_committee[0][0]).toHaveLength(96)
  f.evidence.epoch='999';expect(result.epoch).toBe('11')
})
it.each(['equal','earlier','hash','epoch','sequence','base64','trailing','short-digest','oversize','invalid-expiration'])
  ('rejects checkpoint %s evidence', problem => {
    const f=marketCancelCheckpointFixture(problem==='equal'?'10':problem==='earlier'?'9':'11')
    const value={...f.evidence};let expiration='10'
    if(problem==='hash')value.digest='bad'
    if(problem==='epoch')value.epoch='12'
    if(problem==='sequence')value.sequenceNumber='101'
    if(problem==='base64')value.bytes+='\n'
    if(problem==='trailing') {const bytes=new Uint8Array([...f.bytes,0]);value.bytes=toBase64(bytes);value.digest=marketCancelCheckpointDigest(bytes)}
    if(problem==='short-digest') {const bytes=f.bytes.slice();bytes[24]=31;value.bytes=toBase64(bytes);value.digest=marketCancelCheckpointDigest(bytes)}
    if(problem==='oversize')value.bytes='A'.repeat(90001)
    if(problem==='invalid-expiration')expiration='01'
    expect(()=>validateMarketCancelCheckpoint(value,expiration)).toThrow()
  })
it('rejects malformed committee key width and retains both commitment variants', () => {
  const f=marketCancelCheckpointFixture('11','100',true)
  expect(()=>MarketCancelCheckpointSummaryBcs.serialize({...f.summary,end_of_epoch_data:{...f.summary.end_of_epoch_data!,
    next_epoch_committee:[[Array(95).fill(3),'100']]}})).toThrow('fixed byte length')
  const parsed=MarketCancelCheckpointSummaryBcs.parse(f.bytes)
  expect(parsed.checkpoint_commitments[0].$kind).toBe('CheckpointArtifactsDigest')
  expect(parsed.end_of_epoch_data?.epoch_commitments[0].$kind).toBe('ECMHLiveObjectSetDigest')
})
