import 'dotenv/config'

import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { WalrusClient, blobIdFromInt } from '@mysten/walrus'
import {
  createInMemoryTokenUsageGuard,
  createWalrusUploaderHandler,
  type ManagedWalrusClient,
  type RegisterValidationParams,
} from './handler.js'
import { createFilesystemWalrusUploadStaging } from './staging.js'

const WALRUS_STORAGE_NODE_REQUEST_TIMEOUT_MS = 10 * 60 * 1000
const SUI_GRPC_FULLNODE_URL = {
  mainnet: 'https://fullnode.mainnet.sui.io:443',
  testnet: 'https://fullnode.testnet.sui.io:443',
} as const

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function getNetwork(): 'testnet' | 'mainnet' {
  return process.env.NEXT_PUBLIC_SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
}

function getSuiClient(network: 'testnet' | 'mainnet') {
  return new SuiGrpcClient({
    network,
    baseUrl:
      process.env.SUI_GRPC_URL?.trim()
      || process.env.SUI_FULLNODE_URL?.trim()
      || SUI_GRPC_FULLNODE_URL[network],
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
  const response = await suiClient.core.waitForTransaction({
    digest: params.digest,
    include: {
      effects: true,
      transaction: true,
      objectTypes: true,
    },
  })
  const tx = response.Transaction ?? response.FailedTransaction
  if (!tx) {
    throw Object.assign(new Error(`Sui returned no transaction payload. Digest: ${params.digest}`), { status: 502 })
  }
  const executionStatus = tx.effects?.status ?? tx.status
  if (!executionStatus.success) {
    throw Object.assign(new Error(`Register transaction did not succeed. Digest: ${params.digest}`), { status: 422 })
  }
  const sender = tx.transaction?.sender
  if (!sender || sender.toLowerCase() !== params.walletAddress.toLowerCase()) {
    throw Object.assign(new Error('Register transaction sender does not match uploader token wallet'), { status: 403 })
  }

  const expectedBlobType = await walrusClient.getBlobType()
  const created = new Set<string>()
  for (const change of tx.effects?.changedObjects ?? []) {
    if (
      change.idOperation === 'Created'
      && change.outputState !== 'DoesNotExist'
      && tx.objectTypes?.[change.objectId] === expectedBlobType
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

function assertDigitalOceanFilesystemMode() {
  const backend = process.env.STAGING_BACKEND?.trim()
  if (backend && backend !== 'filesystem') {
    throw new Error('Only STAGING_BACKEND=filesystem is supported for the DigitalOcean uploader')
  }
}

const network = getNetwork()
const port = Number(process.env.PORT ?? 8080)
const nowMs = () => Date.now()
assertDigitalOceanFilesystemMode()
const staging = createFilesystemWalrusUploadStaging(process.env.UPLOAD_DATA_DIR ?? '/data/walrus-uploader')
const tokenUsage = createInMemoryTokenUsageGuard({ nowMs })
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
