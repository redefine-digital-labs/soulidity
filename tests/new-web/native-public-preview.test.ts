import { it, expect } from 'vitest'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { SOUL_PUBLIC_PREVIEW_KEY, SOUL_PUBLIC_PREVIEW_SCHEMA, encodeSoulPublicPreview, decodeSoulPublicPreview } from '../../packages/soulidity-sdk/src/soul-public-preview'

const animacraft = resolve(process.env.ANIMACRAFT_WORKSPACE ?? '_paired/animacraft')
const importFile = (path: string): Promise<any> => import(/* @vite-ignore */ pathToFileURL(path).href)
const payload = (tags: string[] = [], previewImages: string[] = []) => ({ schema: SOUL_PUBLIC_PREVIEW_SCHEMA, tags, previewImages })

it('both products emit the same exact public preview schema, normalization and UTF-8 bytes', async () => {
  const native = await importFile(`${animacraft}/maker-v8-public-preview.js`)
  expect(native.MAKER_V8_PUBLIC_PREVIEW_KEY).toBe(SOUL_PUBLIC_PREVIEW_KEY)
  for (const value of [payload(), payload([' OC ', '猫', 'oc', '', 'new']),
    payload(['😀'.repeat(25)], ['https://images.example.com/a.png', 'http://cdn.example.com/b?q=public'])]) {
    const encoded = encodeSoulPublicPreview(value)
    expect(native.encodeMakerV8PublicPreviewV8(value)).toBe(encoded)
    expect(native.decodeMakerV8PublicPreviewV8(encoded)).toEqual(decodeSoulPublicPreview(encoded))
  }
  const intent = await importFile(`${animacraft}/maker-v8-native-content-intent.js`)
  expect(intent.buildMakerV8NativePublicPreviewV8({ tags: ' OC,猫,oc,,new' })).toEqual(decodeSoulPublicPreview(encodeSoulPublicPreview(payload([' OC', '猫', 'oc', '', 'new']))))
})
it('both sides reject malformed/private fields, invalid public URLs, bounds and lossy text', async () => {
  const native = await importFile(`${animacraft}/maker-v8-public-preview.js`)
  const bad = [null, { ...payload(), dek: 'private' }, { ...payload(), schema: 'other' },
    payload(Array(13).fill('tag')), payload(['x'.repeat(51)]), payload(['İ'.repeat(50)]), payload(['\ud800']), payload(['secret\ntext']),
    ...['https://user:pass@example.com/a', 'https://example.com/a?token=secret', 'http://localhost/a', 'http://127.1/a',
      'data:image/png;base64,AAAA', 'javascript:alert(1)', 'walrus://private-ciphertext', 'https://example.com/a#secret',
      'https://example.com/\ud800'].map(url => payload([], [url])), payload([], Array(9).fill('https://example.com/a'))]
  for (const value of bad) {
    expect(() => encodeSoulPublicPreview(value)).toThrow()
    expect(() => native.encodeMakerV8PublicPreviewV8(value)).toThrow()
  }
  const valid = encodeSoulPublicPreview(payload(['oc']))
  for (const stored of [valid + ' ', valid.replace('"oc"', '"OC"'), valid.replace('"tags":', '"tags":["private"],"tags":'), '{']) {
    expect(() => decodeSoulPublicPreview(stored)).toThrow()
    expect(() => native.decodeMakerV8PublicPreviewV8(stored)).toThrow()
  }
})
