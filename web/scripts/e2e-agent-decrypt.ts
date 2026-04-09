/**
 * E2E Test: Agent Seal Decrypt Round-Trip
 *
 * 1. Call GET /api/agent/souls/{id}/access → blob URL, accessPolicy, seal config
 * 2. Download encrypted blob from Walrus
 * 3. Create SealClient + SessionKey (agent Ed25519 keypair)
 * 4. Read document ID + encrypted DEK from sealSidecar
 * 5. Build seal_approve TX
 * 6. Run envelope decrypt (Seal decrypts the DEK, AES-GCM decrypts the Walrus blob)
 * 7. SHA-256 compare decrypted content with sealSidecar.contentHash
 *
 * Usage:
 *   AGENT_MNEMONIC="..." AGENT_API_KEY="sk-..." SOUL_ID="..." \
 *   npx tsx scripts/e2e-agent-decrypt.ts
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { SealClient, SessionKey } from '@mysten/seal'
import {
  buildSealApprovalTxBytes,
  decryptBundle,
  parseSealEnvelopeSidecar,
} from '@web/lib/services/seal-crypto'
import { createHash } from 'node:crypto'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const AGENT_MNEMONIC = process.env.AGENT_MNEMONIC!
const AGENT_API_KEY = process.env.AGENT_API_KEY!
const SOUL_ID = process.env.SOUL_ID!

const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' })

async function main() {
  if (!AGENT_MNEMONIC || !AGENT_API_KEY || !SOUL_ID) {
    console.error('Usage: AGENT_MNEMONIC=... AGENT_API_KEY=... SOUL_ID=... npx tsx scripts/e2e-agent-decrypt.ts')
    process.exit(1)
  }

  const keypair = Ed25519Keypair.deriveKeypair(AGENT_MNEMONIC)
  const agentAddress = keypair.toSuiAddress()
  console.log(`Agent address: ${agentAddress}`)

  // Step 1: Get access info
  console.log('\n--- Step 1: Get access info ---')
  const accessRes = await fetch(`${BASE_URL}/api/agent/souls/${SOUL_ID}/access`, {
    headers: {
      'Authorization': `Bearer ${AGENT_API_KEY}`,
      'x-forwarded-for': '127.0.0.1',
    },
  })

  if (!accessRes.ok) {
    const err = await accessRes.json().catch(() => ({}))
    throw new Error(`Access failed (${accessRes.status}): ${JSON.stringify(err)}`)
  }

  const access = await accessRes.json()
  const sealSidecar = parseSealEnvelopeSidecar(access.sealSidecar)
  console.log(`Blob URL: ${access.artifact.walrusBlobUrl}`)
  console.log(`Content hash: ${sealSidecar.contentHash}`)
  console.log(`Policy: ${access.accessPolicy.functionName}`)

  // Step 2: Download encrypted blob
  console.log('\n--- Step 2: Download encrypted blob ---')
  const blobRes = await fetch(access.artifact.walrusBlobUrl)
  if (!blobRes.ok) {
    throw new Error(`Blob download failed: ${blobRes.status}`)
  }
  const encryptedBytes = new Uint8Array(await blobRes.arrayBuffer())
  console.log(`Downloaded ${encryptedBytes.length} bytes`)

  // Step 3: Create SealClient + SessionKey
  console.log('\n--- Step 3: Create Seal session ---')
  const sealClient = new SealClient({
    suiClient,
    serverConfigs: access.seal.serverConfigs,
    verifyKeyServers: access.seal.verifyKeyServers,
  })

  const packageId = access.accessPolicy.packageId
  const sessionKey = await SessionKey.create({
    address: agentAddress,
    packageId,
    ttlMin: 10,
    suiClient,
  })

  const personalMsg = sessionKey.getPersonalMessage()
  const { signature: personalMsgSig } = await keypair.signPersonalMessage(personalMsg)
  await sessionKey.setPersonalMessageSignature(personalMsgSig)
  console.log('Session key created and signed')

  // Step 4: Read envelope metadata from sidecar
  console.log('\n--- Step 4: Read envelope sidecar ---')
  console.log(`Document ID: ${sealSidecar.documentId.slice(0, 40)}...`)
  console.log(`Encrypted DEK size: ${Buffer.from(sealSidecar.encryptedDek, 'base64').length} bytes`)

  // Step 5: Build approval TX
  console.log('\n--- Step 5: Build approval TX ---')
  const {
    functionName,
    soulObjectId,
    currentKioskId,
    currentKioskCapOnChainId,
    allowlistRegistryObjectId,
    soulAllowlistCapObjectId,
  } = access.accessPolicy

  if (functionName === 'seal_approve_owner_in_personal_kiosk') {
    if (!currentKioskId || !currentKioskCapOnChainId) {
      throw new Error('owner Seal approval requires currentKioskId and currentKioskCapOnChainId')
    }
  } else {
    if (functionName !== 'seal_approve_allowlisted') {
      throw new Error(`Unexpected Seal approval function: ${functionName}`)
    }
    if (!allowlistRegistryObjectId || !soulAllowlistCapObjectId) {
      throw new Error('allowlisted Seal approval requires allowlistRegistryObjectId and soulAllowlistCapObjectId')
    }
  }

  const txBytes = await buildSealApprovalTxBytes({
    accessPolicy: access.accessPolicy,
    documentId: sealSidecar.documentId,
    soulAllowlistCapObjectId,
  })
  console.log(`TX bytes: ${txBytes.length} bytes`)

  // Step 6: Envelope decrypt
  console.log('\n--- Step 6: Envelope decrypt ---')
  try {
    const decryptedData = await decryptBundle({
      sealClient,
      sessionKey: sessionKey as never,
      txBytes,
      encryptedData: encryptedBytes,
      sidecar: sealSidecar,
      expectedSoulObjectId: soulObjectId,
    })

    console.log(`Decrypted ${decryptedData.length} bytes`)

    // Step 7: Verify content hash
    console.log('\n--- Step 7: Verify content hash ---')
    const hash = createHash('sha256').update(decryptedData).digest('hex')
    const expectedHash = sealSidecar.contentHash.replace(/^0x/, '')
    console.log(`Computed: ${hash}`)
    console.log(`Expected: ${expectedHash}`)

    if (hash === expectedHash) {
      console.log('\n✅ Seal decrypt round-trip verified! Content hash matches.')
    } else {
      console.log('\n❌ Content hash MISMATCH!')
      process.exit(1)
    }
  } catch (err) {
    console.error('\n❌ Decryption failed:', err instanceof Error ? err.message : err)
    console.log('\nExpected runtime contract: Walrus stores AES-GCM ciphertext, while Seal only encrypts the DEK inside sealSidecar.encryptedDek.')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
