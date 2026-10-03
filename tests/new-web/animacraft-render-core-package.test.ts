import { afterEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFile, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { verifyAnimacraftRenderCore, printAnimacraftRenderCoreUpdatePatch } from '../../scripts/verify-animacraft-render-core.mjs'
import { MakerV8PlayerJourneyError, renderResolvedMakerV8RecipePngV8,
  mapMakerV8SmartColorPixelsV8 } from '../../packages/animacraft-render-core/maker-v8-render-core.js'

const directory = fileURLToPath(new URL('../../packages/animacraft-render-core/', import.meta.url))
const script = fileURLToPath(new URL('../../scripts/verify-animacraft-render-core.mjs', import.meta.url))
const artifact = join(directory, 'maker-v8-render-core.js')
const temporary: string[] = []
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'animacraft-render-package-')); temporary.push(root)
  const copy = join(root, 'package'); await mkdir(copy)
  for (const name of ['package.json', 'source.json', 'maker-v8-render-core.js']) await copyFile(join(directory, name), join(copy, name))
  return { root, directory: copy }
}

it('verifies the committed source pin locally without the Animacraft checkout', async () => {
  const metadata = JSON.parse(await readFile(join(directory, 'source.json'), 'utf8'))
  const result = await verifyAnimacraftRenderCore()
  expect(result).toEqual({ artifact: 'maker-v8-render-core.js', sha256: metadata.sha256,
    byteLength: metadata.byteLength, sourceCompared: false })
  expect(hash(await readFile(artifact))).toBe(metadata.sha256)
  const cli = JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8' }))
  expect(cli).toEqual(result)
})

it('rejects artifact/hash drift and package entry redirects', async () => {
  const f = await fixture(); const modulePath = join(f.directory, 'maker-v8-render-core.js')
  const bytes = await readFile(modulePath)
  await writeFile(modulePath, Buffer.concat([bytes, Buffer.from('// drift\n')]))
  await expect(verifyAnimacraftRenderCore(f)).rejects.toThrow('pinned source SHA-256')
  await writeFile(modulePath, bytes)
  const manifestPath = join(f.directory, 'package.json'); const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  for (const changed of [{ ...manifest, browser: './other.js' },
    { ...manifest, exports: { '.': { ...manifest.exports['.'], browser: './other.js' } } },
    { ...manifest, main: './wrapper.js' }]) {
    await writeFile(manifestPath, JSON.stringify(changed))
    await expect(verifyAnimacraftRenderCore(f)).rejects.toThrow('original module directly')
  }
})

it('compares source only when explicitly supplied and generates a patch without writing', async () => {
  const f = await fixture(); const sourceFile = join(f.root, 'original.js')
  const original = await readFile(artifact); await writeFile(sourceFile, original)
  expect((await verifyAnimacraftRenderCore({ ...f, sourceFile })).sourceCompared).toBe(true)
  const changed = Buffer.concat([original, Buffer.from('// reviewed source update\n')]); await writeFile(sourceFile, changed)
  await expect(verifyAnimacraftRenderCore({ ...f, sourceFile })).rejects.toThrow('does not byte-match')
  const oldPin = await readFile(join(f.directory, 'source.json'), 'utf8')
  const patch = await printAnimacraftRenderCoreUpdatePatch(sourceFile, f)
  expect(patch).toContain('*** Update File: ' + join(f.directory, 'maker-v8-render-core.js'))
  expect(patch).toContain('*** Update File: ' + join(f.directory, 'source.json'))
  expect(patch).toContain('+// reviewed source update')
  expect(patch).toContain(hash(changed))
  expect(await readFile(join(f.directory, 'source.json'), 'utf8')).toBe(oldPin)
  expect(await readFile(join(f.directory, 'maker-v8-render-core.js'))).toEqual(original)
  await expect(printAnimacraftRenderCoreUpdatePatch(undefined, f)).rejects.toThrow('requires --source-file')
})

it('package self-import is the original module, sharing functions and exact error identity', () => {
  const source = `import assert from 'node:assert/strict';
    import * as pkg from '@soulidity/animacraft-render-core';
    import * as direct from './maker-v8-render-core.js';
    assert.deepEqual(Object.keys(pkg).sort(), ['MAKER_V8_BLEND_MODES','MAKER_V8_BLEND_CODES','MAKER_V8_CANVAS_BLEND_MODES','MAKER_V8_STANDARD_EXPORT_MAX_EDGE','MAKER_V8_ORIGINAL_EXPORT_MAX_PIXELS','makerV8ExportSizes','exactMakerV8ExportOptions','MakerV8PlayerJourneyError','colorizeMakerV8ImageSourceV8','mapMakerV8SmartColorPixelsV8','renderResolvedMakerV8RecipePngV8','isMakerV8SourceAsset'].sort());
    for (const key of Object.keys(pkg)) assert.equal(pkg[key], direct[key]);
    await assert.rejects(pkg.renderResolvedMakerV8RecipePngV8(), error => error instanceof pkg.MakerV8PlayerJourneyError && error.code === 'MAKER_V8_PLAYER_JOURNEY_RENDER_INPUT_INVALID');`
  expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', source], { cwd: directory })).not.toThrow()
})

it('bundles for browsers without Node, wallet, network or Player authority dependencies', async () => {
  const result = await build({ entryPoints: [artifact], bundle: true, platform: 'browser', format: 'esm',
    write: false, metafile: true, logLevel: 'silent' })
  const paths = Object.keys(result.metafile!.inputs)
  expect(paths.every(path => path.endsWith('/maker-v8-render-core.js')
    || path.includes('node_modules/@noble/') || path.includes('node_modules/@mysten/')
    || path.includes('node_modules/@scure/'))).toBe(true)
  expect(paths.some(path => /player|wallet|seal|native-equipment|node:/.test(path))).toBe(false)
  expect(result.metafile!.outputs[Object.keys(result.metafile!.outputs)[0]].imports).toEqual([])
  expect(result.outputFiles[0].text).not.toMatch(/\/Users\/|node:crypto|process\.env|require\(/)
})

it('retains original error fields and deterministic color output through the packaged API', async () => {
  await expect(renderResolvedMakerV8RecipePngV8()).rejects.toBeInstanceOf(MakerV8PlayerJourneyError)
  await expect(renderResolvedMakerV8RecipePngV8()).rejects.toMatchObject({
    name: 'MakerV8PlayerJourneyError', code: 'MAKER_V8_PLAYER_JOURNEY_RENDER_INPUT_INVALID', layer: 'RENDER', details: {},
  })
  const input = { width: 1, height: 1, data: new Uint8ClampedArray([128, 128, 128, 255]) }
  const result = mapMakerV8SmartColorPixelsV8(input, { key: 'red', rgba: '#ff0000ff', stops: [] })
  expect([...result.data]).toEqual([255, 1, 1, 255]); expect([...input.data]).toEqual([128, 128, 128, 255])
})
