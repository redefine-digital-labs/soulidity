import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readText(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('desktop install command contract', () => {
  it('adds a dedicated Rust install module plus checksum support for persona downloads', () => {
    const cargoToml = readText('desktop/src-tauri/Cargo.toml')

    expect(existsSync(resolve(process.cwd(), 'desktop/src-tauri/src/persona_install.rs'))).toBe(true)
    expect(cargoToml).toContain('sha2')
  })

  it('registers install and active-persona persistence commands in the Tauri shell', () => {
    const tauriLib = readText('desktop/src-tauri/src/lib.rs')

    expect(tauriLib).toContain('install_persona')
    expect(tauriLib).toContain('load_installed_personas')
    expect(tauriLib).toContain('load_active_persona')
    expect(tauriLib).toContain('set_active_persona')
  })
})
