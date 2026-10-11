import { expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { ProfileWalrusBlobBcs } from '../../packages/soulidity-sdk/src/public-profile-metadata'
import { createPublicPostDocument, encodePublicCommunityDocument } from '../../packages/soulidity-sdk/src/community-document'
import { readPublicCommunityDocument } from '../../packages/soulidity-sdk/src/community-document-read'
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
async function fixture() {
  const bytes = new Uint8Array(encodePublicCommunityDocument(createPublicPostDocument({title:'Test',content:'Public post',tags:'one,one,Two'})))
  const blob = { id:id(1), registered_epoch:3, blob_id:'42', size:String(bytes.length), encoding_type:1,
    certified_epoch:4 as number|null, storage:{id:id(2),start_epoch:2,end_epoch:10,storage_size:'1000'},deletable:true }
  const ref = {blobObjectId:blob.id,blobId:toBase64(bcs.u256().serialize(blob.blob_id).toBytes()).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''),
    sha256:toHex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))),byteLength:String(bytes.length)}
  const storage = {blobType:`${id(3)}::blob::Blob`,aggregatorUrl:'https://aggregator.example',chainIdentifier:'01010101'}
  const raw = {objectId:blob.id,objectType:storage.blobType,version:1n,digest:toBase58(new Uint8Array(32).fill(2)),
    contents:{value:ProfileWalrusBlobBcs.serialize(blob).toBytes()}}
  const get = vi.fn(async()=>({response:{object:structuredClone(raw)}}))
  const chain = vi.fn(async()=>({chainIdentifier:toBase58(new Uint8Array(32).fill(1))}))
  const fresh = vi.fn(async()=>({blobType:storage.blobType,epoch:5}))
  const fetcher = vi.fn(async(_input: RequestInfo | URL, _init?: RequestInit)=>new Response(bytes,{headers:{'content-length':String(bytes.length)}}))
  const params = {client:{core:{getChainIdentifier:chain},ledgerService:{getObject:get}} as any,
    reference:ref,storage,freshWalrusState:fresh,kind:'post' as const,fetcher:fetcher as typeof fetch}
  return {params,bytes,blob,ref,storage,raw,get,chain,fresh,fetcher,
    put:()=>{raw.contents.value=ProfileWalrusBlobBcs.serialize(blob).toBytes()},read:()=>readPublicCommunityDocument(params)}
}
it('verifies exact certified bytes and current Walrus epoch before and after credential-free download',async()=>{
  const f=await fixture(),r=await f.read()
  expect(r.document).toEqual(createPublicPostDocument({title:'Test',content:'Public post',tags:['one','Two']}))
  expect(r.storageEndEpoch).toBe(10);expect(f.get).toHaveBeenCalledTimes(2);expect(f.fresh).toHaveBeenCalledTimes(2)
  expect(f.fetcher.mock.calls[0]).toEqual([`https://aggregator.example/v1/blobs/${f.ref.blobId}`,
    expect.objectContaining({credentials:'omit',redirect:'error',cache:'no-store',signal:expect.any(AbortSignal)})])
})
it.each(['uncertified','future-certificate','expired','zero-storage','storage-alias','wrong-blob','wrong-size','encoding'])(
  'rejects %s before download',async problem=>{
    const f=await fixture()
    if(problem==='uncertified')f.blob.certified_epoch=null
    if(problem==='future-certificate')f.blob.certified_epoch=6
    if(problem==='expired')f.blob.storage.end_epoch=5
    if(problem==='zero-storage')f.blob.storage.storage_size='0'
    if(problem==='storage-alias')f.blob.storage.id=f.blob.id
    if(problem==='wrong-blob')f.blob.blob_id='43'
    if(problem==='wrong-size')f.blob.size='1'
    if(problem==='encoding')f.blob.encoding_type=0
    f.put();await expect(f.read()).rejects.toThrow('COMMUNITY_STORAGE_');expect(f.fetcher).not.toHaveBeenCalled()
  })
it.each(['id','type','version','digest','trailing-bcs'])('rejects malformed raw Blob %s',async field=>{
  const f=await fixture()
  if(field==='id')f.raw.objectId=id(99)
  if(field==='type')f.raw.objectType=`${id(99)}::blob::Blob`
  if(field==='version')f.raw.version=0n
  if(field==='digest')f.raw.digest='invalid'
  if(field==='trailing-bcs')f.raw.contents.value=new Uint8Array([...f.raw.contents.value,0])
  await expect(f.read()).rejects.toThrow();expect(f.fetcher).not.toHaveBeenCalled()
})
it.each(['credentials','query','http','wrong-chain','large-ref','bad-ref'])('rejects invalid configuration/reference %s',async field=>{
  const f=await fixture()
  if(field==='credentials')f.storage.aggregatorUrl='https://key:secret@example.com'
  if(field==='query')f.storage.aggregatorUrl+='?token=secret'
  if(field==='http')f.storage.aggregatorUrl='http://example.com'
  if(field==='wrong-chain')f.storage.chainIdentifier='02020202'
  if(field==='large-ref')f.ref.byteLength='1048577'
  if(field==='bad-ref')f.ref.blobId=f.ref.blobId.slice(0,-1)+'B'
  await expect(f.read()).rejects.toThrow();expect(f.fetcher).not.toHaveBeenCalled()
})
it.each(['hash','short-body','long-body','declared-length','unavailable','wrong-kind'])('rejects download %s without empty success',async field=>{
  const f=await fixture()
  if(field==='hash')f.ref.sha256='00'.repeat(32)
  if(field==='short-body')f.fetcher.mockImplementation(async()=>new Response(f.bytes.slice(1)))
  if(field==='long-body')f.fetcher.mockImplementation(async()=>new Response(new Uint8Array([...f.bytes,0])))
  if(field==='declared-length')f.fetcher.mockImplementation(async()=>new Response(f.bytes,{headers:{'content-length':'1'}}))
  if(field==='unavailable')f.fetcher.mockImplementation(async()=>new Response(null,{status:503}))
  if(field==='wrong-kind')Object.assign(f.params,{kind:'comment'})
  await expect(f.read()).rejects.toThrow('COMMUNITY_STORAGE_')
})
it.each(['expiry','epoch-regression','network','blob-changed'])('rejects %s during read',async field=>{
  const f=await fixture()
  f.fetcher.mockImplementation(async()=>{
    if(field==='expiry')f.fresh.mockResolvedValue({blobType:f.storage.blobType,epoch:10})
    if(field==='epoch-regression')f.fresh.mockResolvedValue({blobType:f.storage.blobType,epoch:4})
    if(field==='network')f.fresh.mockResolvedValue({blobType:`${id(99)}::blob::Blob`,epoch:5})
    if(field==='blob-changed')f.raw.version=2n
    return new Response(f.bytes)
  })
  await expect(f.read()).rejects.toThrow('COMMUNITY_STORAGE_')
})
it('captures caller configuration and reference before awaits',async()=>{
  const f=await fixture(),original=f.chain.getMockImplementation()!
  f.chain.mockImplementation(async()=>{
    f.ref.sha256='bad';f.storage.aggregatorUrl='https://evil.example';return original()
  })
  await expect(f.read()).resolves.toHaveProperty('storageEndEpoch',10)
  expect(String(f.fetcher.mock.calls[0][0])).toContain('https://aggregator.example/')
})
it.each([false,true])('validates certified comment schema, extra private fields=%s',async extra=>{
  const f=await fixture(),value={schema:'soulidity.public-comment.v1',content:'Answer',...(extra?{privateReport:'not allowed'}:{})}
  const bytes=new TextEncoder().encode(JSON.stringify(value))
  f.ref.byteLength=String(bytes.length);f.blob.size=f.ref.byteLength
  f.ref.sha256=toHex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));f.put()
  f.fetcher.mockImplementation(async()=>new Response(bytes))
  const result=readPublicCommunityDocument({...f.params,kind:'comment'})
  if(extra)await expect(result).rejects.toThrow('FIELDS_INVALID')
  else expect((await result).document).toEqual(value)
})
it('does no I/O when already cancelled',async()=>{
  const f=await fixture(),controller=new AbortController();controller.abort()
  await expect(readPublicCommunityDocument({...f.params,signal:controller.signal})).rejects.toThrow()
  expect(f.chain).not.toHaveBeenCalled()
})
it('cancels a stalled response body instead of leaking the reader',async()=>{
  const f=await fixture(),controller=new AbortController(),cancel=vi.fn()
  f.fetcher.mockImplementation(async()=>new Response(new ReadableStream({cancel})))
  const pending=readPublicCommunityDocument({...f.params,signal:controller.signal})
  const rejected=expect(pending).rejects.toThrow()
  await vi.waitFor(()=>expect(f.fetcher).toHaveBeenCalled())
  controller.abort();await rejected
  await vi.waitFor(()=>expect(cancel).toHaveBeenCalledTimes(1))
})
it('bounds an uncooperative download and cancels its late body',async()=>{
  const f=await fixture(),controller=new AbortController(),cancel=vi.fn()
  let release!:(r:Response)=>void
  f.fetcher.mockImplementation(()=>new Promise(r=>{release=r}))
  const pending=readPublicCommunityDocument({...f.params,signal:controller.signal})
  const rejected=expect(pending).rejects.toThrow()
  await vi.waitFor(()=>expect(f.fetcher).toHaveBeenCalled())
  controller.abort();await rejected
  release(new Response(new ReadableStream({cancel})))
  await vi.waitFor(()=>expect(cancel).toHaveBeenCalledTimes(1))
})
