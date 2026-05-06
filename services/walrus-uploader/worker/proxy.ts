// Cloudflare Worker that proxies all requests to a singleton Container
// instance running the existing Node.js Walrus uploader. Containers cannot
// receive direct HTTP requests on Cloudflare; a Worker (with a Durable
// Object binding) is the entry point.
//
// The Container reads its configuration from POSIX environment variables
// (same as Cloud Run), so we forward Worker secrets/vars through `envVars`
// before the container starts.

import { Container, getContainer } from '@cloudflare/containers'

export interface Env {
  WALRUS_UPLOADER: DurableObjectNamespace<WalrusUploaderContainer>
  // Secrets (`wrangler secret put`)
  WALRUS_UPLOADER_TOKEN_SECRET: string
  R2_ACCOUNT_ID: string
  R2_BUCKET: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  // Plain vars (`wrangler.jsonc` `vars`)
  NEXT_PUBLIC_SUI_NETWORK?: string
  CORS_ORIGIN?: string
  SUI_FULLNODE_URL?: string
  WALRUS_UPLOADER_TOKEN_TTL_MS?: string
  WALRUS_UPLOADER_TOKEN_MAX_FILES?: string
  WALRUS_UPLOADER_TOKEN_MAX_BYTES?: string
  R2_PREFIX?: string
  R2_TOKEN_USAGE_PREFIX?: string
}

export class WalrusUploaderContainer extends Container<Env> {
  // Container listens on $PORT=8080 (matches Dockerfile EXPOSE 8080).
  defaultPort = 8080
  // Auto-shut-down idle window. The walrus uploader is bursty (Soul creates
  // come in clumps) so 15 minutes keeps the container warm across normal
  // flows without burning CPU·s during quiet hours.
  sleepAfter = '15m'

  constructor(ctx: DurableObjectState<object>, env: Env) {
    super(ctx, env)
    // Inject Worker secrets/vars into the container's POSIX env before any
    // request arrives. The Node server reads these via `process.env.*`.
    this.envVars = {
      PORT: '8080',
      STAGING_BACKEND: 'r2',
      WALRUS_UPLOADER_TOKEN_SECRET: env.WALRUS_UPLOADER_TOKEN_SECRET,
      R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
      R2_BUCKET: env.R2_BUCKET,
      R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
      R2_PREFIX: env.R2_PREFIX ?? 'walrus-uploader',
      R2_TOKEN_USAGE_PREFIX: env.R2_TOKEN_USAGE_PREFIX ?? 'walrus-uploader/token-usage',
      NEXT_PUBLIC_SUI_NETWORK: env.NEXT_PUBLIC_SUI_NETWORK ?? 'mainnet',
      CORS_ORIGIN: env.CORS_ORIGIN ?? '*',
      ...(env.SUI_FULLNODE_URL ? { SUI_FULLNODE_URL: env.SUI_FULLNODE_URL } : {}),
      ...(env.WALRUS_UPLOADER_TOKEN_TTL_MS ? { WALRUS_UPLOADER_TOKEN_TTL_MS: env.WALRUS_UPLOADER_TOKEN_TTL_MS } : {}),
      ...(env.WALRUS_UPLOADER_TOKEN_MAX_FILES ? { WALRUS_UPLOADER_TOKEN_MAX_FILES: env.WALRUS_UPLOADER_TOKEN_MAX_FILES } : {}),
      ...(env.WALRUS_UPLOADER_TOKEN_MAX_BYTES ? { WALRUS_UPLOADER_TOKEN_MAX_BYTES: env.WALRUS_UPLOADER_TOKEN_MAX_BYTES } : {}),
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Single shared instance: token-usage CAS lives in R2 so we don't need
    // per-token DO sharding yet. If R2 412 retry rate ever climbs, switch
    // here to `getContainer(env.WALRUS_UPLOADER, hashOfBearerToken)` for
    // sticky routing per-token.
    // Single shared instance — token-usage state lives in R2 so we don't
    // need per-token DO sharding. The routing name doubles as a deployment
    // generation token: bumping it (e.g. `prod-v2`) forces requests onto a
    // fresh Container instance, which is the only way to roll forward
    // injected secrets that warm-but-stale instances kept from start.
    const container = getContainer(env.WALRUS_UPLOADER, 'prod-v3')
    return container.fetch(request)
  },
}
