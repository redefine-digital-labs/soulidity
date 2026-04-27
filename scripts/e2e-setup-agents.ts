/**
 * Idempotent env-driven setup for the two E2E agent identities.
 *
 * Reads:
 *   E2E_AGENT_ALPHA_PRIVATE_KEY / E2E_AGENT_ALPHA_API_KEY
 *   E2E_AGENT_BETA_PRIVATE_KEY  / E2E_AGENT_BETA_API_KEY
 *   E2E_AGENT_OWNER_WALLET (optional, recommended) — Sui address of the human
 *     account that "owns" the agents. `web/lib/auth/resolve-agent.ts`
 *     requires `agent.account.members[kind=human]` to be non-empty when
 *     resolving an API key, so the agent Member must hang off an Account
 *     that already has a human Member (typically the E2E Seller). When
 *     omitted, falls back to the address derived from E2E_SELLER_PRIVATE_KEY.
 *
 * For each agent, ensures:
 *   - Member row pointed at the owner's Account, kind='agent', agentStatus='active',
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

async function resolveOwnerAccountId(
  p: InstanceType<typeof PrismaClient>,
): Promise<string> {
  const explicit = process.env.E2E_AGENT_OWNER_WALLET?.trim();
  let ownerAddress = explicit;
  if (!ownerAddress) {
    const sellerKey = process.env.E2E_SELLER_PRIVATE_KEY?.trim();
    if (!sellerKey) {
      throw new Error(
        "Either E2E_AGENT_OWNER_WALLET or E2E_SELLER_PRIVATE_KEY must be set so the agent rows can hang off a human-owned Account (resolveAgentByApiKey requires it).",
      );
    }
    ownerAddress = loadKeypairFromEnv("E2E_SELLER_PRIVATE_KEY").toSuiAddress();
  }
  const binding = await p.walletBinding.findUnique({
    where: { chain_address: { chain: "sui", address: ownerAddress } },
    select: { memberId: true },
  });
  if (!binding) {
    throw new Error(
      `Owner wallet ${ownerAddress} has no WalletBinding row yet — log in once with that wallet via the web UI before running this script (or set E2E_AGENT_OWNER_WALLET to a wallet that already exists in DB).`,
    );
  }
  const owner = await p.member.findUnique({
    where: { id: binding.memberId },
    select: { id: true, accountId: true, kind: true },
  });
  if (!owner?.accountId || owner.kind !== "human") {
    throw new Error(
      `Owner wallet ${ownerAddress} resolves to member ${owner?.id ?? "?"} (kind=${owner?.kind}) without a human Account; resolveAgentByApiKey will reject any agent attached here.`,
    );
  }
  return owner.accountId;
}

async function ensureAgent(
  p: InstanceType<typeof PrismaClient>,
  spec: AgentSpec,
  ownerAccountId: string,
): Promise<{ address: string; memberId: string }> {
  const keypair = loadKeypairFromEnv(spec.privateKeyEnv);
  const address = keypair.toSuiAddress();
  const apiKey = requireEnv(spec.apiKeyEnv);
  const apiKeyHash = hashApiKey(apiKey);

  // The agent Member hangs off the owner's Account so resolveAgentByApiKey
  // can find a sibling kind='human' member to return as `ownerMemberId`.
  const account = { id: ownerAccountId };

  // 1. Member: prefer existing match by (accountId, kind='agent'); otherwise
  // promote a member already attached to this wallet via WalletBinding (covers
  // earlier installs where the agent had its own orphan Account).
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

  console.log(
    `${spec.label}: member=${member.id} wallet=${address} apiKeyHash=${apiKeyHash.slice(0, 10)}…`,
  );
  return { address, memberId: member.id };
}

async function main() {
  const adapter = new PrismaPg({ connectionString: requireEnv("DATABASE_URL") });
  const p = new PrismaClient({ adapter });

  try {
    const ownerAccountId = await resolveOwnerAccountId(p);
    console.log(`Owner account: ${ownerAccountId}`);
    const results = [];
    for (const spec of AGENTS) {
      results.push({ ...spec, ...(await ensureAgent(p, spec, ownerAccountId)) });
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
