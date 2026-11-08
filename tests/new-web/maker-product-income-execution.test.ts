// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { createRootMakerProductIncomeController } from '../../web/lib/soulidity/commerce/maker-product-income-controller'
import { browserMakerProductIncomeOriginalReader, makerProductIncomeFundKey, makerProductIncomeOperationFromOriginal } from '../../web/lib/soulidity/maker-product-income-journal'
import { makerProductIncomeControllerFixture } from './fixtures/maker-product-income'
import { aid } from './fixtures/activity-transaction-evidence'

beforeEach(() => {
  vi.stubGlobal('Uint8Array', structuredClone(new Uint8Array()).constructor)
  localStorage.clear()
  const held = new Set<string>()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (name: string, _options: unknown, work: (lock: object | null) => unknown) => {
      if (held.has(name)) return work(null)
      held.add(name)
      try { return await work({name}) } finally { held.delete(name) }
    },
  } })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function setup(enabled = true, addressGas = false) {
  const keypair = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(83))
  const x = await makerProductIncomeControllerFixture(1, keypair.toSuiAddress(), addressGas)
  const selected = await makerProductIncomeOperationFromOriginal(x.originalText), key = makerProductIncomeFundKey(x.target)
  localStorage.setItem(key, JSON.stringify(selected))
  const reader = browserMakerProductIncomeOriginalReader(), read = () => reader.read(key)
  let actor: string | null = x.actor, current = true
  const signal = new AbortController().signal
  const queries = vi.mocked(x.client.ledgerService.getTransaction)
  const confirm = () => queries.mockImplementation(async () => ({ response: { transaction: structuredClone(x.f.ledger) } }))
  const execute = vi.fn(async (_value: {transaction:Uint8Array;signatures:string[]}) => {})
  Object.assign(x.client.core, { executeTransaction: execute })
  const wallet = { getActorAddress: () => actor, sign: vi.fn(async (tx: Transaction) => {
    expect((await read())?.packet.phase).toBe('SIGNING')
    return keypair.signTransaction(await tx.build())
  }) }
  const controller = createRootMakerProductIncomeController({ installations: [x.installation],
    executionModels: x.executionModels, executionEnabled: enabled ? true : undefined, client: () => x.client })
  const run = (record = selected, abort = signal) => controller.executeOriginal({ selected: record, signal: abort, wallet, isCurrent: () => current })
  return { ...x, wallet, selected, key, controller, read, run, execute, confirm, queries, keypair,
    setActor: (value: string | null) => { actor = value }, revoke: () => { current = false } }
}

it('queries before the exact wallet prompt, persists the signed original, and confirms payment only from original checkpoint evidence', async () => {
  const x = await setup()
  x.execute.mockImplementationOnce(async request => {
    const saved = await x.read()
    expect(saved?.packet.phase).toBe('SIGNED')
    expect(request.signatures).toEqual([saved?.packet.signature])
    expect(toBase64(request.transaction)).toBe(x.packet.bytes)
    expect(saved?.plan.originalText).toBe(x.originalText)
    x.confirm()
  })
  const result = await x.run()
  expect(result.original.status).toBe('WITHDRAWAL_EVIDENCE_CONFIRMED')
  expect(result.record.packet.phase).toBe('SUCCEEDED')
  expect((await x.read())?.packet.phase).toBe('SUCCEEDED')
  expect(x.wallet.sign).toHaveBeenCalledOnce(); expect(x.execute).toHaveBeenCalledOnce()
  expect(x.queries.mock.invocationCallOrder[0]).toBeLessThan(x.wallet.sign.mock.invocationCallOrder[0])
  expect(x.queries.mock.calls.every(([request]) => (request as any).digest === x.packet.digest)).toBe(true)
  expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledTimes(2)
  await x.run((await x.read())!)
  expect(x.wallet.sign).toHaveBeenCalledOnce(); expect(x.execute).toHaveBeenCalledOnce()
})

it('retains SIGNED after uncertain submit and retries only the same bytes and signature after querying the original', async () => {
  const x = await setup()
  x.execute.mockRejectedValueOnce(new Error('controlled submit timeout'))
  await expect(x.run()).rejects.toMatchObject({message:'controlled submit timeout',recovery:{digest:x.packet.digest,headPhase:'SIGNED',durability:'CONFIRMED'}})
  const signed = (await x.read())!
  x.execute.mockImplementationOnce(async request => {
    expect(toBase64(request.transaction)).toBe(signed.packet.bytes)
    expect(request.signatures).toEqual([signed.packet.signature])
    x.confirm()
  })
  const result = await x.run(signed)
  expect(result.original.status).toBe('WITHDRAWAL_EVIDENCE_CONFIRMED')
  expect(x.wallet.sign).toHaveBeenCalledOnce(); expect(x.execute).toHaveBeenCalledTimes(2)
  expect((await x.read())?.packet.digest).toBe(x.packet.digest)
})

it.each(['pending', 'already-confirmed', 'unqualified'] as const)('queries %s without signing or dispatch', async mode => {
  const x = await setup()
  let run = x.run
  if (mode === 'pending') {
    const row = structuredClone(x.f.ledger); delete row.checkpoint
    x.queries.mockResolvedValue({ response:{transaction:row} })
  } else x.confirm()
  if (mode === 'unqualified') {
    const c = createRootMakerProductIncomeController({installations:[x.installation],executionEnabled:true,client:()=>x.client})
    run = () => c.executeOriginal({selected:x.selected,signal:new AbortController().signal,wallet:x.wallet,isCurrent:()=>true})
  }
  const result = await run()
  expect(result.original.status).toBe(mode==='pending'?'PENDING':mode==='already-confirmed'?'WITHDRAWAL_EVIDENCE_CONFIRMED':'FINALIZED_EXECUTION')
  expect(x.wallet.sign).not.toHaveBeenCalled(); expect(x.execute).not.toHaveBeenCalled()
})

it.each(['disabled','actor','changed-head','gas','control'] as const)('refuses %s before requesting a signature', async mode => {
  const x = await setup(mode!=='disabled')
  if(mode==='actor')x.setActor(aid(999))
  if(mode==='changed-head')localStorage.removeItem(x.key)
  if(mode==='control')x.setControl(aid(999))
  if(mode==='gas') {
    const row = x.foundationRows.get(`${x.gasId}:2`)!
    const bytes = row.bcs.value
    row.bcs.value = bytes.slice(0, bytes.length - 1)
  }
  await expect(x.run()).rejects.toThrow()
  expect(x.wallet.sign).not.toHaveBeenCalled(); expect(x.execute).not.toHaveBeenCalled()
  expect((await x.read())?.packet.phase).toBe(mode==='changed-head'?undefined:'PREPARED')
})

it.each(['different-bytes','wrong-signer','wallet-change','source-change','signature-save-ack'] as const)('preserves the same original after %s', async mode => {
  const x = await setup()
  if(mode==='different-bytes')x.wallet.sign.mockImplementationOnce(async () => ({ bytes:'AQ==', signature:'AQ==' }))
  if(mode==='wrong-signer')x.wallet.sign.mockImplementationOnce(async () => Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(84)).signTransaction(fromBase64(x.packet.bytes)))
  if(mode==='wallet-change' || mode==='source-change')x.wallet.sign.mockImplementationOnce(async () => {
    const signed=await x.keypair.signTransaction(fromBase64(x.packet.bytes))
    if(mode==='wallet-change')x.setActor(aid(999));else x.revoke()
    return signed
  })
  if(mode==='signature-save-ack'){
    const original=Storage.prototype.setItem
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){
      original.call(this,key,value)
      if(key===x.key&&JSON.parse(value).packet.phase==='SIGNED')throw Error('controlled SIGNED acknowledgement failure')
    })
  }
  await expect(x.run()).rejects.toThrow()
  const saved=(await x.read())!
  expect(saved.packet.phase).toBe(['signature-save-ack','wallet-change','source-change'].includes(mode)?'SIGNED':'SIGNING')
  expect(saved.plan.originalText).toBe(x.originalText)
  expect(x.execute).not.toHaveBeenCalled()
})

it('holds the fund lock through a closed wallet view and retains the returned signature', async () => {
  const x=await setup(), abort=new AbortController()
  let entered!:()=>void,release!:()=>void
  const ready=new Promise<void>(resolve=>entered=resolve),wait=new Promise<void>(resolve=>release=resolve)
  x.wallet.sign.mockImplementationOnce(async () => { entered(); await wait; return x.keypair.signTransaction(fromBase64(x.packet.bytes)) })
  const first=x.run(x.selected,abort.signal),rejected=expect(first).rejects.toThrow()
  await ready
  abort.abort(new Error('controlled wallet view closed'))
  await expect(x.run((await x.read())!)).rejects.toThrow('BUSY')
  release()
  await rejected
  expect((await x.read())?.packet.phase).toBe('SIGNED')
  expect(x.execute).not.toHaveBeenCalled()
})

it('queries again after signing and suppresses submit when the original appears while the wallet was open', async () => {
  const x=await setup()
  const row=structuredClone(x.f.ledger)
  delete row.checkpoint
  x.queries.mockImplementationOnce(async()=>{throw Object.assign(new Error('controlled missing original'),{code:'NOT_FOUND'})})
  x.queries.mockResolvedValueOnce({response:{transaction:row}})
  const result=await x.run()
  expect(result.original.status).toBe('PENDING')
  expect((await x.read())?.packet.phase).toBe('SIGNED')
  expect(x.wallet.sign).toHaveBeenCalledOnce()
  expect(x.execute).not.toHaveBeenCalled()
})

it('executes a retained withdrawal with only address Gas and reconciles both Gas and recipient Coin from original effects', async () => {
  const x = await setup(true, true)
  x.execute.mockImplementationOnce(async request => {
    expect(toBase64(request.transaction)).toBe(x.packet.bytes)
    expect((await x.read())?.packet.phase).toBe('SIGNED')
    x.confirm()
  })
  const result = await x.run()
  expect(result.original).toMatchObject({status:'WITHDRAWAL_EVIDENCE_CONFIRMED', receipt:{
    paymentCoinId:x.payoutId, receipt:{amount:'50',recipient:x.intent.recipient},
    gas:{netGasCharge:'3',owner:x.actor,accumulatorIds:[expect.any(String)]},
  }})
  expect((await x.read())?.packet.phase).toBe('SUCCEEDED')
})

it('preserves the signed address-Gas original when the live balance falls below the budget', async () => {
  const x = await setup(true, true)
  x.wallet.sign.mockImplementationOnce(async tx => {
    const signed = await x.keypair.signTransaction(await tx.build())
    const getBalance = vi.mocked(x.client.stateService.getBalance)
    const balance = (await getBalance({owner:x.actor})).response.balance!
    getBalance.mockResolvedValue({response:{balance:{...balance,balance:0n,addressBalance:0n}}} as Awaited<ReturnType<typeof getBalance>>)
    return signed
  })
  await expect(x.run()).rejects.toMatchObject({
    message:'COMMERCE_MAKER_INCOME_ADDRESS_GAS_BALANCE', recovery:{digest:x.packet.digest,headPhase:'SIGNED',durability:'CONFIRMED'},
  })
  expect(x.execute).not.toHaveBeenCalled()
})

it.each(['wrong-gas-owner','pre-window-failure'])('rejects checkpoint evidence with %s for the same original', async mode => {
  const x = await setup(true, true)
  const e = x.f.effectsData.V2!
  if(mode==='wrong-gas-owner'){
    const write = e.changedObjects[4][1].outputState.AccumulatorWriteV1!
    write.address.address = aid(999)
  }else{
    e.executedEpoch = '4'
    e.status = { $kind:'Failure', Failure:{ error:{ $kind:'InsufficientGas', InsufficientGas:true }, command:null } }
    x.f.summaryData.epoch = '4'
  }
  x.f.rehashEffects()
  x.confirm()
  await expect(x.run()).rejects.toThrow(mode==='wrong-gas-owner'?'ADDRESS_BALANCE_EFFECTS_WRITE_MISMATCH':'RAW_EFFECTS_MISMATCH')
  expect(x.execute).not.toHaveBeenCalled()
  expect((await x.read())?.packet.phase).toBe('PREPARED')
})
