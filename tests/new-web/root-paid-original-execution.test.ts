// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toBase64 } from '@mysten/sui/utils'
import type { Transaction } from '@mysten/sui/transactions'
import { completePreflightFixture } from './fixtures/commerce-new-paid-preflight'
import { activityEvidenceFixture, ActivityFixtureEventsBcs, aid } from './fixtures/activity-transaction-evidence'
import { createNativePublicReadPaidHostPreflightV2 } from '../../web/lib/soulidity/native-public-read-paid-host-v2'
import { browserNativePublicReadPaidJournalV2, nativePublicReadPaidKeyV2 } from '../../web/lib/soulidity/native-public-read-paid-journal-v2'
import { executeNativePublicReadPaidOriginalV2 } from '../../web/lib/soulidity/native-public-read-paid-execution-v2'

beforeEach(() => {
  vi.stubGlobal('Uint8Array', structuredClone(new Uint8Array()).constructor)
  window.localStorage.clear()
  const held = new Set<string>()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (key: string, _options: unknown, work: (lock: unknown) => unknown) => {
      if (held.has(key)) return work(null)
      held.add(key)
      try { return await work({name:key}) } finally { held.delete(key) }
    },
  } })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function fixture() {
  const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(83))
  const x = await completePreflightFixture('', signer.toSuiAddress())
  const queries = vi.fn(async (_request: { digest:string }) => { throw { code:'NOT_FOUND' } })
  const submit = vi.fn(async (_request: { transaction:Uint8Array; signatures:string[] }) => {})
  x.client.ledgerService.getTransaction = queries
  x.client.ledgerService.getCheckpoint = vi.fn(async () => { throw Error('UNEXPECTED_CHECKPOINT') })
  x.client.core.executeTransaction = submit
  const result = await createNativePublicReadPaidHostPreflightV2()(x.input)
  const key = nativePublicReadPaidKeyV2({ chainIdentifier:'35834a8a', soulId:x.params.soulId, author:x.buyer })
  const read = () => browserNativePublicReadPaidJournalV2().read(key)
  const selected = (await read())!
  let buyer: string | null = x.buyer, current = true
  const sign = vi.fn(async (tx:Transaction) => {
    expect((await read())?.packet.phase).toBe('SIGNING')
    return signer.signTransaction(await tx.build())
  })
  const qualifySource = vi.fn(async () => {})
  const input = { selected, qualification:x.input.qualification, isCurrent:()=>current, getBuyerAddress:()=>buyer, sign, qualifySource }
  const run = (options:Partial<typeof input> = {}) => executeNativePublicReadPaidOriginalV2({...input,...options})
  return {...x, result, selected, read, key, run, sign, submit, queries, qualifySource,
    switchWallet:()=>{buyer=aid(999)}, revoke:()=>{current=false}}
}

it('submits only the retained, checked, durably signed three-command original', async () => {
  const f = await fixture()
  f.submit.mockImplementationOnce(async request => {
    const saved = (await f.read())!
    expect(saved.packet.phase).toBe('SIGNED')
    expect(saved.plan.originalText).toBe(f.result.retainedText)
    expect(toBase64(request.transaction)).toBe(saved.packet.bytes)
    expect(request.signatures).toEqual([saved.packet.signature])
  })
  const result = await f.run()
  expect(result).toMatchObject({ record:{packet:{phase:'SIGNED'}}, original:{status:'MISSING'} })
  expect(f.qualifySource).toHaveBeenCalledTimes(2)
  expect(f.sign).toHaveBeenCalledOnce()
  expect(f.submit).toHaveBeenCalledOnce()
  expect(f.queries.mock.calls.every(([request])=>request.digest===f.selected.packet.digest)).toBe(true)
  expect(f.queries.mock.invocationCallOrder[0]).toBeLessThan(f.sign.mock.invocationCallOrder[0])
  expect(f.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledTimes(3)
})

it.each(['wallet','source'] as const)('preserves the verified original if the %s changes during the prompt', async mode => {
  const f = await fixture(), sign = f.sign.getMockImplementation()!
  f.sign.mockImplementationOnce(async tx => {
    const signed=await sign(tx)
    if(mode==='wallet') f.switchWallet()
    else f.revoke()
    return signed
  })
  await expect(f.run()).rejects.toThrow('WALLET_OR_SOURCE_CHANGED')
  expect((await f.read())?.packet.phase).toBe('SIGNED')
  expect(f.submit).not.toHaveBeenCalled()
})

it('stops before signing if Root source qualification is denied', async () => {
  const f = await fixture()
  f.qualifySource.mockRejectedValueOnce(Error('CONTROLLED_SOURCE_REJECTED'))
  await expect(f.run()).rejects.toThrow('CONTROLLED_SOURCE_REJECTED')
  expect((await f.read())?.packet.phase).toBe('PREPARED')
  expect(f.sign).not.toHaveBeenCalled()
  expect(f.submit).not.toHaveBeenCalled()
})

it('checks the original and reuses the retained signature after uncertain transport', async () => {
  const f = await fixture()
  f.submit.mockRejectedValueOnce(Error('CONTROLLED_TRANSPORT_TIMEOUT'))
  await expect(f.run()).rejects.toThrow('CONTROLLED_TRANSPORT_TIMEOUT')
  const selected = (await f.read())!
  expect(selected.packet.phase).toBe('SIGNED')
  await f.run({selected})
  expect(f.sign).toHaveBeenCalledOnce()
  expect(f.submit.mock.calls[1][0]).toMatchObject({signatures:[selected.packet.signature]})
  expect(toBase64(f.submit.mock.calls[1][0].transaction)).toBe(selected.packet.bytes)
})

it('rejects a different version before presenting the wallet prompt', async () => {
  const f = await fixture()
  await expect(f.run({qualification:{...f.input.qualification,recordIndex:f.input.qualification.recordIndex+1}})).rejects.toThrow('EXECUTION_SELECTION')
  expect(f.sign).not.toHaveBeenCalled();expect(f.submit).not.toHaveBeenCalled()
})

it('reconciles a finalized guarded original from its checkpoint and payout before returning a subscription result', async () => {
  const f = await fixture(), cert = await activityEvidenceFixture()
  const simulate = f.client.transactionExecutionService.simulateTransaction
  const {response:{transaction:raw}} = await simulate.mock.results[0].value
  Object.assign(cert.transactionData.V1,bcs.TransactionData.parse(raw.transaction.bcs.value).V1)
  cert.effectsData.V2 = bcs.TransactionEffects.parse(raw.effects.bcs.value).V2
  cert.eventsData.data = ActivityFixtureEventsBcs.parse(raw.events.bcs.value).data
  cert.rehashTransaction()
  f.client.ledgerService.getCheckpoint.mockResolvedValue({response:{checkpoint:cert.checkpoint}})
  const live = f.client.ledgerService.getObject.getMockImplementation()!
  f.client.ledgerService.getObject.mockImplementation(async (request,options) => {
    if(request.version===undefined)return live(request,options)
    const object=raw.objects.objects.find(row=>row.objectId===request.objectId&&row.version===request.version)
    return {response:{object}}
  })
  f.submit.mockImplementationOnce(async () => {
    f.queries.mockResolvedValue({response:{transaction:cert.ledger}} as never)
  })
  const result=await f.run()
  expect(result.original).toMatchObject({status:'SUBSCRIPTION_RECORDED',checkpoint:'100',receipt:{
    transactionDigest:f.selected.packet.digest,money:{buyerGrossDebit:'104',protocolIncome:'3',payout:{amount:'101'}},
  }})
  const saved=(await f.read())!
  expect(saved.packet.phase).toBe('SIGNED')
  expect((await f.run({selected:saved})).original.status).toBe('SUBSCRIPTION_RECORDED')
  expect(f.sign).toHaveBeenCalledOnce();expect(f.submit).toHaveBeenCalledOnce()
})
