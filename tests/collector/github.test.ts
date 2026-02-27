import { describe, it, expect } from 'vitest'
import { collectGithub } from '../../src/collector/github.js'

describe('GitHub collector config', () => {
  it('module exports collectGithub function', () => {
    expect(typeof collectGithub).toBe('function')
  })
})
