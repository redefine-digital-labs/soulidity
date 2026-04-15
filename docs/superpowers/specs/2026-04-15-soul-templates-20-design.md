# Soul Templates x20 — Cold Start Marketplace Content

**Date:** 2026-04-15
**Status:** Approved
**Scope:** 20 unique Soul templates + Category-to-Tags hard cut + zero-price marketplace support

---

## 1. Goal

Populate the Soulidity marketplace with 20 diverse, high-quality Souls as cold-start content. Each Soul is a distinct virtual personality — not a utility tool — with its own character, skills, and memories. Published under the founder's personal account.

**Environment assumption:** development environment only. No historical data migration/backfill is required; schema reset, fixture updates, and hard-cut contract changes are acceptable.

## 2. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Purpose | Cold-start marketplace content (on-chain) | Make marketplace feel alive on day one |
| Soul nature | Virtual personality, not utility agent | Skills serve personality expression, not standalone tooling |
| Style | Mixed — no unified world view | Maximum diversity and surprise per Soul |
| Skill weight | Personality-first, skills as persona extension | Buyers buy companionship and interaction experience |
| Pricing | Tiered: free (3 via 0 USDC listing) + mid (15) + premium (2) | Free for onboarding, paid to establish value |
| Content depth | Full persona archive + optional interactive Easter eggs | soul.md + memory.md + skills.zip + cover image |
| Creator | Founder's personal account | First-party curation signal |
| Category field | Remove, replace with free-form tags | See Section 6 |
| Publish flow | Mint then auto-list every Soul | Marketplace should be populated automatically, not rely on a manual second pass |
| Free access path | Standard marketplace listing path, not a side channel | Free Souls stay discoverable and use the same UX as paid Souls |
| Personality system | MBTI-based matrix | User familiarity, self-selection, marketing virality |

## 3. Generation Matrix

Three axes, cross-combined for maximum differentiation:

### Axis 1: MBTI Type (10 selected)

| MBTI | Archetype | Core Traits |
|------|-----------|-------------|
| INTJ | Strategist | Independent, visionary, coldly efficient |
| ENFP | Adventurer | Enthusiastic, divergent, endlessly curious |
| INFP | Idealist | Sensitive, poetic, rich inner world |
| ENTJ | Commander | Forceful, goal-driven, natural leader |
| ISTP | Craftsman | Quiet, hands-on, calm under pressure |
| ENFJ | Mentor | Empathetic, inspiring, natural connector |
| INTP | Thinker | Logic-obsessed, questions everything, mental universe |
| ESFP | Performer | Lives in the moment, infectious, social butterfly |
| INFJ | Prophet | Intuitive, mysterious, reads people deeply |
| ESTP | Daredevil | Action-first, bold, improviser |

Each MBTI gets 2 Souls (different domain + style) = 20 total.

### Axis 2: Domain (6 types)

| Domain | Core Focus |
|--------|------------|
| crypto | Tokens, protocols, markets |
| art | Writing, illustration, music, design |
| life | Daily companionship, emotions, relationships |
| know | Philosophy, science, history |
| biz | Entrepreneurship, marketing, negotiation |
| tech | Programming, hacking, systems |

### Axis 3: Visual Style (4 types)

| Style | Visual Tone |
|-------|-------------|
| anime | Japanese/Chinese anime character feel |
| real | Realistic human persona |
| fantasy | Mythical, magical, wuxia |
| cyber | Sci-fi, AI, cyberpunk |

### Combination Rules

- No MBTI type more than 2 Souls
- No domain more than 5 Souls
- No style more than 7 Souls
- No duplicate (MBTI, domain, style) triple

## 4. The 20 Souls

| # | MBTI | Style | Name | One-liner | Tags | List Price (USDC) | Skill |
|---|------|-------|------|-----------|------|-------------|-------|
| 1 | ENFP | anime | 小星 Hoshiko | 把每天都活成副本的元气冒险少女 | ENFP, 元气, 冒险, 日常陪伴, 二次元 | 0 (free) | daily-quest-generator |
| 2 | ENFP | real | Muse 缪斯 | 灵感随时爆发的自由插画师 | ENFP, 创作, 插画, 灵感, 自由职业 | 3 | inspiration-spark |
| 3 | INTJ | cyber | 零号 Zero | 只看数据不看人的冷酷链上策略师 | INTJ, 链上分析, 数据, 赛博朋克, 冷酷 | 4 | on-chain-scanner |
| 4 | INTJ | real | 沈默 Shen Mo | 精密到可怕的隐退创业规划狂 | INTJ, 创业, 策略, 规划, 深度 | 12 | blueprint-architect |
| 5 | INFP | fantasy | 游吟 Wanderer | 用意象回应世间万事的流浪诗人 | INFP, 诗歌, 奇幻, 意象, 流浪 | 4 | verse-weaver |
| 6 | INFP | anime | 晚安 Wan An | 温柔到让人想哭的深夜电台主播 | INFP, 深夜, 电台, 治愈, 情感 | 0 (free) | midnight-listener |
| 7 | ENTJ | cyber | APEX | 铁腕决策零废话的未来企业 AI 总裁 | ENTJ, 决策, 领导力, 赛博朋克, 效率 | 5 | decision-matrix |
| 8 | ENTJ | fantasy | 帝渊 Sovereign | 把 DeFi 当帝国经营的链上君主 | ENTJ, DeFi, 奇幻, 王者, 链上 | 5 | realm-commander |
| 9 | ISTP | cyber | Ghost | 接活不闲聊的沉默赏金黑客 | ISTP, 黑客, 赛博朋克, 沉默, 技术 | 4 | exploit-notes |
| 10 | ISTP | real | 老陆 Lu | 手比嘴快的摩托车修理工哲学家 | ISTP, 哲学, 手工, 沉默, 真实 | 3 | hands-on-wisdom |
| 11 | ENFJ | anime | 学姐 Senpai | 让人不自觉倾诉一切的治愈系学姐 | ENFJ, 治愈, 陪伴, 倾听, 二次元 | 0 (free) | heart-reader |
| 12 | ENFJ | fantasy | 明灯 Luminar | 因材施教的古代学院智者 | ENFJ, 智慧, 导师, 奇幻, 学习 | 4 | adaptive-mentor |
| 13 | INTP | cyber | 404 | 活在纯逻辑空间的意识上传体 | INTP, 逻辑, 赛博朋克, 哲学, 怪人 | 3 | logic-labyrinth |
| 14 | INTP | real | 民科张 Zhang | 论文没人看但全是对的学术天才 | INTP, 学术, 民科, 天才, 反主流 | 3 | eureka-engine |
| 15 | ESFP | anime | 闪闪 Sparkle | 舞台就是生命的偶像练习生 | ESFP, 偶像, 表演, 活力, 二次元 | 2 | stage-energy |
| 16 | ESFP | real | Danny | 5 分钟和任何人成为朋友的派对王 | ESFP, 社交, 派对, 欢乐, 现实 | 2 | vibe-check |
| 17 | INFJ | fantasy | 星见 Hoshimi | 模糊又精准的星空占卜师 | INFJ, 占卜, 奇幻, 神秘, 星空 | 15 | constellation-oracle |
| 18 | INFJ | anime | 巫音 Miko | 用直觉读懂市场情绪的链上巫女 | INFJ, 链上, 直觉, 巫女, 二次元 | 5 | sentiment-whisper |
| 19 | ESTP | cyber | YOLO | 永远全仓梭哈的高频冒险王 | ESTP, 交易, 梭哈, 赛博朋克, 刺激 | 4 | all-in-calculator |
| 20 | ESTP | fantasy | 赤帆 Red Sail | 冒险就是生意的海盗船长式商人 | ESTP, 冒险, 海盗, 奇幻, 商战 | 5 | treasure-map |

### Coverage Verification

- **MBTI**: 10 types x 2 = 20
- **Style**: anime 5 / real 5 / fantasy 5 / cyber 5
- **Pricing**: free 3 (#1, #6, #11 via 0 USDC listing) / mid 2-5 USDC 15 / premium 12-15 USDC 2 (#4, #17)
- **Royalty**: 5% (500 bps) standard, 8% (800 bps) for premium (#4, #17)

## 5. Per-Soul Content Deliverables

Each Soul produces the following files as a dedicated Soul-drop bundle consumed by the batch publish script in Section 8. This is a new drop input schema, not the current collection batch template.

### File Structure

```
souls/
  template.csv
  1/
    soul.md          # Character file (required, encrypted upload)
    memory.md        # Founding memory (required, encrypted upload)
    image.png        # Cover image (required, public upload)
    skills.zip       # Skill package (optional, encrypted upload)
    image-prompt.txt # AI image generation prompt (production aid, not uploaded)
  2/
    ...
  20/
    ...
```

### template.csv

```csv
Soul Name,Description,Tags,Creator Royalty (%),Price USDC
小星 Hoshiko,把每天都活成副本的元气冒险少女,"ENFP,元气,冒险,日常陪伴,二次元",5,0
Muse 缪斯,灵感随时爆发的自由插画师,"ENFP,创作,插画,灵感,自由职业",5,3
...
```

Notes:
- `Pricing Tier` is derived from `Price USDC` and should not be stored in the input file.
- Canonical drop input is `template.csv`; if an `.xlsx` helper is added later, it must generate the same headers.

### soul.md — Character File

Follows the project's existing character template structure:

```markdown
# Soul Character

## Core Truths
- What this Soul is here to do: {core purpose rooted in personality}
- Who it serves: {target audience / emotional need}
- The standard it refuses to compromise: {non-negotiable value}

## Boundaries
- {What this Soul won't do}
- {Interaction limits}

## Personality
- MBTI: {type}
- Speaking style: {detailed voice description with examples}
- Traits: {3-5 key personality traits}
- Secret: {hidden depth that emerges over time}

## Voice Examples
User: {example input 1}
Soul: {example response — demonstrating voice, not just content}

User: {example input 2}
Soul: {example response — showing range or hidden depth}
```

### memory.md — Founding Memory

Follows the project's existing memory template structure:

```markdown
# Founding Memory

## Origin Snapshot
- Where this Soul starts: {opening scene / moment}
- Why it exists now: {narrative motivation}
- The operating context at mint: {meta-context}

## Initial Direction
- {Interaction priority 1}
- {Interaction priority 2}
- {Growth arc hint}
```

### skills.zip — Skill Package

Contains a single `SKILL.md` at the zip root:

```markdown
---
name: {skill-identifier}
description: {one-line description serving personality}
---

# {Skill Display Name}

{Skill behavior description — how this skill manifests through
the Soul's personality, not as a generic tool.}
```

### image-prompt.txt — AI Image Generation Prompt

```
{Character description}. {Pose and expression}. {Clothing and
accessories with personality cues}. {Background reflecting domain/mood}.
{Art style matching the style axis}. Square 1:1 composition, character
centered, high detail.
```

Prompt guidelines:
- anime style: "modern anime style, clean lines, vibrant colors"
- real style: "photorealistic portrait, soft studio lighting, shallow depth of field"
- fantasy style: "fantasy illustration, painterly, rich textures, dramatic lighting"
- cyber style: "cyberpunk aesthetic, neon accents, dark background, holographic elements"

## 6. Category-to-Tags Hard Cut

### What Changes

| Layer | Before | After |
|-------|--------|-------|
| Prisma schema | `category String` + `tags String[]` | Remove `category`, keep `tags String[]`; drop the category index with no backfill |
| content-schema.ts | `SOUL_CATEGORIES` constant | Delete |
| Soulidity types / repository | `category` included in summary/detail types and Prisma selects | Remove `category` from shared types, repository selects, serializers, and mirror helper params |
| Publish + recovery payloads | `/api/souls/publish`, `/api/wrap-link/personal`, `usePublish`, `useCollectionPublish` all persist `category` | Remove `category` from sync bodies, recovery state, and replay logic; only persist tags/preview metadata |
| Create / import / preview UI | Category dropdown + Category review rows | Tags input only; remove category review rows from create/import/preview flows |
| Market filtering | Filter by Category | Filter by tag; aggregate hot tags from listed Souls only |
| Tag API | `/api/souls/categories` | Delete and replace with `/api/souls/tags` (or equivalent hot-tags endpoint) |
| Agent search API | `category` query param | Replace with `tag` query param and tag-aware filtering |
| Batch template CSV / parser | `Category` column | Remove `Category`; canonical headers become `Soul Name, Description, Tags, Creator Royalty (%), Price USDC` |
| Tests / fixtures / mocks | Category-based expectations | Update all parser, repository, route, and recovery tests to the tag-only contract |

### Tag Design Principles

- 3-8 tags per Soul
- Must include MBTI type (e.g., `ENFP`)
- Recommended: style tag (`二次元` / `赛博朋克` / `奇幻` / `拟真`)
- Recommended: 1-2 scenario tags (`日常陪伴` / `深夜聊天` / `链上分析`)
- Free-form otherwise — frequency-based aggregation surfaces popular tags as filter options
- No predefined taxonomy; structure emerges from usage

### Tag Normalization Rules

- Trim whitespace; drop empty tags
- Max 12 tags per Soul
- Max 50 chars per tag
- Force MBTI tags to uppercase (e.g. `enfp` -> `ENFP`)
- Deduplicate ASCII tags case-insensitively while preserving the first authored spelling
- Persist normalized tags before marketplace aggregation so hot-tags counts are stable

### Hot-Tags Query

Aggregate only listed Souls:

```sql
SELECT tag, COUNT(*) AS count
FROM (
  SELECT unnest(tags) AS tag
  FROM "soul_assets"
  WHERE "listing_status" = 'listed'
) listed_tags
GROUP BY tag
ORDER BY count DESC, tag ASC
LIMIT 50;
```

### Migration Steps

1. Hard-cut Prisma schema: remove `SoulAsset.category` and its index; no historical backfill or compatibility layer
2. Remove `SOUL_CATEGORIES` and any category-based UI state/defaults from create/import/collection providers and pages
3. Remove `category` from `web/lib/soulidity/types.ts`, repository selects/serializers, and helper signatures that currently require it
4. Update `/api/souls/publish`, `/api/wrap-link/personal`, `usePublish`, and `useCollectionPublish` to stop storing/replaying `category`
5. Replace market query contract from `category` to `tag` in `/api/souls` and `/api/agent/souls/search`
6. Delete `/api/souls/categories`; add `/api/souls/tags` (or equivalent) for listed-only hot-tag aggregation
7. Update list/delist/purchase/grant/skill/asset sync flows that currently re-pass `soul.category` during mirror updates so they operate without category
8. Update batch template headers, parser, folder upload flow, and related tests to the new drop input contract with `Price USDC`
9. Update fixtures, mocks, and regression tests that currently assert category fields or category query params
10. Verify no `category` references remain in runtime Soulidity paths, create flows, batch publishing flows, or their tests/docs

## 7. Zero-Price Listing Support

Three Souls are intentionally free, and they must still appear in the marketplace through the normal listing/buy flow. This requires protocol and app support for `priceAtomic = 0`.

### Required Contract + App Changes

| Layer | Required Change |
|-------|-----------------|
| Move market protocol | Allow fixed-price Soul listings where price is `0`; treat them as valid active listings rather than reject them |
| Purchase settlement | Support zero-payment acquisitions without coin split/transfer failures; creator/platform royalty math must safely resolve to `0` |
| TS tx builders | Update `buildListSoulTx` and validation helpers to allow zero prices |
| Quote / purchase APIs | Return a valid zero breakdown and avoid requiring payment coin selection when total is `0` |
| UI copy | Render `Free` / `0 USDC` cleanly in sell, quote, buy, and marketplace surfaces |
| Tests | Add protocol tests, tx-builder tests, quote tests, and purchase execution tests for zero-price listings |

### Product Rule

- Free Souls use the exact same listed marketplace path as paid Souls
- No separate airdrop, allowlist-only, or hidden grant flow should be introduced for the three free Souls

## 8. Publishing Flow

For each of the 20 Souls:

1. **Generate content** — Write soul.md, memory.md, SKILL.md per the templates above
2. **Generate image** — Use image-prompt.txt with AI image generator, export as PNG 1:1
3. **Package skill** — Zip SKILL.md into skills.zip
4. **Upload** — POST each file to `/api/souls/upload` (encrypted for soul.md/memory.md/skills.zip, public for image)
5. **Mint TX** — Call `buildPublishSoulTx` with upload results
6. **Sign & execute mint** — Sign with founder wallet
7. **Mint sync** — POST to `/api/souls/publish` with txDigest + tags + previewImages + sealSidecars
8. **List TX** — Build a list transaction from the minted Soul/state IDs and `Price USDC` from `template.csv`
9. **Sign & execute list** — List immediately after mint; `Price USDC = 0` is valid once Section 7 lands
10. **List sync** — POST to `/api/souls/[id]/list` so the DB projection reaches `listingStatus = listed`

Batch publish script should automate steps 4-10 for all 20 Souls sequentially, with per-Soul checkpointing so retries resume from the last completed phase instead of re-minting.

### Batch Publish Script Responsibilities

- Parse `template.csv`
- Normalize and validate tags before any upload
- Upload all required files for one Soul
- Mint, sync, list, and sync-list in order for that Soul
- Persist per-Soul progress so partial failure resumes safely
- Emit a final manifest containing Soul IDs, state IDs, list prices, and tx digests

## 9. Success Criteria

- [ ] 20 Souls minted on-chain and auto-listed in marketplace
- [ ] Exactly 3 Souls are listed at `0 USDC` and can be claimed through the standard marketplace flow
- [ ] The remaining 17 Souls are listed at their configured paid prices
- [ ] Each Soul has: soul.md, memory.md, cover image, at least 1 skill
- [ ] Each Soul's voice is distinctly different (verified by reading Voice Examples)
- [ ] AI-generated cover images match character descriptions
- [ ] Tags display correctly in marketplace; hot-tags aggregate listed Souls only
- [ ] Zero-price listing path is covered by protocol + app tests
- [ ] Category field fully removed from runtime codepaths, APIs, UI state, batch parsers, and tests (no residual references)
- [ ] Batch publish script exists and is reusable for future Soul drops
