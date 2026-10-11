# Playable Worlds and Onchain Scenes

Status: Exploratory concept, saved for later discussion  
Date: 2026-09-06

This note preserves an early direction for Soulidity. The examples and development considerations below are possibilities, not agreed requirements. No implementation or final scope has been selected.

## The feeling

Imagine a social virtual world like Obi Island, where your character—your Soul—can move around, play, meet other characters, and participate in activities inside different scenes.

Some scenes are deliberately built by creators. Others could be designed around things that already exist onchain: protocols, markets, collections, or individual onchain objects. Both could belong to the same playable world.

The important reference is the spatial experience: recognizable buildings, paths, characters, and places to enter. A 3D or isometric town makes activity feel like something happening in a shared environment.

## Reference

- [Elliscope's NAVI city post on X](https://x.com/elliscopef/status/2096291843814424852)
- The supplied screen recording showed a green isometric town with NAVI bank buildings, address labels, characters, and an activity panel.
- The post describes live deposits, withdrawals, borrowing, repayments, and liquidations. Its underlying implementation was not verified during this discussion.
- Obi Island is the user's reference for characters playing and interacting within scenes. The AI-town comparison is an additional inspiration, not a decision to require autonomous agents.

## Core idea

A Soul is the character through which someone participates in the world. A scene is a place where that character can do things. Existing onchain systems can provide real state and functions for some of those places.

Possible mappings include:

| Existing element | Possible expression in the world |
| --- | --- |
| Lending protocol | A bank with counters for supported services |
| Exchange | A marketplace or trading venue |
| NFT collection | A gallery or neighborhood |
| Wallet activity | A character animation associated with a confirmed action |
| Assets or positions | A backpack, collection, or account book |

These mappings are illustrative. Creators could choose other interpretations, and a single protocol could support several scenes.

## Two sources of scenes

**Creator-built scenes:** Homes, squares, playgrounds, shops, and event spaces, with activities and visual identities defined by their creators.

**Onchain-connected scenes:** Places connected to existing contracts or objects. Their state and supported interactions could reflect those systems. The environment itself still needs design; a contract does not automatically specify a playable space.

For example, a Soul might leave a creator-built home, meet someone in a square, visit a protocol-connected bank, and then enter a community game. The experience should allow meaningful participation without requiring a financial transaction at every step.

## Possible interaction levels

- **Explore and play:** Move through scenes, interact with objects, and participate in activities.
- **Observe:** See confirmed onchain activity represented spatially.
- **Act:** Use a scene's interaction points to prepare and execute supported protocol actions.
- **Socialize:** Meet other users and their Souls in shared spaces.
- **Optional assistance:** Explore AI-guided conversation or character behavior later if useful.

The relationship between a Soul, an OC, a wallet, and a user remains open. This note does not require one-to-one ownership, NFTs, or a particular identity architecture.

## Development considerations to revisit

- Select the camera, art style, movement model, and initial playable activity.
- Decide how scenes are authored, connected, and extended by creators.
- Define which character attributes persist across scenes.
- Distinguish actual online users from visual representations of external wallet activity. An animated visitor should not imply that its wallet owner is present.
- Map each integrated protocol's supported data and actions explicitly; universal contract discovery does not provide universal interaction semantics.
- Keep visual storytelling tied to verifiable events where it represents real activity. Walking routes and animations are presentation choices.
- For asset-changing interactions, show the action and relevant terms, obtain the appropriate signature or authorization, and reflect the confirmed result.
- Decide whether shared presence, chat, AI behavior, or any onchain character state is needed for the selected scope.

## Possible first experiment

A small scene with a controllable Soul, something to play with, and one recognizable onchain-connected place could test the intended feeling. Whether this experiment uses illustrative data, live read-only activity, or a test transaction can be decided later.

## Current decision

Save this concept in a lightweight document library. Defer detailed requirements, architecture, protocol coverage, milestones, and implementation until a future discussion.
