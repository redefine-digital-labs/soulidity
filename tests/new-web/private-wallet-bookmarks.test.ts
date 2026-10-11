import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, fromBase64, fromHex, toHex } from '@mysten/sui/utils'
import { assertPrivateWalletBookmarksDeployment, assertPrivateWalletBookmarksScope, assertPrivateWalletBookmarksCipherRef,
  buildCommitPrivateWalletBookmarksTx, buildPrivateWalletBookmarksSealApproval, derivePrivateWalletBookmarksHeadFieldId,
  derivePrivateWalletBookmarksSealId, PRIVATE_WALLET_BOOKMARKS_SEAL_DOMAIN, PRIVATE_WALLET_BOOKMARKS_MAX_CIPHERTEXT_BYTES,
  PrivateWalletBookmarksHeadFieldV1Bcs } from '../../packages/soulidity-sdk/src/private-wallet-bookmarks'
import { privateWalletBookmarksFixture, bookmarkId } from './fixtures/private-wallet-bookmarks'

function argument(data: any, index: number) { return data.inputs[data.commands[0].MoveCall.arguments[index].Input] }
const pure = (data: any, index: number, codec: any) => codec.parse(fromBase64(argument(data, index).Pure.bytes))
const params = (f: ReturnType<typeof privateWalletBookmarksFixture>) => ({ deployment: f.deployment, scope: f.scope,
  expectedRevision: '2', requestId: '03'.repeat(32), ciphertext: f.ref })

it('matches independent Move 722 VM Seal golden bytes and manual domain preimage', async () => {
  const scope = { registryId: `0x${'34401905bebdf8c04f3cd5f04f442a39372c8dc321c29edfb4f9cb30b23ab96'.padStart(64, '0')}`,
    owner: bookmarkId(0xa11) }
  expect(toHex(await derivePrivateWalletBookmarksSealId(scope))).toBe('9a3ea5b1d6e13d88969ecd53e5c44c2e84d6fe36b5d5334e36f4383a3832ce93')
  const domain = new TextEncoder().encode(PRIVATE_WALLET_BOOKMARKS_SEAL_DOMAIN)
  const preimage = new Uint8Array([domain.length, ...domain, 1, ...fromHex(scope.registryId), ...fromHex(scope.owner)])
  expect(toHex(await derivePrivateWalletBookmarksSealId(scope))).toBe(createHash('sha256').update(preimage).digest('hex'))
  for (const changed of [{ owner: bookmarkId(99) }, { registryId: bookmarkId(99) }]) {
    expect(toHex(await derivePrivateWalletBookmarksSealId({ ...scope, ...changed }))).not.toBe(toHex(await derivePrivateWalletBookmarksSealId(scope)))
  }
})

it('derives an owner-keyed field from exact registry UID and original-package key type', () => {
  const f = privateWalletBookmarksFixture()
  const id = deriveDynamicFieldID(f.scope.registryId, `${f.deployment.originalPackageId}::profile::BookmarksHeadKeyV1`,
    new Uint8Array([1, ...fromHex(f.scope.owner)]))
  expect(derivePrivateWalletBookmarksHeadFieldId(f.deployment.originalPackageId, f.scope)).toBe(id)
  for (const scope of [{ ...f.scope, owner: bookmarkId(99) }, { ...f.scope, registryId: bookmarkId(99) }]) {
    expect(derivePrivateWalletBookmarksHeadFieldId(f.deployment.originalPackageId, scope)).not.toBe(id)
  }
  expect(derivePrivateWalletBookmarksHeadFieldId(f.deployment.callablePackageId, f.scope)).not.toBe(id)
})

it('builds exact one-command commit ABI with no plaintext/Soul/profile/asset input', () => {
  const f = privateWalletBookmarksFixture(), data = buildCommitPrivateWalletBookmarksTx(params(f)).getData()
  expect(data.sender).toBe(f.scope.owner)
  expect(data.commands).toHaveLength(1)
  expect(data.commands[0].MoveCall).toMatchObject({ package: f.deployment.callablePackageId, module: 'profile',
    function: 'commit_bookmarks', typeArguments: [] })
  expect(data.commands[0].MoveCall!.arguments).toHaveLength(7)
  expect(data.inputs.filter(input => input.UnresolvedObject)).toHaveLength(1)
  expect(argument(data, 0).UnresolvedObject.objectId).toBe(f.scope.registryId)
  expect(pure(data, 1, bcs.u64())).toBe('2')
  expect(pure(data, 2, bcs.vector(bcs.u8()))).toEqual(Array(32).fill(3))
  expect(pure(data, 3, bcs.Address)).toBe(f.ref.blobObjectId)
  expect(pure(data, 4, bcs.string())).toBe(f.ref.blobId)
  expect(toHex(new Uint8Array(pure(data, 5, bcs.vector(bcs.u8()))))).toBe(f.ref.sha256)
  expect(pure(data, 6, bcs.u64())).toBe(f.ref.byteLength)
})

it('approval needs only stable Seal id and registry, without any head or Profile', async () => {
  const f = privateWalletBookmarksFixture(), approval = (await buildPrivateWalletBookmarksSealApproval(params(f))).getData()
  expect(approval.sender).toBe(f.scope.owner)
  expect(approval.commands[0].MoveCall).toMatchObject({ package: f.deployment.callablePackageId, module: 'profile',
    function: 'seal_approve_bookmarks', typeArguments: [] })
  expect(approval.commands[0].MoveCall!.arguments).toHaveLength(2)
  expect(approval.inputs.filter(input => input.UnresolvedObject)).toHaveLength(1)
  expect(new Uint8Array(pure(approval, 0, bcs.vector(bcs.u8())))).toEqual(await derivePrivateWalletBookmarksSealId(f.scope))
  expect(argument(approval, 1).UnresolvedObject.objectId).toBe(f.scope.registryId)
})

it('preserves u64 precision and captures/freeze-clones all scope/reference/deployment inputs', async () => {
  const f = privateWalletBookmarksFixture(), scope = assertPrivateWalletBookmarksScope(f.scope)
  const deployment = assertPrivateWalletBookmarksDeployment(f.deployment), ref = assertPrivateWalletBookmarksCipherRef(f.ref)
  expect([scope, deployment, ref].every(Object.isFrozen)).toBe(true)
  const data = buildCommitPrivateWalletBookmarksTx({ ...params(f), expectedRevision: '18446744073709551614' }).getData()
  expect(pure(data, 1, bcs.u64())).toBe('18446744073709551614')
  const pending = buildPrivateWalletBookmarksSealApproval(params(f))
  f.scope.owner = bookmarkId(99); f.deployment.callablePackageId = bookmarkId(99); f.ref.blobId = 'changed'
  const tx = (await pending).getData()
  expect(tx.sender).toBe(scope.owner)
  expect(tx.commands[0].MoveCall?.package).toBe(deployment.callablePackageId)
  expect(ref.blobId).not.toBe('changed')
})

describe('canonical and bounded public mutation arguments', () => {
  it.each(['-1', '01', '1.0', '18446744073709551616', '', 2])('rejects invalid revision %s', value => {
    const f = privateWalletBookmarksFixture()
    expect(() => buildCommitPrivateWalletBookmarksTx({ ...params(f), expectedRevision: value as string })).toThrow()
  })
  it.each(['', '00'.repeat(32), 'AB'.repeat(32), 'aa'.repeat(31), 'gg'.repeat(32)])('rejects invalid request/hash %s', value => {
    const f = privateWalletBookmarksFixture()
    expect(() => buildCommitPrivateWalletBookmarksTx({ ...params(f), requestId: value })).toThrow()
    expect(() => assertPrivateWalletBookmarksCipherRef({ ...f.ref, sha256: value })).toThrow()
  })
  it.each(['0x1', bookmarkId(0), bookmarkId(1).toUpperCase(), `${bookmarkId(1)}\n`])('rejects noncanonical ID %s', owner => {
    const f = privateWalletBookmarksFixture()
    expect(() => assertPrivateWalletBookmarksScope({ ...f.scope, owner })).toThrow()
  })
  it.each(['A'.repeat(42), 'A'.repeat(42) + 'B', '/'.repeat(43), 'A'.repeat(43) + '='])('rejects invalid blob ID %s', blobId => {
    const f = privateWalletBookmarksFixture()
    expect(() => assertPrivateWalletBookmarksCipherRef({ ...f.ref, blobId })).toThrow()
  })
  it('enforces finite ciphertext budget rather than any bookmark-count quota', () => {
    const f = privateWalletBookmarksFixture()
    expect(assertPrivateWalletBookmarksCipherRef({ ...f.ref, byteLength: String(PRIVATE_WALLET_BOOKMARKS_MAX_CIPHERTEXT_BYTES) }).byteLength).toBe('16777216')
    for (const byteLength of ['0', '16777217', '-1', '01']) {
      expect(() => assertPrivateWalletBookmarksCipherRef({ ...f.ref, byteLength })).toThrow()
    }
    expect(() => buildCommitPrivateWalletBookmarksTx({ ...params(f), expectedRevision: '18446744073709551615' })).toThrow('REVISION_EXHAUSTED')
  })
  it('rejects extra private fields and partial/wrong deployment tuples', () => {
    const f = privateWalletBookmarksFixture()
    expect(() => assertPrivateWalletBookmarksScope({ ...f.scope, soulId: bookmarkId(99) } as any)).toThrow('INVALID_FIELDS')
    expect(() => assertPrivateWalletBookmarksCipherRef({ ...f.ref, privateNames: [] } as any)).toThrow('INVALID_FIELDS')
    expect(() => assertPrivateWalletBookmarksScope({ ...f.scope, owner: f.scope.registryId })).toThrow('SCOPE_ALIAS')
    for (const value of [{ ...f.deployment, callableDigest: '' }, { ...f.deployment, chainIdentifier: 'mainnet' },
      { ...f.deployment, registryId: f.scope.registryId }, { originalPackageId: f.deployment.originalPackageId }]) {
      expect(() => assertPrivateWalletBookmarksDeployment(value as any)).toThrow()
    }
  })
})

it('preserves existing Move registry/profile BCS and exposes no private head fields/events', () => {
  const f = privateWalletBookmarksFixture()
  expect(PrivateWalletBookmarksHeadFieldV1Bcs.parse(PrivateWalletBookmarksHeadFieldV1Bcs.serialize(f.headField).toBytes())).toEqual(f.headField)
  const move = readFileSync(new URL('../../move/soulidity/sources/profile.move', import.meta.url), 'utf8')
  expect(move).toContain(`b"${PRIVATE_WALLET_BOOKMARKS_SEAL_DOMAIN}"`)
  expect(move.match(/public struct ProfileRegistryV1[^}]+}/s)?.[0]).toMatch(/id: UID,\s*version: u64,\s*profile_count: u64,\s*by_owner: Table<address, ID>,\s*by_handle: Table<String, ID>,\s*by_index: Table<u64, ID>,/)
  expect(move.match(/public struct BookmarksHeadKeyV1[^}]+}/s)?.[0]).toMatch(/version: u8,\s*owner: address,/)
  const head = move.match(/public struct BookmarksHeadV1[^}]+}/s)?.[0]
  expect(head).toMatch(/version: u8,\s*registry_id: ID,\s*owner: address,\s*revision: u64,\s*ciphertext: BookmarksCipherRefV1,\s*receipts: vector<BookmarksReceiptV1>,/)
  expect(head).not.toMatch(/soul|count|plaintext|name|intent/i)
  expect(move).not.toMatch(/event::emit\([^\n]*Bookmarks/)
})
