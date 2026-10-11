import type { SoulGrantScope } from './types'

export const SOUL_GRANT_SCOPE_SEAL = 1
export const SOUL_GRANT_SCOPE_MEMORY = 2
export const SOUL_GRANT_SCOPE_SKILLS = 4
export const SOUL_GRANT_SCOPE_ASSETS = 8

export const ALL_SOUL_GRANT_SCOPE_MASK =
  SOUL_GRANT_SCOPE_SEAL
  | SOUL_GRANT_SCOPE_MEMORY
  | SOUL_GRANT_SCOPE_SKILLS
  | SOUL_GRANT_SCOPE_ASSETS

export const DEFAULT_ISSUE_SCOPE_MASK = ALL_SOUL_GRANT_SCOPE_MASK

export const SOUL_GRANT_SCOPE_BITS: ReadonlyArray<{ mask: number; scope: SoulGrantScope }> = [
  { mask: SOUL_GRANT_SCOPE_SEAL, scope: 'seal' },
  { mask: SOUL_GRANT_SCOPE_MEMORY, scope: 'memory' },
  { mask: SOUL_GRANT_SCOPE_SKILLS, scope: 'skills' },
  { mask: SOUL_GRANT_SCOPE_ASSETS, scope: 'assets' },
]
