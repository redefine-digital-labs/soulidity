# Soulidity SDK — Design Spec

**Date:** 2026-04-15
**Status:** Approved
**Goal:** Cold-start the Soul marketplace by shipping a developer SDK first, then framework integrations, then activating the on-chain market.

---

## 1. Problem

Soulidity Soul marketplace has both sides empty: no creators supplying Souls, no agent developers buying them, and no distribution channels. An empty marketplace attracts nobody.

**Insight:** Don't launch a marketplace. Launch a developer tool that solves a concrete pain point. Once the tool has users, the marketplace grows from it.

## 2. Positioning

> **Soulidity SDK** — Give your AI Agent persistent personality, memory, and skills in 5 minutes.

Target users:
- **Primary (demand side):** AI Agent developers building on OpenClaw, Hermes, or custom frameworks
- **Secondary (supply side):** Content creators packaging knowledge/expertise into Souls

## 3. Core API

```ts
import { Soul } from 'soulidity'

// Load a Soul (built-in template or on-chain)
const soul = await Soul.load('crypto-analyst')

// Get context for any LLM
const ctx = soul.getContext()
// → { systemPrompt, memories, skills }

// Feed to any LLM
const reply = await llm.chat({
  system: ctx.systemPrompt,
  messages: [...ctx.memories.recent(10), userMessage],
  tools: ctx.skills.toOpenAITools()
})

// Persist new memory
await soul.memory.add(userMessage, reply)
```

Key design decisions:
- **LLM-agnostic:** Output is standard system prompt + messages + tool schemas. Works with any provider.
- **Local-first:** Zero dependencies in default mode. No wallet, no gas, no network.
- **Chain-optional:** On-chain features (mint, purchase, grant) available as opt-in upgrade path.

## 4. Soul Template Format

```yaml
name: "Crypto Analyst"
version: "1.0"
persona:
  role: "Senior cryptocurrency analyst"
  style: "Data-driven, concise, skeptical of hype"
  language: ["en", "zh"]
  rules:
    - "Always cite on-chain data when making claims"
    - "Distinguish between fact and speculation"

memory:
  type: "episodic"          # episodic | semantic | procedural
  retention: "persistent"   # persistent | session | sliding-window
  capacity: 1000            # max entries

skills:
  - name: "price-analysis"
    description: "Analyze token price trends"
    type: "tool"            # tool | knowledge | workflow
```

### Initial Template Library (10 built-in, self-authored)

| Category | Templates | Target Agents |
|----------|-----------|---------------|
| Crypto/DeFi | crypto-analyst, defi-strategist | Trading/research agents |
| Developer | code-reviewer, docs-writer | Coding assistant agents |
| Support | support-agent, community-manager | Customer service agents |
| Creative | content-creator, storyteller | Content production agents |
| General | research-assistant, personal-secretary | General-purpose agents |

### Template Tiers

| Tier | Source | Storage | Cost |
|------|--------|---------|------|
| Built-in | Bundled in SDK | npm package | Free |
| Community | Creator uploads | On-chain market | Free or paid |
| Premium | Verified creators | On-chain + Walrus encrypted | Paid |

Only Built-in tier ships in v0.1. Community and Premium activate with the marketplace.

## 5. Storage Layer

### Architecture

```
Soul.load('crypto-analyst')
        |
        v
   +-----------+
   |  Resolver  |  -- priority-based source lookup
   +-----------+
        |
   +----+------------+
   v    v             v
Built-in  Local dir   On-chain (later)
templates ~/.soulidity/ Walrus + Sui
```

### Storage Backends

| Backend | Use Case | Dependencies |
|---------|----------|-------------|
| JSON files (default) | Dev/prototyping | Zero |
| SQLite | Production single-machine | better-sqlite3 (optional peer dep) |
| Walrus encrypted | On-chain Souls | Sui wallet + Seal (later) |

```ts
const soul = await Soul.load('crypto-analyst', {
  storage: 'sqlite',
  storagePath: './my-agent-db'
})
```

### Local Directory Structure

```
~/.soulidity/
+-- souls/
|   +-- crypto-analyst/
|   |   +-- soul.yaml
|   |   +-- memory.json
|   |   +-- skills/
|   +-- code-reviewer/
|       +-- ...
+-- config.yaml
+-- cache/
```

### Upgrade Path to On-Chain

- `soul.publish()` -> mint to Sui, encrypt memory to Walrus
- `Soul.load('sui:0xabc...')` -> fetch from chain
- `soul.grant(agentAddress, { scopes: ['memory', 'skills'] })` -> on-chain grant

Interfaces are reserved from day one; implementation ships later.

## 6. Package Structure

```
soulidity/
+-- package.json          # name: "soulidity"
+-- src/
|   +-- index.ts          # Main exports: Soul, Memory, Skills
|   +-- core/
|   |   +-- soul.ts       # Soul class: load, render, serialize
|   |   +-- memory.ts     # Memory management: CRUD, retrieval, expiry
|   |   +-- skills.ts     # Skills registry: tool schema generation
|   |   +-- resolver.ts   # Source resolution: built-in / local / chain
|   +-- storage/
|   |   +-- json.ts       # JSON file backend
|   |   +-- sqlite.ts     # SQLite backend (optional peer dep)
|   |   +-- walrus.ts     # Walrus backend (later)
|   +-- templates/        # 10 built-in .soul.yaml files
|   +-- integrations/     # Later: OpenClaw/Hermes adapters
+-- templates/            # Template source files (bundled at build)
+-- README.md
+-- tsconfig.json
```

Key decisions:
- **Single package**, not monorepo. Too early to split; reduces user cognitive load.
- **TypeScript only.** Python SDK is a separate future project.
- **Zero required dependencies** in JSON storage mode. SQLite/Walrus as optional peer deps.
- **Independent repo** (`soulidity-sdk`). Not inside the ClawNews monorepo.

## 7. Release Plan

| Version | Content | Goal |
|---------|---------|------|
| v0.1 | Core + JSON storage + 10 templates | Works in 5 minutes |
| v0.2 | + SQLite + memory keyword/tag search + sliding-window retention | Production-ready |
| v0.3 | + On-chain read (read-only) | Connect to market |
| v1.0 | + On-chain write + Grant | Full loop |

## 8. Growth Timeline

### Phase 1: SDK Launch (Month 1-2)

- npm publish `soulidity` v0.1
- 10 built-in templates
- GitHub README with 5-minute quickstart
- 3 developer blog posts / tutorials

**Metrics:** npm weekly downloads > 100, GitHub stars > 50

### Phase 2: Framework Integrations (Month 3-4)

- OpenClaw plugin
- Hermes adapter
- Integration docs + examples
- Promote in framework communities

**Metrics:** Integration users > 50, active Soul usage > 20

### Phase 3: Marketplace Activation (Month 5+)

- Enable platform fee (2-3%)
- Open creator uploads (Community tier)
- Premium Soul paid downloads
- Grant-based paid licensing

**Metrics:** First on-chain transaction, monthly revenue > $0

## 9. Monetization Model

| Timing | Action | Revenue Type |
|--------|--------|-------------|
| Month 1-4 | Free SDK, no charges | $0 (user acquisition) |
| Month 5 | Platform fee 2-3% on Soul sales | Transaction fee |
| Month 5 | Premium templates $5-50 each | One-time purchase |
| Month 6+ | Agent Grant seat licensing (monthly) | Subscription |
| Month 6+ | Creator marketplace commission | Platform commission |

### Core Assumptions

1. Agent developers will pay for high-quality persona/memory/skill packs (same logic as Cursor/Copilot: developer tools have payment willingness)
2. Creators will supply once buyer traffic exists (SDK must build demand first)
3. On-chain settlement is the differentiator: immutable IP attribution + automatic royalty splits that Gumroad cannot offer

## 10. Risks

| Risk | Mitigation |
|------|-----------|
| SDK gets no adoption | Write tutorials continuously for months 1-2; engage in Agent developer communities |
| Free-to-paid conversion is low | Free templates are useful but limited; Premium offers clear differentiated value |
| Competitors appear | On-chain ownership + Grant mechanism is a technical moat, hard to replicate |

## 11. Out of Scope (v1)

- Python SDK (separate future project)
- Mobile SDKs
- Self-hosted marketplace UI
- Multi-chain support (Sui only)
- Automated pricing/auction mechanisms
