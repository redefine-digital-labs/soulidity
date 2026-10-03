import { describe, expect, it, vi } from 'vitest'
import { attestNativeReceiveTarget, parseNativeReceiveRequest, readNativeReceiveTarget, verifyNativeReceive } from '../../web/lib/animacraft/native-receive'
import { nativeReceiveFixture as fixture } from './fixtures/native-receive'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { KioskItemFieldBcs } from '@soulidity/sdk'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`

describe('native V8 server receive evidence',()=>{
  it.each(['11111111111111111111111111111111','35834a8a'])('rejects non-mainnet full digest or compatibility short ID: %s', async chainIdentifier => {
    const f=fixture()
    vi.spyOn(f.client.core,'getChainIdentifier').mockResolvedValue({chainIdentifier})
    await expect(attestNativeReceiveTarget(f.client,f.target)).rejects.toThrow('Mainnet RPC identity mismatch')
    expect(f.calls).toHaveLength(0)
  })
  it('queries compiled empty Move key 00 and rejects the previous zero-byte field ID', async () => {
    const f = fixture(); const query = vi.spyOn(f.client.core, 'getDynamicField')
    await attestNativeReceiveTarget(f.client, f.target)
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ name: expect.objectContaining({ bcs: new Uint8Array([0]) }) }))
    f.dynamicField.fieldId = deriveDynamicFieldID(f.target.protocolConfigId,
      `${f.target.coreOriginalPackageId}::protocol_config_v8::SoulidityBindingSlotKeyV8`, new Uint8Array())
    await expect(attestNativeReceiveTarget(f.client, f.target)).rejects.toThrow('slot mismatch')
  })
  it('reads one explicit release environment and rejects SDK/receiver divergence', () => {
    const { target } = fixture()
    const env = { NEXT_PUBLIC_SUI_NETWORK: 'mainnet',
      NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: target.soulidityCallablePackageId,
      NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: target.soulidityOriginalPackageId,
      NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: JSON.stringify(target) }
    expect(readNativeReceiveTarget(env)).toEqual(target)
    expect(() => readNativeReceiveTarget({ ...env, NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: id(99) })).toThrow('configuration is unavailable')
    expect(() => readNativeReceiveTarget({ ...env, NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: undefined })).toThrow('configuration is unavailable')
  })
  it('proves upgraded native package, protocol slot, immutable binding and historical State DF9',async()=>{
    const f=fixture(); await expect(verifyNativeReceive(f.client,f.target,f.input)).resolves.toMatchObject({
      soulId: f.input.soulOnChainId, stateId: id(14), contentId: id(17),
      versions: [{ kind: 0, name: 'soul', versionIndex: '0', blobObjectId: id(22), sealEncrypted: false }],
    })
    expect(f.calls.find(call=>call.objectId===f.dfId).version).toBe(2n)
    expect(f.calls.find(call=>call.objectId===f.itemFieldId).version).toBe(2n)
    expect(parseNativeReceiveRequest(f.input)).toEqual(f.input)
  })
  it.each(['missing-effect', 'not-created', 'digest', 'parent', 'key', 'value', 'trailing', 'direct-kiosk',
    'effect-parent', 'effect-kind', 'effect-input-state', 'effect-input-version', 'effect-output-state', 'duplicate-effect'] as const)(
    'requires historical mint wrapper proof: %s', async problem => {
      const f = fixture(), row = f.objects.get(f.itemFieldId)
      if (problem === 'missing-effect') f.tx.effects.changedObjects = f.tx.effects.changedObjects.filter((c: any) => c.objectId !== f.itemFieldId)
      if (problem === 'not-created') f.tx.effects.changedObjects.find((c: any) => c.objectId === f.itemFieldId).idOperation = 'None'
      const effect = f.tx.effects.changedObjects.find((c: any) => c.objectId === f.itemFieldId)
      if (problem === 'effect-parent') effect.outputOwner.ObjectOwner = id(99)
      if (problem === 'effect-kind') effect.outputOwner = { $kind: 'AddressOwner', AddressOwner: id(18) }
      if (problem === 'effect-input-state') effect.inputState = 'Exists'
      if (problem === 'effect-input-version') effect.inputVersion = '1'
      if (problem === 'effect-output-state') effect.outputState = 'DoesNotExist'
      if (problem === 'duplicate-effect') f.tx.effects.changedObjects.push(structuredClone(effect))
      if (problem === 'digest') row.digest = 'wrong'
      if (problem === 'parent') row.owner.address = id(99)
      if (problem === 'direct-kiosk') f.objects.get(id(12)).owner.address = id(18)
      if (problem === 'key' || problem === 'value') {
        const value = KioskItemFieldBcs.parse(row.contents.value)
        if (problem === 'key') value.name.name.id = id(99)
        else value.value = id(99)
        row.contents.value = KioskItemFieldBcs.serialize(value).toBytes()
      }
      if (problem === 'trailing') row.contents.value = new Uint8Array([...row.contents.value, 0])
      await expect(verifyNativeReceive(f.client, f.target, f.input)).rejects.toThrow()
      expect(f.calls.filter(call => call.objectId === f.itemFieldId).every(call => call.version === 2n)).toBe(true)
    })
  it.each(['sender','root','callable','bindingOwner','stateOwner','soulCustody','dfOwner','network','historicalDigest','df9','event','sidecar'] as const)('rejects %s before mirror acceptance',async label=>{
    const f=fixture()
    if(label==='sender')f.tx.transaction.sender=id(99)
    if(label==='root')f.input.rootId=id(99)
    if(label==='callable')f.tx.transaction.commands[0].MoveCall.package=id(99)
    if(label==='bindingOwner')f.objects.get(id(13)).owner.kind=3
    if(label==='stateOwner')f.objects.get(id(14)).owner.kind=4
    if(label==='soulCustody')f.objects.get(id(12)).owner.address=id(99)
    if(label==='dfOwner')f.objects.get(f.dfId).owner.address=id(99)
    if(label==='network')vi.spyOn(f.client.core,'getChainIdentifier').mockResolvedValue({chainIdentifier:'testnet'})
    if(label==='historicalDigest')f.objects.get(id(14)).digest='bad'
    if(label==='df9')f.objects.get(f.dfId).contents.value=new Uint8Array(1)
    if(label==='event')f.tx.events.splice(0,1)
    if(label==='sidecar')f.input.contentSidecars.push({kind:99,name:'extra',versionIndex:0,sidecar:null})
    await expect(verifyNativeReceive(f.client,f.target,f.input)).rejects.toThrow()
  })
  it('fails closed for absent deployment and protocol/package drift',async()=>{
    expect(()=>readNativeReceiveTarget({})).toThrow('configuration is unavailable')
    const f=fixture(); f.objects.get(id(5)).package.linkage=[]
    await expect(attestNativeReceiveTarget(f.client,f.target)).rejects.toThrow('linkage')
    expect(()=>parseNativeReceiveRequest({...f.input,certificate:{}})).toThrow('fields')
  })
})
