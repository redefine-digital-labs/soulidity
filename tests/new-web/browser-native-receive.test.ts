import { afterEach, describe, expect, it, vi } from 'vitest'
import { receiveBrowserNativeRequest } from '../../web/lib/animacraft/browser-native-receive'
import { receiveNativeRequest } from '../../web/lib/animacraft/native-handoff'
import { NativeSoulStateBcs } from '../../web/lib/animacraft/native-receive'
import { EnvelopeConfigField, envelopeId as id, nativeEnvelopeReceiveFixture } from './fixtures/content-envelope'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('browser native completion, direct chain proof and durable envelopes', () => {
  it('reads the actual mint/package/state/DF/Seal bytes with no Node Buffer, HTTP receiver or signature', async () => {
    const f = nativeEnvelopeReceiveFixture(), fetcher = vi.fn(() => { throw new Error('owned API must not run') })
    vi.stubGlobal('fetch', fetcher); vi.stubGlobal('Buffer', undefined)
    const result = await receiveNativeRequest(f.request, request => receiveBrowserNativeRequest(request, () => id(11), f.dependencies))
    expect(result).toMatchObject({ result: { status: 'COMPLETE', soulId: id(12), transactionDigest: f.input.txDigest } })
    expect(fetcher).not.toHaveBeenCalled()
    for (const field of f.fieldIds) expect(f.calls.some(row => row.objectId === field && row.readMask.paths.length === 3)).toBe(true)
  })
  it('preflights only with the same connected wallet and exact release', async () => {
    const f = nativeEnvelopeReceiveFixture(), { payload: _, ...base } = f.request
    const request = { ...base, type: 'PREFLIGHT' as const }
    await expect(receiveBrowserNativeRequest(request, () => null, f.dependencies)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(f.calls).toHaveLength(0)
    await expect(receiveBrowserNativeRequest(request, () => id(11), f.dependencies)).resolves.toEqual({ ready: true, rootId: id(10), signer: id(11) })
  })
  it.each(['missing', 'wrong-parent', 'wrong-type', 'wrong-id', 'wrong-key', 'different-value', 'current-content', 'changed-readset'])(
    'never reports COMPLETE for %s envelope evidence', async variant => {
      const f = nativeEnvelopeReceiveFixture(), field = f.current.get(f.fieldIds[0])
      if (variant === 'missing') f.current.delete(f.fieldIds[0])
      if (variant === 'wrong-parent') field.owner.address = id(98)
      if (variant === 'wrong-type') field.objectType = '0x2::object::ID'
      if (variant === 'wrong-id') field.objectId = id(98)
      if (['wrong-key', 'different-value'].includes(variant)) {
        const parsed = EnvelopeConfigField.parse(field.contents.value)
        if (variant === 'wrong-key') parsed.name = 'wrong'
        else {
          const json = JSON.parse(new TextDecoder().decode(new Uint8Array(parsed.value)))
          json.sidecar.fileName = 'different.md'; parsed.value = [...new TextEncoder().encode(JSON.stringify(json))]
        }
        field.contents.value = EnvelopeConfigField.serialize(parsed).toBytes()
      }
      if (variant === 'current-content') {
        const state = f.current.get(id(14)), parsed = NativeSoulStateBcs.parse(state.contents.value)
        parsed.content_id = id(99); state.contents.value = NativeSoulStateBcs.serialize(parsed).toBytes()
      }
      if (variant === 'changed-readset') {
        const read = f.client.ledgerService.getObject.bind(f.client.ledgerService)
        vi.spyOn(f.client.ledgerService, 'getObject').mockImplementation(async (request: any, ...rest: any[]) => {
          if (request.objectId === f.fieldIds[0] && request.readMask.paths.length === 3) field.version++
          return read(request, ...rest)
        })
      }
      const result = await receiveNativeRequest(f.request, request => receiveBrowserNativeRequest(request, () => id(11), f.dependencies))
      expect(result).toHaveProperty('error'); expect(result).not.toHaveProperty('result')
      if (variant === 'missing') expect(result).toHaveProperty('error.code', 'NATIVE_RECEIVE_ENVELOPE_PENDING')
    },
  )
  it('rejects wallet switch during read and snapshots caller payload before waiting', async () => {
    const f = nativeEnvelopeReceiveFixture(); let wallet = id(11)
    const read = f.client.ledgerService.getObject.bind(f.client.ledgerService)
    vi.spyOn(f.client.ledgerService, 'getObject').mockImplementation(async (request: any, ...rest: any[]) => {
      wallet = id(90); return read(request, ...rest)
    })
    const pending = receiveBrowserNativeRequest(f.request, () => wallet, f.dependencies)
    f.request.signer = id(90)
    await expect(pending).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })
  it('settles cancellation without allowing a delayed read to report completion', async () => {
    const f = nativeEnvelopeReceiveFixture(), controller = new AbortController()
    let release!: (value: any) => void
    const delayed = new Promise<any>(resolve => { release = resolve })
    vi.spyOn(f.client.core, 'getChainIdentifier').mockImplementation(() => delayed)
    const pending = receiveBrowserNativeRequest(f.request, () => id(11), { ...f.dependencies, signal: controller.signal })
    controller.abort(new Error('cancelled'))
    await expect(pending).rejects.toThrow('cancelled')
    release({ chainIdentifier: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S' })
  })
})
