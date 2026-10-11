import withBundleAnalyzer from '@next/bundle-analyzer'
import dotenv from 'dotenv'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const __repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(__repoRoot, '.env') })
if (process.env.CLAWNEWS_LOAD_ENV_LOCAL !== 'false') {
  dotenv.config({ path: path.join(__repoRoot, '.env.local'), override: true })
}

import type { NextConfig } from 'next'

const appRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(appRoot, '..')

function readWalrusWasmVersion(): string {
  const pkgJson = path.join(appRoot, 'node_modules', '@mysten', 'walrus-wasm', 'package.json')
  if (!existsSync(pkgJson)) return ''
  try {
    const parsed = JSON.parse(readFileSync(pkgJson, 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : ''
  } catch {
    return ''
  }
}

const walrusWasmVersion = readWalrusWasmVersion()

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ['@prisma/client', '@mysten/walrus', '@mysten/walrus-wasm'],
  transpilePackages: ['@soulidity/sdk'],
  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? { exclude: ['error', 'warn'] }
        : false,
  },
  env: {
    NEXT_PUBLIC_WALRUS_WASM_VERSION: walrusWasmVersion,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() || '',
    NEXT_PUBLIC_POSTHOG_HOST:
      process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || '/ingest',
  },
  turbopack: {
    root: repoRoot,
  },
  webpack(config) {
    // Privy eagerly resolves this optional Farcaster peer during build.
    config.resolve ??= {}
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@farcaster/mini-app-solana': false,
    }
    return config
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
  async rewrites() {
    return [
      { source: '/ingest/static/:path*', destination: 'https://us-assets.i.posthog.com/static/:path*' },
      { source: '/ingest/:path*', destination: 'https://us.i.posthog.com/:path*' },
      { source: '/ingest/decide', destination: 'https://us.i.posthog.com/decide' },
    ]
  },
  skipTrailingSlashRedirect: true,
}

const bundleAnalyzer = withBundleAnalyzer({ enabled: process.env.ANALYZE === 'true' })

export default bundleAnalyzer(nextConfig)
