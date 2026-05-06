import 'dotenv/config'

import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { getJsonRpcFullnodeUrl, SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { WalrusClient, blobIdFromInt } from '@mysten/walrus'
import {
  createInMemoryTokenUsageGuard,
  createWalrusUploaderHandler,
  type ManagedWalrusClient,
  type RegisterValidationParams,
  type TokenUsageGuard,
} from './handler.js'
import { createFilesystemWalrusUploadStaging, type WalrusUploadStaging } from './staging.js'

const WALRUS_STORAGE_NODE_REQUEST_TIMEOUT_MS = 60_000

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function getNetwork(): 'testnet' | 'mainnet' {
  return process.env.NEXT_PUBLIC_SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
}

function getSuiClient(network: 'testnet' | 'mainnet') {
  return new SuiJsonRpcClient({
    network,
    url: process.env.SUI_FULLNODE_URL?.trim() || getJsonRpcFullnodeUrl(network),
  })
}

async function createWalrusClient(network: 'testnet' | 'mainnet') {
  return new WalrusClient({
    suiClient: getSuiClient(network),
    network,
    storageNodeClientOptions: {
      timeout: WALRUS_STORAGE_NODE_REQUEST_TIMEOUT_MS,
      onError: (error: unknown) => {
        console.warn(
          '[walrus-uploader] storage node request failed:',
          error instanceof Error ? error.message : error,
        )
      },
    },
  }) as unknown as ManagedWalrusClient
}

async function validateRegister(params: RegisterValidationParams) {
  const suiClient = getSuiClient(params.network)
  const walrusClient = await createWalrusClient(params.network) as unknown as {
    getBlobType: () => string | Promise<string>
    getBlobObject: (id: string) => Promise<{ id: string; blob_id: string; deletable?: boolean }>
  }
  await suiClient.waitForTransaction({ digest: params.digest })
  const tx = await suiClient.getTransactionBlock({
    digest: params.digest,
    options: { showObjectChanges: true, showEffects: true, showInput: true },
  })
  if (tx.effects?.status?.status !== 'success') {
    throw Object.assign(new Error(`Register transaction did not succeed. Digest: ${params.digest}`), { status: 422 })
  }
  const sender = tx.transaction?.data.sender
  if (!sender || sender.toLowerCase() !== params.walletAddress.toLowerCase()) {
    throw Object.assign(new Error('Register transaction sender does not match uploader token wallet'), { status: 403 })
  }

  const expectedBlobType = await walrusClient.getBlobType()
  const created = new Set<string>()
  for (const change of tx.objectChanges ?? []) {
    if (
      change.type === 'created'
      && change.objectType === expectedBlobType
      && typeof change.objectId === 'string'
    ) {
      created.add(change.objectId)
    }
  }

  for (const expected of params.expected) {
    if (!created.has(expected.blobObjectId)) {
      throw Object.assign(
        new Error(`Register transaction did not create Blob object ${expected.blobObjectId}`),
        { status: 422 },
      )
    }
    const blob = await walrusClient.getBlobObject(expected.blobObjectId)
    if (blob.id.toLowerCase() !== expected.blobObjectId.toLowerCase()) {
      throw Object.assign(new Error(`Walrus Blob object ${expected.blobObjectId} resolved unexpectedly`), { status: 422 })
    }
    const actualBlobId = blobIdFromInt(BigInt(blob.blob_id))
    if (actualBlobId !== expected.blobId) {
      throw Object.assign(
        new Error(`Walrus Blob object ${expected.blobObjectId} does not match expected blobId ${expected.blobId}`),
        { status: 422 },
      )
    }
    if (blob.deletable !== true) {
      throw Object.assign(new Error(`Walrus Blob object ${expected.blobObjectId} is not deletable`), { status: 422 })
    }
  }
  return params.expected
}

async function createStaging(): Promise<WalrusUploadStaging> {
  const backend = process.env.STAGING_BACKEND ?? 'filesystem'
  if (backend === 'filesystem') {
    return createFilesystemWalrusUploadStaging(process.env.UPLOAD_DATA_DIR ?? '/data/walrus-uploader')
  }
  if (backend === 'gcs') {
    const { createGcsWalrusUploadStaging } = await import('./staging-gcs.js')
    return createGcsWalrusUploadStaging(requiredEnv('GCS_BUCKET'), process.env.GCS_PREFIX ?? 'walrus-uploader')
  }
  if (backend === 'r2') {
    const { createR2WalrusUploadStaging } = await import('./staging-r2.js')
    return createR2WalrusUploadStaging({
      accountId: requiredEnv('R2_ACCOUNT_ID'),
      bucket: requiredEnv('R2_BUCKET'),
      accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
      prefix: process.env.R2_PREFIX ?? 'walrus-uploader',
    })
  }
  throw new Error(`Unsupported STAGING_BACKEND: ${backend}`)
}

// Token usage state must be shared across every Cloud Run instance behind the
// same uploader, otherwise a single bearer token's documented byte/file budget
// is multiplied by warm-instance count. We follow the staging backend choice:
// the GCS backend uses a per-`jti` GCS object and `if-generation-match` for
// atomic CAS; filesystem/in-memory deploys keep the in-process map (assumes
// single-instance deployment).
async function createTokenUsageGuard(nowMs: () => number): Promise<TokenUsageGuard> {
  const backend = process.env.STAGING_BACKEND ?? 'filesystem'
  if (backend === 'gcs') {
    const { createGcsTokenUsageGuard } = await import('./token-usage-gcs.js')
    return createGcsTokenUsageGuard({
      bucketName: requiredEnv('GCS_BUCKET'),
      prefix: process.env.GCS_TOKEN_USAGE_PREFIX ?? `${process.env.GCS_PREFIX ?? 'walrus-uploader'}/token-usage`,
      nowMs,
    })
  }
  if (backend === 'r2') {
    const { createR2TokenUsageGuard } = await import('./token-usage-r2.js')
    return createR2TokenUsageGuard({
      accountId: requiredEnv('R2_ACCOUNT_ID'),
      bucket: requiredEnv('R2_BUCKET'),
      accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
      prefix: process.env.R2_TOKEN_USAGE_PREFIX ?? `${process.env.R2_PREFIX ?? 'walrus-uploader'}/token-usage`,
      nowMs,
    })
  }
  return createInMemoryTokenUsageGuard({ nowMs })
}

const network = getNetwork()
const port = Number(process.env.PORT ?? 8080)
const nowMs = () => Date.now()
const staging = await createStaging()
const tokenUsage = await createTokenUsageGuard(nowMs)
const handler = createWalrusUploaderHandler({
  tokenSecret: requiredEnv('WALRUS_UPLOADER_TOKEN_SECRET'),
  staging,
  createWalrusClient,
  validateRegister,
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  stageTtlMs: Number(process.env.UPLOAD_STAGE_TTL_MS ?? '') || undefined,
  nowMs,
  tokenUsage,
})

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? `localhost:${port}`
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item)
      } else if (value != null) {
        headers.set(key, value)
      }
    }
    const request = new Request(`http://${host}${req.url ?? '/'}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Readable.toWeb(req) as never,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    const response = await handler(request)
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`walrus-uploader listening on :${port} (${network})`)
})
