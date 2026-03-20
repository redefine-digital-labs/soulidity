import { describe, expect, it } from 'vitest'

import {
  decodeMoveBytesAsHex,
  decodeMoveBytesAsUtf8,
  decodeMoveText,
} from '../../web/lib/services/sui-event-decoder.ts'

describe('Sui event byte decoding', () => {
  it('keeps plain utf8 strings unchanged', () => {
    expect(decodeMoveBytesAsUtf8('Soul Alpha')).toBe('Soul Alpha')
  })

  it('decodes base64 strings to utf8', () => {
    expect(decodeMoveBytesAsUtf8('U291bCBBbHBoYQ==')).toBe('Soul Alpha')
  })

  it('treats text fields as already-decoded strings even when they look like base64', () => {
    expect(decodeMoveText('Zm9vYmFy')).toBe('Zm9vYmFy')
  })

  it('decodes byte arrays to utf8 and hex', () => {
    expect(decodeMoveText([83, 111, 117, 108])).toBe('Soul')
    expect(decodeMoveBytesAsUtf8([83, 111, 117, 108])).toBe('Soul')
    expect(decodeMoveBytesAsHex([0xde, 0xad, 0xbe, 0xef])).toBe('deadbeef')
  })

  it('normalizes existing hex strings', () => {
    expect(decodeMoveBytesAsHex('0xDEADBEEF')).toBe('deadbeef')
  })
})
