#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(HERE, '..')

const WASM_PKG = join(WEB_ROOT, 'node_modules', '@mysten', 'walrus-wasm')
const WASM_SRC = join(WASM_PKG, 'web', 'walrus_wasm_bg.wasm')
const PKG_JSON = join(WASM_PKG, 'package.json')
const PUBLIC_DIR = join(WEB_ROOT, 'public', 'walrus')

if (!existsSync(WASM_SRC) || !existsSync(PKG_JSON)) {
  console.warn(`[copy-walrus-wasm] Skipping: @mysten/walrus-wasm not installed at ${WASM_PKG}`)
  process.exit(0)
}

const version = JSON.parse(readFileSync(PKG_JSON, 'utf8')).version
if (typeof version !== 'string' || version.length === 0) {
  throw new Error(`[copy-walrus-wasm] Could not read version from ${PKG_JSON}`)
}

mkdirSync(PUBLIC_DIR, { recursive: true })

const targetName = `walrus_wasm@${version}.wasm`
const target = join(PUBLIC_DIR, targetName)
copyFileSync(WASM_SRC, target)

// Drop any older versioned copies so the public dir tracks the installed version exactly.
for (const entry of readdirSync(PUBLIC_DIR)) {
  if (entry === targetName) continue
  if (!entry.startsWith('walrus_wasm@') || !entry.endsWith('.wasm')) continue
  const stale = join(PUBLIC_DIR, entry)
  if (statSync(stale).isFile()) rmSync(stale)
}

console.log(`[copy-walrus-wasm] Copied @mysten/walrus-wasm@${version} -> public/walrus/${targetName}`)
