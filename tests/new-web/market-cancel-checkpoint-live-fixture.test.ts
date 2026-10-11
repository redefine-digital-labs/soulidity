import { describe, expect, it } from 'vitest'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { MarketCancelCheckpointSummaryBcs, validateMarketCancelCheckpoint } from '../../web/lib/animacraft/market-cancel-checkpoint'

// Public, read-only getCheckpoint response captured from
// https://fullnode.mainnet.sui.io:443 during this implementation, NOT produced
// by our codec. This tests wire compatibility independently of synthetic BCS.
// getServiceInfo.chainId was the full genesis digest, not JSON-RPC's 35834a8a.
const captured = {
  bytes: '2gQAAAAAAACLMgoTAAAAAC7lBV0BAAAAIJ0oLN5w+EcNKV4iTG1CdtjenKKQAnxd+29XkH8frU2MASDagRnIBxOq+5q0toWaHnVJpM6Ml4JterhO4UD3mUBRxHf7HCkgAQAAQD2iXxBSAABgYfWiTlEAACDntD/SAAAAm47UdqABAAABASBI9Vpz3edoelAhTQRyWUrmYYNV5eavI+HhJMMT+vhyRwACAAA=',
  digest: '2wjxLDeNHFq4inbm6Vw22NQh6TyJq9xzRhrbUzrXEvoy',
  epoch: '1242', sequenceNumber: '319435403',
}

describe('captured mainnet checkpoint wire compatibility', () => {
  it('decodes and hashes actual ledger BCS without constructing it from the tested schema', () => {
    expect(validateMarketCancelCheckpoint(captured, '1241')).toEqual(captured)
    const summary = MarketCancelCheckpointSummaryBcs.parse(fromBase64(captured.bytes))
    expect(summary.epoch).toBe('1242'); expect(summary.sequence_number).toBe('319435403')
    expect(summary.checkpoint_commitments).toHaveLength(1)
    expect(summary.checkpoint_commitments[0].$kind).toBe('CheckpointArtifactsDigest')
    expect(toBase64(MarketCancelCheckpointSummaryBcs.serialize(summary).toBytes())).toBe(captured.bytes)
  })
  it('does not treat a checkpoint in the expiration epoch as safe retirement', () => {
    expect(() => validateMarketCancelCheckpoint(captured, '1242')).toThrow('strictly later')
  })
  it('rejects a changed RPC epoch instead of trusting it over canonical bytes', () => {
    expect(() => validateMarketCancelCheckpoint({ ...captured, epoch: '1243' }, '1242')).toThrow('mismatch')
  })
})
