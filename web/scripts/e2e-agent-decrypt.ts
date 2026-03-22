/**
 * E2E Test: Agent Seal Decrypt Round-Trip
 *
 * 1. Call GET /api/agent/souls/{id}/access → blob URL, accessPolicy, seal config
 * 2. Download encrypted blob from Walrus
 * 3. Create SealClient + SessionKey (agent Ed25519 keypair)
 * 4. Parse encrypted blob → extract document ID
 * 5. Build seal_approve TX → SealClient.decrypt
 * 6. SHA-256 compare decrypted content with contentHash
 *
 * Usage:
 *   AGENT_MNEMONIC="..." AGENT_API_KEY="sk-..." SOUL_ID="..." \
 *   npx tsx scripts/e2e-agent-decrypt.ts
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { SealClient, SessionKey, EncryptedObject } from '@mysten/seal'
import { Transaction } from '@mysten/sui/transactions'
import { fromHex, toHex } from '@mysten/sui/utils'
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
  console.log(`Pass type: ${access.passType}`)
  console.log(`Blob URL: ${access.artifact.walrusBlobUrl}`)
  console.log(`Content hash: ${access.artifact.contentHash}`)
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

  // Step 4: Parse encrypted blob to extract document ID
  console.log('\n--- Step 4: Parse encrypted object ---')
  let parsedEncrypted: ReturnType<typeof EncryptedObject.parse>
  try {
    parsedEncrypted = EncryptedObject.parse(encryptedBytes)
  } catch {
    console.error('Failed to parse as Seal encrypted object — blob is not Seal-encrypted.')
    console.log('To test, publish a new Soul through the updated publish page with Seal encryption.')
    process.exit(1)
  }
  // EncryptedObject.parse().id is already a hex string (BCS transform applies toHex)
  const documentId = typeof parsedEncrypted.id === 'string'
    ? parsedEncrypted.id
    : toHex(new Uint8Array(parsedEncrypted.id))
  console.log(`Document ID: ${documentId.slice(0, 40)}...`)
  console.log(`Threshold: ${parsedEncrypted.threshold}`)

  // Step 5: Build approval TX and decrypt
  console.log('\n--- Step 5: Build approval TX ---')
  const { functionName, seriesObjectId, passObjectId, releaseObjectId, clockObjectId } = access.accessPolicy

  const tx = new Transaction()
  if (functionName === 'seal_approve_perpetual') {
    tx.moveCall({
      target: `${packageId}::seal_policy::${functionName}`,
      arguments: [
        tx.pure.vector('u8', Array.from(fromHex(documentId))),
        tx.object(passObjectId),
        tx.object(releaseObjectId),
        tx.object(seriesObjectId),
      ],
    })
  } else {
    // seal_approve_subscription
    tx.moveCall({
      target: `${packageId}::seal_policy::${functionName}`,
      arguments: [
        tx.pure.vector('u8', Array.from(fromHex(documentId))),
        tx.object(passObjectId),
        tx.object(seriesObjectId),
        tx.object(clockObjectId ?? '0x6'),
      ],
    })
  }

  const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true })
  console.log(`TX bytes: ${txBytes.length} bytes`)

  // Step 6: Decrypt
  console.log('\n--- Step 6: Decrypt ---')
  try {
    const decryptedData = await sealClient.decrypt({
      data: encryptedBytes,
      sessionKey,
      txBytes,
    })

    console.log(`Decrypted ${decryptedData.length} bytes`)

    // Step 7: Verify content hash
    console.log('\n--- Step 7: Verify content hash ---')
    const hash = createHash('sha256').update(decryptedData).digest('hex')
    const expectedHash = access.artifact.contentHash.replace(/^0x/, '')
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
    console.log('\nThis is expected if the blob was NOT encrypted with SealClient.encrypt().')
    console.log('To test, publish a new Soul through the updated publish page (with Seal encryption).')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
