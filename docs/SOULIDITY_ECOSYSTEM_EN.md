# Soulidity Ecosystem and Products

**Create Once. Live Across Worlds.**

Product architecture updated October 10, 2026. Delivery status retains the September 6, 2026 historical baseline; current implementation and deployment evidence remain in the authoritative workspaces.

The [module and permission boundary summary in Chinese](SOULIDITY_CONTRACT_MODULES_AND_PERMISSION_BOUNDARIES_CN.md) consolidates the open ecosystem review and the proposed ten-repository delivery plan. Distribution channels and trading markets have separate repository and authority boundaries. Planned repositories and management objects have not been created by this documentation change.

Soulidity is an ecosystem for creating, owning, using, and playing with persistent digital characters. It connects character creation, identity and content infrastructure, desktop companionship, a fully onchain game engine, and a growing family of games.

Animacraft helps creators and users make characters. Soulidity Protocol & App carries their identities, content, and permissions. SoulDesk brings them into everyday desktop life. Infinite Flow Engine provides infrastructure for building fully onchain games. Soul Expedition, Soul Paper Theater, Infinite Stellar, and Soul Habitat explore adventure, strategy, seasonal competition, and asynchronous raising.

The target architecture treats Maker and Soul as independent, open assets. Soulidity provides discovery, management, and trading tools; Animacraft provides authoring, publication, and optional distribution. Independent clients and producers can use the public standards and infrastructure. Community and discovery, markets, creation and issuance, the Soul workspace, and applications are product entry points with their own rules and authority. Continuity after a platform exits must be verified for each existing journey. See the [open ecosystem architecture](SOULIDITY_OPEN_ECOSYSTEM_RD_ADDENDUM_CN.md) for the current specification.

Worlds can change or reset while a Soul's identity and verifiable history continue. Each game retains its own rules, state, and fairness boundaries. Persistent identity does not imply permanent combat advantages or automatic interoperability for every asset.

## Network direction

**Sui is the core network for current development. Future expansion is planned for Solana and Sonic SVM.**

The current onchain implementation uses Sui and Move, with Walrus for content storage and Seal for conditional access where integrated. Solana and Sonic SVM are future expansion targets, not currently supported production deployments. This direction does not imply that existing contracts, assets, or permissions already operate across those networks. Network-specific implementations and interoperability mechanisms will be defined and validated as that work progresses.

## Product map

| Category | Product | Role |
| --- | --- | --- |
| Character creation | Animacraft | Character Makers, composition, provenance, licensing, and expansion content |
| Identity and applications | Soulidity Protocol & App | Persistent Soul identity, content, memory, permissions, markets, and community |
| Desktop application | SoulDesk | Desktop companionship, character presentation, and Agent workflows |
| Developer infrastructure | Infinite Flow Engine | A composable fully onchain game engine, currently built on Sui |
| Games | Soul Expedition: The Mist Court | Short roguelike expeditions built around exploration, choices, and risk |
| Games | Soul Paper Theater | A paper-stage game of exploration and turn-based decisions |
| Games | Infinite Stellar | A multiplayer seasonal strategy world with independent rules |
| Games | Soul Habitat | Asynchronous raising, economic survival, and bounded autonomous life simulation |

**Soulidity Games** is a presentation grouping for the four games. It does not imply a separate repository or a single shared runtime architecture. Product category and development stage are distinct: Soul Habitat is a game project even while it remains in planning.

## Animacraft: create characters

Creators build reusable Character Makers from layered images, colors, and composition rules. Each formal completion produces a final Soul with its own unique identity; third parties can also create standard Souls through valid independent producers. A **Maker** is a product object; a **Creator** is the person who authors it. Platform registration is not a standard asset creation license.

The current editing model is **Maker → Part → Item → Style**. Makers can include character descriptions, initial memories, and skills documentation. Versions and Expansion Packs provide a way to extend content while preserving the assets, rules, and provenance of published releases.

Animacraft and Soulidity are separate products, repositories, and contract packages. New commerce capabilities cover Base access, Expansion Packs, Complete authorizations, control transfers, and revenue sharing. Production availability must be checked against the deployment evidence for the relevant release.

Authoring, fixed snapshots, content storage, onchain version publication, channel agreements, and actual issuance have separate states. Animacraft distribution requires a specific agreement on scope and fees; independent paths retain the asset's own licensing, supply, and issuance rules. The implementation annexes define [objects and rights](open-ecosystem/OBJECTS_AND_RIGHTS_CN.md), [entries, permissions, and dependencies](open-ecosystem/ENTRY_PERMISSION_DEPENDENCY_MATRIX_CN.md), and [states and recovery](open-ecosystem/STATE_TRANSITIONS_AND_RECOVERY_CN.md).

## Soulidity Protocol & App: persistent identity and content

A Soul is the core object for persistent identity and protocol permissions. The protocol and applications organize native creation, imports, content versions, SoulGrant, Paid Access, markets, Collections, and community features. Public contract interfaces and SDKs support direct wallet and Sui interaction. Optional integration and query tools do not make a platform business API mandatory, and a workspace client does not receive default root control over user assets.

An **OC** describes a creative identity. A **Soul** carries persistent identity and permissions. A **Runtime** executes interactions. A **Scene** provides an environment for activity.

Ownership, content access, and copyright licenses are expressed separately. Experiences can be read under explicit rules; the system does not assume that every runtime shares all memories or capabilities.

## SoulDesk: a home for your Soul on the desktop

**Your Soul, at home on your desktop.**

SoulDesk is the desktop product name, replacing Soulidity Desktop and Anima Desktop in product introductions. It covers desktop characters and animation, persona and resource management, and interactions with Agent workflows.

Existing foundations include CLI activity awareness, local wallet and device binding, and partial Soul content consumption and decryption. Feature availability follows the desktop implementation and release notes.

The implementation lives in the Soulidity repository's `clawnews/desktop/` directory. Application UI, installer names, application identifiers, and update-channel branding have not yet completed the transition to SoulDesk. Desktop-Claw remains the upstream attribution where applicable. Name availability has not been verified.

## Infinite Flow Engine: infrastructure for fully onchain games

**Infinite Flow Engine is a composable fully onchain game engine. Its current Sui implementation combines an onchain contract framework with a supporting SDK for Scene versions, Run state, rule permissions, randomness, asset settlement, and outcome receipts, allowing developers to focus on gameplay.**

MUD is a useful category reference: an onchain game engine combines contract infrastructure with offchain development, query, and integration tools to help organize complex state and rules. The comparison does not imply identical architecture or feature parity with MUD's broader toolchain.

The current P0 implementation includes:

- SceneRegistry and immutable SceneVersion objects;
- SoulPlayProfile and bounded solo Runs;
- Sui-native randomness, reward reservation, and settlement;
- timeout and ownership-change exits;
- RunReceipt and AcceptedOutcome records;
- a source-distributed TypeScript SDK.

Party play, a universal mutable inventory, and automatic multi-party fee splitting are outside the current P0 scope.

The engine can reduce engineering effort for games with many rules, complex state, and ongoing extensions. Whether a game's core mechanics should run onchain is a separate product decision. An engine does not automatically make transactions faster or cheaper, or guarantee contract security. A visual Scene Maker remains a separate future authoring-tool direction.

## Soulidity Games

### Soul Expedition: The Mist Court

A short roguelike expedition across a seven-node map. Players choose routes and actions such as Scout, Assault, Parley, Rest, and Retreat, balancing loot against risk.

The project includes a client, Move gameplay logic, and a local Rehearsal tutorial that creates no onchain records.

### Soul Paper Theater

A single-player paper-stage game. Players move, light moon lanterns, fold wards, and confront shadows within a limited number of turns.

The project includes a client, Move rules, and a local tutorial. Its documentation, like Expedition's, still refers to the former Soulidity Scene Engine name. Exact dependency versions and migration to the renamed Infinite Flow Engine must be checked separately.

### Infinite Stellar

A Soul-centered, zero-knowledge, fully onchain multiplayer seasonal strategy game. Planet discovery, resource growth, fleet movements, attack, defense, and seasonal objectives form its core experience.

Civilization and military state belong to a season. The Soul preserves the history, relationships, and expression that the rules allow to continue.

Infinite Stellar owns its multiplayer state and rules; it is not required to depend on Infinite Flow Engine. The engine can support optional prologue or PvE experiences. Repository records describe an experimental testnet canary and a playable local rules sandbox, with no mainnet deployment. Local simulation creates no real Soul history.

### Soul Habitat

An asynchronous raising and economic-survival game. The player acts as a mentor, setting goals, budgets, permissions, and risk boundaries while an independent game incarnation of a Soul learns, works, cooperates, hibernates, and revives.

The first planned stage uses non-withdrawable Life Credits in a replayable simulation. Hibernation or game death does not destroy the source Soul. The project remains in product and protocol planning; it is not a released game or a demonstrated autonomous-income system.

## How the ecosystem fits together

1. Creators publish Makers through Animacraft.
2. Users compose characters and enter the canonical Soul creation flow.
3. Soulidity provides identity, content, and permission interfaces.
4. SoulDesk and games use those interfaces within their own runtime boundaries.
5. Games contribute verifiable outcomes where their integrations support them.
6. Creators expand the ecosystem with additional content and experiences.

This is the intended ecosystem journey. The products have different levels of readiness, and not every connection is active in production.

Games can share Soul identity and reuse engine capabilities where useful while retaining independent rules and state. No game is assumed to inherit another game's inventory, economy, or authority merely because both use a Soul.

In the current stack, Sui / Move holds authoritative identity, permissions, and applicable game rules and settlement. Walrus stores images and content packages with retention and renewal requirements. Seal controls encrypted access where integrated. Web applications, SDKs, query services, and runtimes provide development, presentation, and interaction surfaces.

## Development status

| Product | Recorded stage | Current boundary |
| --- | --- | --- |
| Soulidity Protocol & App | Mainnet deployment records and application implementation | Does not establish large-scale adoption or activation of every new integration |
| Animacraft | Pre-v1 editor and commerce implementation | The reviewed local manifest has `canonicalSoulMintEnabled` set to `false` |
| SoulDesk | Pilot runtime | Product naming is confirmed; application and installer rebranding is pending |
| Infinite Flow Engine | Experimental P0 | Production release gates remain blocked; no independent audit completed |
| Soul Expedition / Soul Paper Theater | Clients, contracts, and local tutorials | Onchain modes require verified deployment configuration; tutorials create no onchain receipts |
| Infinite Stellar | Testnet canary and local sandbox | No mainnet deployment; production proofs, services, and other release gates remain outstanding |
| Soul Habitat | Planning | The first simulation slice is not represented as delivered |
| Solana / Sonic SVM expansion | Future direction | No current production support or automatic cross-network interoperability is claimed |

This snapshot reflects repository documentation and configuration reviewed on September 6, 2026. It is not a fresh test run, live service check, or real-time verification of chain state. Each product's release records remain the authority for deployment readiness.

## Repositories and supporting material

- [Organization repositories](https://github.com/orgs/redefine-digital-labs/repositories)
- [Soulidity](https://github.com/redefine-digital-labs/soulidity)
- [Animacraft](https://github.com/redefine-digital-labs/animacraft)
- [Infinite Flow Engine](https://github.com/redefine-digital-labs/infinite-flow-engine)
- [Soul Expedition](https://github.com/redefine-digital-labs/soul-expedition)
- [Soul Paper Theater](https://github.com/redefine-digital-labs/soul-paper-theater)
- [Infinite Stellar](https://github.com/redefine-digital-labs/infinite-stellar)
- [Soul Habitat](https://github.com/redefine-digital-labs/soul-habitat)
- [Onchain Experience Network](https://github.com/redefine-digital-labs/onchain-experience-network): ecosystem vision material, rather than a game or runtime product.
- [MUD](https://mud.dev/): an external reference for the onchain-engine category.

Maker Launch Playbook and OC Autonomous Worlds Roadmap are operating and roadmap materials. A playable social world remains an exploratory direction, rather than a separately released product.
