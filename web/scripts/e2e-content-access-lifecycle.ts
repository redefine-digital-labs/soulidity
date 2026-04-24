/**
 * E2E helper for ContentAccessList owner-side lifecycle checks.
 *
 * Owner actions are signed locally with a Sui key owned by the current Soul owner
 * (for the main plan this is Agent Alpha after buying Soul B).
 *
 * Usage:
 *   OWNER_PRIVATE_KEY="suiprivkey1..." \
 *   ACCESS_LIST_ID="0x..." STATE_ID="0x..." \
 *   PRICE_ATOMIC=1000000 DURATION_MS=2000 \
 *   npx tsx web/scripts/e2e-content-access-lifecycle.ts set-initial
 *
 *   GRANTEE_ADDRESS="0x..." REQUIRED_SCOPE=15 \
 *   npx tsx web/scripts/e2e-content-access-lifecycle.ts inspect-access
 */

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'

const SUI_CLOCK_OBJECT_ID = '0x6'
const SUI_NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK || 'testnet') as 'mainnet' | 'testnet' | 'devnet'
const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(SUI_NETWORK), network: SUI_NETWORK })
const scriptDir = dirname(fileURLToPath(import.meta.url))

type SoulidityPublicEnvName = 'NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'

function getRequiredSoulidityEnv(name: SoulidityPublicEnvName) {
  if (name !== 'NEXT_PUBLIC_SOULIDITY_PACKAGE_ID') {
    throw new Error(`Unsupported Soulidity env in lifecycle helper: ${name}`)
  }
  const manifestPath = join(scriptDir, '../lib/soulidity/deployment-manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, { packageId?: string }>
  const value = process.env[name]?.trim() || manifest[SUI_NETWORK]?.packageId?.trim()
  if (!value) throw new Error(`Missing required Soulidity env: ${name}`)
  return value
}

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value?.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

function parseU64Env(name: string) {
  const value = requireEnv(name)
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an unsigned integer`)
  return BigInt(value)
}

function keypairFromEnv() {
  const privateKey = process.env.OWNER_PRIVATE_KEY
  const mnemonic = process.env.OWNER_MNEMONIC
  if (privateKey?.trim()) {
    return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(privateKey.trim()).secretKey)
  }
  if (mnemonic?.trim()) {
    return Ed25519Keypair.deriveKeypair(mnemonic.trim())
  }
  throw new Error('OWNER_PRIVATE_KEY or OWNER_MNEMONIC is required for owner-signed actions')
}

function buildOwnerTx(action: 'set-initial' | 'set-price' | 'set-duration') {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const accessListId = requireEnv('ACCESS_LIST_ID')
  const stateId = requireEnv('STATE_ID')
  const tx = new Transaction()

  if (action === 'set-initial' || action === 'set-price') {
    tx.moveCall({
      target: `${packageId}::content_access::set_content_price`,
      arguments: [
        tx.object(accessListId),
        tx.object(stateId),
        tx.pure.u64(parseU64Env('PRICE_ATOMIC')),
      ],
    })
  }

  if (action === 'set-initial' || action === 'set-duration') {
    const duration = process.env.DURATION_MS?.trim()
    tx.moveCall({
      target: `${packageId}::content_access::set_content_access_duration`,
      arguments: [
        tx.object(accessListId),
        tx.object(stateId),
        tx.pure.option('u64', duration ? BigInt(duration) : null),
      ],
    })
  }

  return tx
}

async function signAndExecuteOwnerTx(action: 'set-initial' | 'set-price' | 'set-duration') {
  const keypair = keypairFromEnv()
  const ownerAddress = normalizeSuiAddress(keypair.toSuiAddress())
  const tx = buildOwnerTx(action)
  tx.setSender(ownerAddress)
  const rawBytes = await tx.build({ client: suiClient })
  const { signature } = await keypair.signTransaction(rawBytes)
  const result = await suiClient.executeTransactionBlock({
    transactionBlock: Buffer.from(rawBytes).toString('base64'),
    signature,
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
  })
  await suiClient.waitForTransaction({ digest: result.digest }).catch(() => undefined)
  console.log(JSON.stringify({
    action,
    ownerAddress,
    digest: result.digest,
    status: result.effects?.status,
    events: result.events?.map((event: { type?: string; parsedJson?: unknown }) => ({
      type: event.type,
      parsedJson: event.parsedJson,
    })),
  }, null, 2))
}

function parseDevInspectBool(response: unknown): boolean | null {
  const effects = (response as { results?: Array<{ returnValues?: unknown[] }> }).results ?? []
  const returnValue = effects.flatMap((item) => item.returnValues ?? [])[0]
  if (!Array.isArray(returnValue) || !Array.isArray(returnValue[0])) return null
  const firstByte = returnValue[0][0]
  if (firstByte === 0) return false
  if (firstByte === 1) return true
  return null
}

export function buildInspectAccessTx(params: {
  packageId: string
  accessListId: string
  stateId: string
  granteeAddress: string
  requiredScope: number | bigint
}) {
  const tx = new Transaction()
  tx.moveCall({
    target: `${params.packageId}::content_access::has_access`,
    arguments: [
      tx.object(params.accessListId),
      tx.object(params.stateId),
      tx.pure.address(params.granteeAddress),
      tx.pure.u64(params.requiredScope),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
  return tx
}

async function inspectAccess() {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const accessListId = requireEnv('ACCESS_LIST_ID')
  const stateId = requireEnv('STATE_ID')
  const granteeAddress = requireEnv('GRANTEE_ADDRESS')
  const requiredScope = Number(parseU64Env('REQUIRED_SCOPE'))
  const sender = process.env.INSPECT_SENDER?.trim() || granteeAddress
  const tx = buildInspectAccessTx({ packageId, accessListId, stateId, granteeAddress, requiredScope })
  const result = await suiClient.devInspectTransactionBlock({ sender, transactionBlock: tx })
  const hasAccess = parseDevInspectBool(result)
  console.log(JSON.stringify({
    action: 'inspect-access',
    accessListId,
    granteeAddress,
    requiredScope,
    hasAccess,
    effects: result.effects?.status,
  }, null, 2))
  if (hasAccess == null) {
    console.error(JSON.stringify(result, null, 2))
    process.exit(1)
  }
}

export async function main() {
  const action = process.argv[2]
  if (action === 'set-initial' || action === 'set-price' || action === 'set-duration') {
    await signAndExecuteOwnerTx(action)
    return
  }
  if (action === 'inspect-access') {
    await inspectAccess()
    return
  }
  throw new Error('Usage: e2e-content-access-lifecycle.ts set-initial|set-price|set-duration|inspect-access')
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Fatal:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
