/**
 * E2E Test: Agent Claim Flow
 *
 * Claims a pending agent using a Privy auth token.
 *
 * Usage: PRIVY_TOKEN=... AGENT_ID=... CLAIM_TOKEN=... npx tsx scripts/e2e-agent-claim.ts
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const PRIVY_TOKEN = process.env.PRIVY_TOKEN
const AGENT_ID = process.env.AGENT_ID
const CLAIM_TOKEN = process.env.CLAIM_TOKEN

async function main() {
  if (!PRIVY_TOKEN || !AGENT_ID || !CLAIM_TOKEN) {
    console.error('Usage: PRIVY_TOKEN=... AGENT_ID=... CLAIM_TOKEN=... npx tsx scripts/e2e-agent-claim.ts')
    process.exit(1)
  }

  // Step 1: Verify agent info (GET)
  console.log('--- Step 1: Verify pending agent ---')
  const infoRes = await fetch(
    `${BASE_URL}/api/agent-join/claim?id=${AGENT_ID}&token=${CLAIM_TOKEN}`,
    { headers: { 'x-forwarded-for': '127.0.0.1' } },
  )
  const infoBody = await infoRes.json()
  console.log(`Status: ${infoRes.status}`)
  console.log(`Agent:`, JSON.stringify(infoBody, null, 2))

  if (!infoRes.ok) {
    throw new Error(`Failed to fetch agent info: ${infoRes.status}`)
  }

  // Step 2: Claim agent (POST with Privy auth)
  console.log('\n--- Step 2: Claim agent ---')
  const claimRes = await fetch(`${BASE_URL}/api/agent-join/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PRIVY_TOKEN}`,
      'x-forwarded-for': '127.0.0.1',
    },
    body: JSON.stringify({ id: AGENT_ID, token: CLAIM_TOKEN }),
  })

  const claimBody = await claimRes.json()
  console.log(`Status: ${claimRes.status}`)
  console.log(`Response:`, JSON.stringify(claimBody, null, 2))

  if (claimRes.ok && claimBody.apiKey) {
    console.log('\n✅ Agent claimed successfully!')
    console.log(`API Key: ${claimBody.apiKey}`)
    console.log('\nSave this API key — it will NOT be shown again.')
  } else {
    console.log('\n❌ Claim failed')
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
