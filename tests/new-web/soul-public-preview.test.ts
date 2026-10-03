import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { bcs } from '@mysten/sui/bcs'
import type { Transaction } from '@mysten/sui/transactions'
import { buildSoulPublicPreviewStateConfig, decodeSoulPublicPreview, encodeSoulPublicPreview,
  SOUL_PUBLIC_PREVIEW_KEY, SOUL_PUBLIC_PREVIEW_SCHEMA, SoulPublicPreviewError, validateSoulPublicPreview } from '../../packages/soulidity-sdk/src/soul-public-preview'
import { buildLegacyInitialContent, buildLegacyInitialStateConfig } from '../../packages/soulidity-sdk/src/legacy-mint-bridge'
import { buildPhase2InitialContent } from './fixtures/legacy-phase2-mint-helpers'
import { validateInitialStateConfigEntries } from '../../packages/soulidity-sdk/src/tx/shared'
import { buildSetStateConfigTx } from '../../packages/soulidity-sdk/src/tx/content'
import { buildBatchPublishSoulTx, buildCollectionFastPathPtb2Tx, buildPublishSoulTx,
  buildPublishSoulWithBindTx, buildPublishSoulWithCollectionAndListTx, buildPublishSoulWithListTx } from '../../packages/soulidity-sdk/src/tx/publish'
import { buildImportSoulTx } from '../../packages/soulidity-sdk/src/tx/import'
import { buildPersonalJoinSoulTx } from '../../packages/soulidity-sdk/src/tx/personal-join'
import { normalizeTags } from '../../packages/soulidity-sdk/src/tags'
import { buildCollectionAuthoringInput } from '../../web/lib/soulidity/collection-authoring-input'
import { soulAuthoringRequestFixture } from './fixtures/soul-authoring'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const publicInput = () => ({ tags: [' Artist ', 'ARTIST', ' Original '], previewImages: ['https://images.example.com/original.png'] })
const payload = () => ({ schema: SOUL_PUBLIC_PREVIEW_SCHEMA, ...publicInput() })
const canonical = '{"schema":"soulidity.soul-public-preview.v1","tags":["artist","original"],"previewImages":["https://images.example.com/original.png"]}'
const inputs = () => ({ protectedBlobObjectId: id(20), foundingMemoryBlobObjectId: id(21), publicPreview: publicInput() })
const withEnvelopes = (entries: ReturnType<typeof buildLegacyInitialContent>) => entries.map(entry => ({
  ...entry, expectedVersionIndex: 0, encryptedEnvelope: new Uint8Array([1]),
}))
const mint = () => ({ currentKioskId: id(10), currentKioskCapOnChainId: id(11), name: 'Original', description: 'Description',
  mintNonce: new Uint8Array(16).fill(1), expectedContentObjectId: id(40),
  imageUrl: 'https://images.example.com/soul.png', creatorRoyaltyBps: 250,
  initialContent: withEnvelopes(buildLegacyInitialContent(inputs())), initialStateConfig: buildLegacyInitialStateConfig(inputs()) })
const configPure = (tx: Transaction, arg: any) => tx.getData().inputs[arg.Input].Pure!.bytes
function stateRecords(tx: Transaction) {
  return tx.getData().commands.flatMap((command, index) => {
    const call = command.MoveCall
    if (call?.function !== 'new_state_config_entry') return []
    return [{ index, key: bcs.string().parse(Buffer.from(configPure(tx, call.arguments[0]), 'base64')),
      value: new TextDecoder().decode(Uint8Array.from(bcs.vector(bcs.u8()).parse(Buffer.from(configPure(tx, call.arguments[1]), 'base64')))) }]
  })
}
function expectMintRecord(tx: Transaction, expected: string, count = 1) {
  const records = stateRecords(tx).filter(row => row.key === SOUL_PUBLIC_PREVIEW_KEY)
  expect(records).toHaveLength(count)
  const commands = tx.getData().commands
  for (const row of records) {
    expect(row.value).toBe(expected)
    const vector = commands.findIndex(command => command.MakeMoveVec?.elements.some(arg => 'Result' in arg && arg.Result === row.index))
    expect(vector).toBeGreaterThan(row.index)
    expect(commands.some(command => command.MoveCall?.function.startsWith('mint_')
      && command.MoveCall.arguments.some(arg => 'Result' in arg && arg.Result === vector))).toBe(true)
  }
}
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'mainnet')
  for (const [key, value] of Object.entries({ ORIGINAL_PACKAGE_ID: id(1), CALLABLE_PACKAGE_ID: id(1), MARKET_CONFIG_V2_ID: id(2),
    KIOSK_REGISTRY_ID: id(3), SOUL_TRANSFER_POLICY_ID: id(4), COLLECTION_TRANSFER_POLICY_ID: id(5), KIND_REGISTRY_ID: id(6) })) {
    vi.stubEnv(`NEXT_PUBLIC_SOULIDITY_${key}`, value)
  }
})
afterEach(() => vi.unstubAllEnvs())

describe('one bounded public preview schema', () => {
  it('preserves existing tag normalization but produces stable field order and roundtrips', () => {
    expect(encodeSoulPublicPreview(payload())).toBe(canonical)
    const decoded = decodeSoulPublicPreview(canonical)
    expect(decoded).toEqual({ schema: SOUL_PUBLIC_PREVIEW_SCHEMA, tags: ['artist', 'original'], previewImages: publicInput().previewImages })
    expect(Object.isFrozen(decoded)).toBe(true)
    expect(Object.isFrozen(decoded.tags)).toBe(true)
    expect(Object.isFrozen(decoded.previewImages)).toBe(true)
    const input = payload(), output = validateSoulPublicPreview(input)
    input.tags[0] = 'changed'; input.previewImages[0] = 'https://other.example.com/changed'
    expect(encodeSoulPublicPreview(output)).toBe(canonical)
  })
  it('preserves explicit empty arrays; whitespace-only tags follow existing normalization', () => {
    const entry = buildSoulPublicPreviewStateConfig({ tags: [' ', ''], previewImages: [] })
    expect(entry).toEqual({ key: SOUL_PUBLIC_PREVIEW_KEY,
      valueUtf8: '{"schema":"soulidity.soul-public-preview.v1","tags":[],"previewImages":[]}' })
  })
  it('accepts exactly 12 tags, 50 UTF16 characters and eight actual previews', () => {
    const value = { schema: SOUL_PUBLIC_PREVIEW_SCHEMA, tags: Array.from({ length: 12 }, (_, n) => `${n}`.padStart(50, 'a')),
      previewImages: Array.from({ length: 8 }, (_, n) => `https://images.example.com/${n}.png`) }
    expect(decodeSoulPublicPreview(encodeSoulPublicPreview(value))).toEqual(value)
  })
  it('checks post-lowercase Unicode length without truncating', () => {
    expect(() => encodeSoulPublicPreview({ ...payload(), tags: ['İ'.repeat(50)] })).toThrow('TAGS_INVALID')
    const text = encodeSoulPublicPreview({ ...payload(), tags: ['İ'.repeat(25), '🦊'] })
    expect(decodeSoulPublicPreview(text).tags).toEqual(['i\u0307'.repeat(25), '🦊'])
  })
  it.each([undefined, null, [], {}, { tags: [], previewImages: [] }, { ...payload(), schema: 'old' },
    { ...payload(), privateContent: 'not public' }, { ...payload(), dek: 'secret' }, { ...payload(), name: 'duplicate authority' }])(
  'rejects missing/schema/extra fields %#', value => expect(() => encodeSoulPublicPreview(value)).toThrow(SoulPublicPreviewError))
  it.each([null, 'tag', [1], Array(1), Array(13).fill('duplicate'), ['x'.repeat(51)], ['line\nbreak'], ['\u0000'], ['\u007f'], ['\ud800'], ['\udc00']])(
    'rejects malformed or oversized tag input %# before normalizing', tags => {
      expect(() => encodeSoulPublicPreview({ ...payload(), tags })).toThrow('TAGS_INVALID')
    })
  it.each([null, 'https://images.example.com/a.png', Array(9).fill('https://images.example.com/a.png')])(
    'rejects missing or oversized preview arrays %#', previewImages => {
      expect(() => encodeSoulPublicPreview({ ...payload(), previewImages })).toThrow('PREVIEWS_INVALID')
    })
  it.each([undefined, null, 1, '', ' ', '/image.png', 'data:image/png;base64,secret', 'blob:https://example.com/private',
    'file:///private/key', 'walrus://blob', 'https://user:password@images.example.com/a',
    'https://images.example.com/a#private', 'https://images.example.com/a?token=secret',
    'https://images.example.com/a?%61pi_key=secret', 'https://images.example.com/a?X-Amz-Signature=secret',
    'http://localhost/a', 'http://sub.localhost/a', 'http://127.0.0.1/a', 'http://2130706433/a',
    'http://[::1]/a', 'http://10.0.0.1/a', 'http://metadata.internal/a',
    'https://images.example.com/\\evil', 'https://images.example.com/\ud800', `https://images.example.com/${'a'.repeat(2048)}`])(
    'rejects non-public/credential/malformed preview URL %#', url => {
      expect(() => encodeSoulPublicPreview({ ...payload(), previewImages: [url] })).toThrow('URL_INVALID')
    })
  it.each(['http://images.example.com/a.png', 'https://images.example.com/a.png?w=200&format=webp',
    'https://IMAGES.example.com/a%20b.png'])('keeps actual public http(s) reference bytes, including harmless transforms (%s)', url => {
      expect(decodeSoulPublicPreview(encodeSoulPublicPreview({ ...payload(), previewImages: [url] })).previewImages).toEqual([url])
    })
  it.each([
    '{not JSON', `${canonical} `, canonical.replace('"artist"', '"ARTIST"'),
    canonical.replace('"tags":', '"private":"secret","tags":'),
    canonical.replace('"tags":', '"tags":["hidden discarded data"],"tags":'),
    JSON.stringify({ tags: ['artist', 'original'], schema: SOUL_PUBLIC_PREVIEW_SCHEMA, previewImages: publicInput().previewImages }),
  ])('rejects noncanonical stored bytes including duplicate-key hidden data %#', value => {
    expect(() => decodeSoulPublicPreview(value)).toThrow(SoulPublicPreviewError)
  })
  it.each([undefined, {} , { tags: [] }, { tags: [], previewImages: [], privateContent: 'secret' }])('high-level entry builder never fills missing values %#', value => {
    expect(() => buildSoulPublicPreviewStateConfig(value as never)).toThrow('SCHEMA_INVALID')
  })
})

describe('initial and current-owner config use the same strict validator', () => {
  it('keeps sprite data and explicit preview record in both existing high-level helpers', () => {
    const initialSprite = { blobObjectId: id(22), spriteConfigJson: '{"frames":8}' }
    const legacy = buildLegacyInitialStateConfig({ ...inputs(), initialSprite })
    const phase2 = buildPhase2InitialContent({ ...inputs(), initialSprite }).initialStateConfig
    expect(legacy).toEqual([{ key: SOUL_PUBLIC_PREVIEW_KEY, valueUtf8: canonical }, { key: 'sprite_config_json', valueUtf8: '{"frames":8}' }])
    expect(phase2).toEqual(legacy)
    expect(() => buildLegacyInitialStateConfig({ protectedBlobObjectId: id(20) } as never)).toThrow('SCHEMA_INVALID')
    expect(() => buildPhase2InitialContent({ protectedBlobObjectId: id(20), foundingMemoryBlobObjectId: id(21) } as never)).toThrow('SCHEMA_INVALID')
  })
  it('validates explicit metadata without silently adding a record to low-level SDK config', () => {
    const rows = [{ key: 'sprite_config_json', valueUtf8: '{"frames":8}' }]
    validateInitialStateConfigEntries(rows)
    expect(rows).toEqual([{ key: 'sprite_config_json', valueUtf8: '{"frames":8}' }])
    validateInitialStateConfigEntries([])
  })
  it('writes exact canonical bytes through the real owner V2 entry, without changing its authority inputs', () => {
    const tx = buildSetStateConfigTx({ stateObjectId: id(12), key: SOUL_PUBLIC_PREVIEW_KEY, valueUtf8: canonical })
    const call = tx.getData().commands[0].MoveCall!
    expect(call.function).toBe('set_state_config_v2')
    expect(call.arguments).toHaveLength(4)
    expect(tx.getData().inputs[(call.arguments[0] as any).Input].UnresolvedObject?.objectId).toBe(id(2))
    expect(tx.getData().inputs[(call.arguments[1] as any).Input].UnresolvedObject?.objectId).toBe(id(12))
    expect(new TextDecoder().decode(Uint8Array.from(bcs.vector(bcs.u8()).parse(Buffer.from(configPure(tx, call.arguments[3]), 'base64'))))).toBe(canonical)
  })
  it.each([canonical.replace('"tags":', '"dek":"secret","tags":'), canonical.replace('https:', 'file:'), '{}', `${canonical} `])(
    'rejects malformed metadata in both initial and owner edit boundaries %#', valueUtf8 => {
      expect(() => validateInitialStateConfigEntries([{ key: SOUL_PUBLIC_PREVIEW_KEY, valueUtf8 }])).toThrow(SoulPublicPreviewError)
      expect(() => buildSetStateConfigTx({ stateObjectId: id(12), key: SOUL_PUBLIC_PREVIEW_KEY, valueUtf8 })).toThrow(SoulPublicPreviewError)
    })
  it('rejects duplicate preview records and retains generic config size checks', () => {
    const entry = buildSoulPublicPreviewStateConfig(publicInput())
    expect(() => validateInitialStateConfigEntries([entry, entry])).toThrow('duplicate state config key')
    expect(() => buildSetStateConfigTx({ stateObjectId: id(12), key: 'sprite_config_json', valueUtf8: 'x'.repeat(65537) })).toThrow('65536 bytes')
  })
})

describe('actual ordinary mint PTB seeding', () => {
  const variants = {
    publish: (params: ReturnType<typeof mint>) => buildPublishSoulTx(params),
    bind: (params: ReturnType<typeof mint>) => buildPublishSoulWithBindTx({ ...params, collectionOnChainId: id(30) }),
    list: (params: ReturnType<typeof mint>) => buildPublishSoulWithListTx({ ...params, listingPriceAtomic: 100n }),
    collectionList: (params: ReturnType<typeof mint>) => buildPublishSoulWithCollectionAndListTx({ ...params, collectionOnChainId: id(30), listingPriceAtomic: 100n }),
    import: (params: ReturnType<typeof mint>) => buildImportSoulTx({ ...params, originRef: 'source:original' }),
    wrap: (params: ReturnType<typeof mint>) => buildPersonalJoinSoulTx({ ...params, sourceObjectId: id(31), sourceObjectType: `${id(32)}::nft::NFT`, originRef: `sui:${id(31)}` }),
    batch: (params: ReturnType<typeof mint>) => buildBatchPublishSoulTx({ currentKioskId: id(10), currentKioskCapOnChainId: id(11), souls: [params] }),
    fastCollection: (params: ReturnType<typeof mint>) => buildCollectionFastPathPtb2Tx({ currentKioskId: id(10), currentKioskCapOnChainId: id(11), collectionOnChainId: id(30), souls: [params], attachCertifyCalls: () => {} }),
  }
  it.each(Object.entries(variants))('%s includes the original nonempty preview bytes in the actual mint input vector', async (_name, build) => {
    expectMintRecord(await build(mint()), canonical)
  })
  it.each(['publish', 'import', 'wrap'] as const)('%s revalidates after an awaited attachment mutates the actual config', async kind => {
    const params = { ...mint(), attachBeforeMint: async () => {
      await Promise.resolve()
      params.initialStateConfig[0].valueUtf8 = canonical.replace('"tags":', '"private":"secret","tags":')
    } }
    await expect(variants[kind](params)).rejects.toThrow('SCHEMA_INVALID')
  })
  it('retains each distinct Soul preview when actually batching multiple mints', async () => {
    const first = mint(), second = mint()
    second.mintNonce = new Uint8Array(16).fill(2)
    second.expectedContentObjectId = id(41)
    second.initialContent = withEnvelopes(buildLegacyInitialContent({ protectedBlobObjectId: id(24), foundingMemoryBlobObjectId: id(25) }))
    second.initialStateConfig = buildLegacyInitialStateConfig({ ...inputs(), publicPreview: { tags: ['second'], previewImages: ['https://images.example.com/second.png'] } })
    const tx = await buildBatchPublishSoulTx({ currentKioskId: id(10), currentKioskCapOnChainId: id(11), souls: [first, second] })
    expect(stateRecords(tx).map(row => decodeSoulPublicPreview(row.value).tags)).toEqual([['artist', 'original'], ['second']])
  })
})

describe('original high-level caller input mapping (no wallet/network execution claim)', () => {
  // Evaluate only the original call argument expressions, then use the real
  // helper. This detects wiring omissions independently of helper unit tests.
  function argumentsFrom(file: string, called: string, locals: Record<string, unknown>) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const expressions: string[] = []
    function walk(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === called) expressions.push(node.arguments[0].getText(source))
      ts.forEachChild(node, walk)
    }
    walk(source)
    return expressions.map(expression => new Function(...Object.keys(locals), `return (${expression})`)(...Object.values(locals)))
  }
  it('ordinary/import shared flow preserves draft tags and references its cover file before upload', () => {
    const file = 'web/lib/hooks/use-publish.ts'
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const expressions: string[] = []
    function walk(node: ts.Node) {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'publicPreview') expressions.push(node.initializer.getText(source))
      ts.forEachChild(node, walk)
    }
    walk(source); expect(expressions).toHaveLength(1)
    const value = new Function('draft', 'normalizeTags', 'joined', `return (${expressions[0]})`)({ tags: [' One ', 'two'] },
      normalizeTags)
    expect(value).toEqual({ tags: ['one', 'two'], previewImages: [{ kind: 'FILE', fileIndex: 0 }] })
    expect(readFileSync('web/lib/hooks/use-import.ts', 'utf8')).toContain("useSingleSoulAuthoring(approve, 'IMPORTED')")
  })
  it('wrap explicitly preserves its preexisting absence of preview inputs without copying source NFT media', () => {
    const source = ts.createSourceFile('controller.ts', readFileSync('web/lib/hooks/use-publish.ts', 'utf8'), ts.ScriptTarget.Latest, true)
    let expression = ''
    function walk(node: ts.Node) {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'publicPreview') expression = node.initializer.getText(source)
      ts.forEachChild(node, walk)
    }
    walk(source)
    expect(new Function('joined', `return (${expression})`)({ imageUrl: 'https://example.com/nft.png' })).toEqual({ tags: [], previewImages: [] })
  })
  it('Collection preview uses its own public image or the public cover, never encrypted content', async () => {
    const built = await buildCollectionAuthoringInput({ name: 'Collection', description: 'Description', extraRoyaltyBps: 500, tradeable: true,
      coverImageFile: new File(['cover'], 'cover.png'), souls: [{ name: 'Soul', description: 'Description', tags: [' Collection '], creatorRoyaltyBps: 500 }] },
      soulAuthoringRequestFixture(id(10)).target, id(10), new AbortController().signal)
    expect(built.request.mints[0].publicPreview).toEqual({ tags: ['collection'], previewImages: [{ kind: 'FILE', fileIndex: 0 }] })
    expect(built.files[0].uploadType).toBe('public')
  })
})
