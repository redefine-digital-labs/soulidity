import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  deserializeWalrusTransportValue,
  serializeWalrusTransportValue,
  type WalrusCertificateLike,
} from './codec.js'

export interface StagedWalrusUpload {
  uploadId: string
  walletAddress: string
  network: 'testnet' | 'mainnet'
  blobId: string
  rootHash: Uint8Array
  size: number
  metadata: unknown
  sliversByNode: unknown
  certificate: WalrusCertificateLike | null
  createdAt: number
  expiresAt: number
  tokenId: string
}

export interface WalrusUploadStaging {
  put(upload: StagedWalrusUpload): Promise<void>
  get(uploadId: string): Promise<StagedWalrusUpload | null>
  delete(uploadId: string): Promise<void>
  deleteExpired(nowMs: number): Promise<number>
}

function serializeStagedUpload(upload: StagedWalrusUpload) {
  return {
    ...upload,
    rootHash: Buffer.from(upload.rootHash).toString('base64'),
    metadata: serializeWalrusTransportValue(upload.metadata),
    sliversByNode: serializeWalrusTransportValue(upload.sliversByNode),
    certificate: upload.certificate
      ? {
          signers: upload.certificate.signers,
          serializedMessage: Buffer.from(upload.certificate.serializedMessage).toString('base64'),
          signature: Buffer.from(upload.certificate.signature).toString('base64'),
        }
      : null,
  }
}

function deserializeStagedUpload(value: unknown): StagedWalrusUpload | null {
  if (!value || typeof value !== 'object') return null
  const c = value as Record<string, unknown>
  if (
    typeof c.uploadId !== 'string'
    || typeof c.walletAddress !== 'string'
    || (c.network !== 'testnet' && c.network !== 'mainnet')
    || typeof c.blobId !== 'string'
    || typeof c.rootHash !== 'string'
    || typeof c.size !== 'number'
    || typeof c.createdAt !== 'number'
    || typeof c.expiresAt !== 'number'
    || typeof c.tokenId !== 'string'
  ) {
    return null
  }
  const cert = c.certificate as Record<string, unknown> | null
  return {
    uploadId: c.uploadId,
    walletAddress: c.walletAddress,
    network: c.network,
    blobId: c.blobId,
    rootHash: new Uint8Array(Buffer.from(c.rootHash, 'base64')),
    size: c.size,
    metadata: deserializeWalrusTransportValue(c.metadata as never),
    sliversByNode: deserializeWalrusTransportValue(c.sliversByNode as never),
    certificate: cert
      ? {
          signers: Array.isArray(cert.signers) ? cert.signers.filter(Number.isInteger) as number[] : [],
          serializedMessage: new Uint8Array(Buffer.from(String(cert.serializedMessage ?? ''), 'base64')),
          signature: new Uint8Array(Buffer.from(String(cert.signature ?? ''), 'base64')),
        }
      : null,
    createdAt: c.createdAt,
    expiresAt: c.expiresAt,
    tokenId: c.tokenId,
  }
}

export function createMemoryWalrusUploadStaging(): WalrusUploadStaging {
  const uploads = new Map<string, StagedWalrusUpload>()
  return {
    async put(upload) {
      uploads.set(upload.uploadId, upload)
    },
    async get(uploadId) {
      return uploads.get(uploadId) ?? null
    },
    async delete(uploadId) {
      uploads.delete(uploadId)
    },
    async deleteExpired(nowMs) {
      let deleted = 0
      for (const [uploadId, upload] of uploads) {
        if (upload.expiresAt <= nowMs) {
          uploads.delete(uploadId)
          deleted += 1
        }
      }
      return deleted
    },
  }
}

export function createFilesystemWalrusUploadStaging(dataDir: string): WalrusUploadStaging {
  const uploadDir = join(dataDir, 'uploads')
  const pathFor = (uploadId: string) => join(uploadDir, `${encodeURIComponent(uploadId)}.json`)
  return {
    async put(upload) {
      await mkdir(uploadDir, { recursive: true })
      await writeFile(pathFor(upload.uploadId), JSON.stringify(serializeStagedUpload(upload)), 'utf8')
    },
    async get(uploadId) {
      try {
        const parsed = JSON.parse(await readFile(pathFor(uploadId), 'utf8')) as unknown
        return deserializeStagedUpload(parsed)
      } catch {
        return null
      }
    },
    async delete(uploadId) {
      await rm(pathFor(uploadId), { force: true })
    },
    async deleteExpired(nowMs) {
      await mkdir(uploadDir, { recursive: true })
      let deleted = 0
      for (const fileName of await readdir(uploadDir)) {
        if (!fileName.endsWith('.json')) continue
        const uploadId = decodeURIComponent(fileName.slice(0, -'.json'.length))
        const upload = await this.get(uploadId)
        if (upload && upload.expiresAt <= nowMs) {
          await this.delete(uploadId)
          deleted += 1
        }
      }
      return deleted
    },
  }
}
