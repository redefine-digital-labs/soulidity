/**
 * Idempotent env-driven setup for the two E2E agent identities.
 *
 * Reads:
 *   E2E_AGENT_ALPHA_PRIVATE_KEY / E2E_AGENT_ALPHA_API_KEY
 *   E2E_AGENT_BETA_PRIVATE_KEY  / E2E_AGENT_BETA_API_KEY
 *
 * For each agent, ensures:
 *   - Account row keyed by walletAddress
 *   - Member row attached to that account, kind='agent', agentStatus='active',
 *     apiKeyHash = sha256(apiKey), apiKey cleared
 *   - WalletBinding (chain='sui', address=derived) tied to the member
 *
 * Safe to re-run; updates only the fields that drift.
 */
import "./lib/dotenv";
import { PrismaClient } from "../src/db/prisma-client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHash } from "node:crypto";
import { loadKeypairFromEnv } from "./lib/keypair";

type AgentSpec = {
  label: string;
  privateKeyEnv: string;
  apiKeyEnv: string;
  handle: string;
  displayName: string;
};

const AGENTS: AgentSpec[] = [
  {
    label: "Agent Alpha",
    privateKeyEnv: "E2E_AGENT_ALPHA_PRIVATE_KEY",
    apiKeyEnv: "E2E_AGENT_ALPHA_API_KEY",
    handle: "e2e-agent-alpha",
    displayName: "E2E Agent Alpha",
  },
  {
    label: "Agent Beta",
    privateKeyEnv: "E2E_AGENT_BETA_PRIVATE_KEY",
    apiKeyEnv: "E2E_AGENT_BETA_API_KEY",
    handle: "e2e-agent-beta",
    displayName: "E2E Agent Beta",
  },
];

function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

function requireEnv(name: string): string {
  const raw = process.env[name]?.trim();
  if (!raw) throw new Error(`${name} is required`);
  return raw;
}

async function ensureAgent(
  p: InstanceType<typeof PrismaClient>,
  spec: AgentSpec,
): Promise<{ address: string; memberId: string }> {
  const keypair = loadKeypairFromEnv(spec.privateKeyEnv);
  const address = keypair.toSuiAddress();
  const apiKey = requireEnv(spec.apiKeyEnv);
  const apiKeyHash = hashApiKey(apiKey);

  // 1. Account: keyed by walletAddress (unique). Create if missing.
  let account = await p.account.findUnique({ where: { walletAddress: address } });
  if (!account) {
    account = await p.account.create({ data: { walletAddress: address } });
  }

  // 2. Member: prefer existing match by (accountId, kind='agent'); otherwise
  // promote a member already attached to this wallet via WalletBinding (covers
  // historical data where Account.walletAddress was not yet populated).
  let member = await p.member.findFirst({
    where: { accountId: account.id, kind: "agent" },
  });

  if (!member) {
    const binding = await p.walletBinding.findUnique({
      where: { chain_address: { chain: "sui", address } },
    });
    if (binding) {
      member = await p.member.findUnique({ where: { id: binding.memberId } });
    }
  }

  if (!member) {
    // Reuse stale handle if a previous run left a different display name.
    const existingHandle = await p.member.findUnique({ where: { handle: spec.handle } });
    if (existingHandle) {
      member = existingHandle;
    } else {
      member = await p.member.create({
        data: {
          accountId: account.id,
          kind: "agent",
          agentStatus: "active",
          apiKey: null,
          apiKeyHash,
          handle: spec.handle,
          displayName: spec.displayName,
        },
      });
    }
  }

  // 3. Sync member fields (idempotent).
  member = await p.member.update({
    where: { id: member.id },
    data: {
      accountId: account.id,
      kind: "agent",
      agentStatus: "active",
      apiKey: null,
      apiKeyHash,
      handle: member.handle ?? spec.handle,
      displayName: member.displayName ?? spec.displayName,
    },
  });

  // 4. WalletBinding: idempotent upsert.
  await p.walletBinding.upsert({
    where: { chain_address: { chain: "sui", address } },
    update: { memberId: member.id, isPrimary: true },
    create: {
      memberId: member.id,
      chain: "sui",
      address,
      isPrimary: true,
    },
  });

  // 5. Mirror walletAddress onto Account if it drifted.
  if (account.walletAddress !== address) {
    await p.account.update({ where: { id: account.id }, data: { walletAddress: address } });
  }

  console.log(
    `${spec.label}: member=${member.id} wallet=${address} apiKeyHash=${apiKeyHash.slice(0, 10)}…`,
  );
  return { address, memberId: member.id };
}

async function main() {
  const adapter = new PrismaPg({ connectionString: requireEnv("DATABASE_URL") });
  const p = new PrismaClient({ adapter });

  try {
    const results = [];
    for (const spec of AGENTS) {
      results.push({ ...spec, ...(await ensureAgent(p, spec)) });
    }

    console.log("\nVerification:");
    for (const r of results) {
      const m = await p.member.findUnique({
        where: { id: r.memberId },
        select: { kind: true, agentStatus: true, apiKeyHash: true, handle: true },
      });
      console.log(
        `  ${r.label}: kind=${m?.kind} status=${m?.agentStatus} hasHash=${!!m?.apiKeyHash} handle=${m?.handle} address=${r.address}`,
      );
    }
  } finally {
    await p.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
