import { describe, expect, it, vi } from 'vitest'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { collectPublishDependencies } from '../../scripts/lib/publish-dependencies'

const id = (n: number) => normalizeSuiAddress(`0x${n.toString(16)}`)
function pkg(n: number, links: Record<string, unknown> = {}) {
  return { objectId: id(n), content: { Package: { id: id(n), version: 1, linkage_table: links } } }
}
const edge = (n: number) => ({ upgraded_id: id(n), upgraded_version: 2 })

describe('exact publish dependency closure', () => {
  it('follows upgraded targets, never replaces them with original address keys', () => {
    const objects = new Map([[id(10), pkg(10, { [id(20)]: edge(21) })],
      [id(21), pkg(21, { [id(30)]: edge(31) })], [id(31), pkg(31)]])
    const read = vi.fn((key: string) => objects.get(key))
    expect(collectPublishDependencies([id(10)], read)).toEqual([id(10), id(21), id(31)])
    expect(read.mock.calls.flat()).toEqual([id(10), id(21), id(31)])
  })
  it('deduplicates shared dependencies and cycles without changing the frozen target', () => {
    const objects = new Map([[id(10), pkg(10, { [id(11)]: edge(11) })],
      [id(11), pkg(11, { [id(10)]: edge(10) })]])
    const read = vi.fn((key: string) => objects.get(key))
    expect(collectPublishDependencies([id(11), '0xa', id(10)], read)).toEqual([id(10), id(11)])
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('accepts the observed Sui CLI framework linkage shape and zero version', () => {
    const read = (key: string) => key === id(2)
      ? pkg(2, { [id(1)]: { upgraded_id: id(1), upgraded_version: 0 } }) : pkg(1)
    expect(collectPublishDependencies(['0x2'], read)).toEqual([id(1), id(2)])
  })
  it('stops on a nested read failure without exposing raw command output', () => {
    expect(() => collectPublishDependencies([id(10)], key => {
      if (key === id(10)) return pkg(10, { [id(11)]: edge(11) })
      throw new Error('sensitive CLI error detail')
    })).toThrow(`Cannot read publish dependency ${id(11)}; preparation stopped`)
  })
  it.each([null, {}, [], { error: 'not found' },
    { objectId: id(10), content: { MoveObject: {} } },
    { objectId: id(10), content: { Package: { id: id(10) } } },
    { objectId: id(10), content: { Package: { id: id(10), linkage_table: [] } } },
    pkg(11), { objectId: id(10), content: { Package: { id: id(11), linkage_table: {} } } },
  ])('rejects missing, non-package or substituted evidence %j', value => {
    expect(() => collectPublishDependencies([id(10)], () => value)).toThrow()
  })
  it.each([null, {}, [], { upgraded_id: id(11) }, { upgraded_id: id(11), upgraded_version: -1 },
    { upgraded_id: id(11), upgraded_version: '01' }, { upgraded_id: id(11), upgraded_version: '18446744073709551616' },
    { upgraded_id: '0x0', upgraded_version: 1 }, { upgraded_id: 'not-an-id', upgraded_version: 1 },
    { upgraded_id: id(11), upgraded_version: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects malformed linkage rather than silently omitting it %j', value => {
    expect(() => collectPublishDependencies([id(10)], () => pkg(10, { [id(11)]: value }))).toThrow()
  })
  it.each([[], ['0x0'], ['garbage'], ['0x1'.padEnd(67, '1')]].map(values => [values]))('rejects invalid initial inventory %j before reading', values => {
    const read = vi.fn()
    expect(() => collectPublishDependencies(values, read)).toThrow()
    expect(read).not.toHaveBeenCalled()
  })
  it('rejects a malformed original identity even with a valid target', () => {
    expect(() => collectPublishDependencies([id(10)], () => pkg(10, { wrong: edge(11) }))).toThrow()
  })
  it('bounds the initial inventory and recursively discovered closure', () => {
    const read = vi.fn()
    expect(() => collectPublishDependencies(Array(4097).fill(id(10)), read)).toThrow(/limit/)
    expect(read).not.toHaveBeenCalled()
    expect(() => collectPublishDependencies([id(1)], key => {
      const n = Number(BigInt(key))
      return pkg(n, { [id(n + 1)]: edge(n + 1) })
    })).toThrow(/limit/)
  })
})
