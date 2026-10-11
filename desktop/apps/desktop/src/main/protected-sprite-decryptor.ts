import { createSuiGrpcCompatClient } from '@soulidity/sdk'
import {
  loadDecryptedContentVersion,
  parseContentAccessResponse,
} from '../renderer/lib/soulidity/content-access'
import { signAgentPersonalMessage } from './agent-wallet'
import { fetchWalrusArtifactBytes } from './walrus-artifact-fetcher'

export interface ProtectedSpriteDecryptResult {
  bytes: Uint8Array
  fileName: string
  mimeType: string
}

function createSuiClient(network: 'testnet' | 'mainnet') {
  return createSuiGrpcCompatClient(network)
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

export async function decryptProtectedSpritePayload(
  accessPayload: unknown,
): Promise<ProtectedSpriteDecryptResult> {
  const access = parseContentAccessResponse(accessPayload)
  const suiClient = createSuiClient(access.seal.network)
  const decrypted = await loadDecryptedContentVersion({
    access,
    suiClient,
    signPersonalMessage: async (message) => {
      const result = await signAgentPersonalMessage(message)
      return result.signature
    },
    fetchImpl: async (input) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
      const artifact = await fetchWalrusArtifactBytes(url)
      return new Response(copyBytesToArrayBuffer(artifact.bytes), {
        status: 200,
        statusText: 'OK',
        headers: artifact.contentType ? { 'Content-Type': artifact.contentType } : undefined,
      })
    },
  })

  return {
    bytes: decrypted.bytes,
    fileName: decrypted.fileName,
    mimeType: decrypted.mimeType,
  }
}
