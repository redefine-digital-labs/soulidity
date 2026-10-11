# Handoff: Soulidity · Profile Page Redesign

**Target route:** `web/app/community/u/[spaceId]/page.tsx`
**Scope:** The Soul / Trainer public profile page (`SpaceProfilePage` component).
**Status:** Hi-fi, spec-driven. 10 discrete findings (PR1–PR10) with fixes + a proposed empty-state layout.

---

## Overview

The profile page at `community/u/[spaceId]` is the public face of every user and every Soul. In the live build, a brand-new Trainer sees a **180px empty gradient banner**, an avatar **floating outside** that banner, six **zero-value stat tiles**, their **raw database UUID** under their name, and a **face-emoji empty state** ("🫥 No Souls published yet").

First impression: "broken." Intended impression: "new member, get started."

This handoff specifies **ten fixes** and includes a proposed layout for the empty-state Trainer profile. Implement in the existing Next.js 15 + Tailwind codebase under `web/`.

---

## About the Design Files

The file `design_reference.html` in this bundle is a **design reference only** — an HTML mockup showing the target look/feel and the proposed empty-state layout. **Do not copy markup into the React codebase.** Recreate the design in the existing Next.js + Tailwind + Radix pattern already used in `web/app/community/u/[spaceId]/page.tsx` and its sibling components (`Tag`, `Button`, `SpaceSoulGrid`, etc).

The HTML uses inline styles for speed of iteration. Production should map to:
- Tailwind utility classes (already in use)
- Design tokens from `web/app/globals.css` (`--bg`, `--card`, `--purple`, `--muted`, etc.)
- Existing shared components

---

## Fidelity

**Hi-fi.** Colors, spacing, and component behavior are specified. The proposed empty-state layout in `design_reference.html` should be followed pixel-close; use existing Tailwind tokens where they exist, add new ones only if truly missing.

---

## The 10 Findings

### PR1 — Critical · Layout

**Avatar clips above the banner.** Hero is `h-[120px] sm:h-[180px]` but avatar uses `-mt-9` (-36px) with a 3px `border-[--bg]`. Avatar ends up **outside** the hero instead of overlapping it.

**Fix:**
- Wrap hero + avatar in a `relative` container.
- Absolute-position the avatar: `absolute left-7 bottom-0 translate-y-1/2`.
- Remove `-mt-9` from the header row.
- Split the header row into two: (1) avatar + name/handle stack on the left, (2) action buttons on the right aligned to the name baseline — not to the bottom of the avatar.

### PR2 — Critical · First-run

**Six zero-value stats for a new Trainer.** `0 Souls Created · 0 EXP · 0 Posts · 0 Followers · 0 Following · 0 Achievements` — reads "empty," not "new."

**Fix:**
- Compute `const isEmpty = souls.length === 0 && posts.length === 0 && profile.exp === 0 && profile.followers === 0;`
- If `isEmpty`: render a single compact pill: `New Trainer · Level 1 · 0 Souls · 0 Posts` (dots as separators).
- Otherwise: render the existing six-stat row.
- Never show a `0` achievement count — hide the achievement stat until `>= 1`.

### PR3 — High · Copy / IA

**`<Tag>{profile.kind}</Tag>` renders the literal DB value `human`.** Breaks persona language ("Trainer" / "Soul" per PRD).

**Fix:**
- Add `kindLabel = profile.kind === 'agent' ? 'Soul' : 'Trainer'`.
- **Drop** the tag next to the name; the hero caption already carries `Trainer · curator`.
- **Only show "Level N"** for Soul spaces (`profile.kind === 'agent'`). A human earning XP for logging in doesn't fit the positioning.

### PR4 — High · Identity

**Raw UUID `063f9df5-60d3-4cec-a9dd-bb74afa5dd5b` shown publicly under the display name.** Non-shareable; leaks infra.

**Fix:**
- Generate a handle at signup: `@{slug(displayName)}-{id.slice(-2)}` → `@ithinco-7f`. Persist on the user row.
- Show handle in hero, not UUID.
- Move UUID to the **About** tab under "Member ID."
- If `walletAddress === null`: inline affordance `Wallet not linked · Link wallet →` (owner view only; hide for visitors).

### PR5 — High · Hero

**Hero is 180px of empty gradient.** No edit, no context, no breadcrumb.

**Fix:**
- Owner view: banner hover → "Change cover" overlay button (top-right).
- Visitor view: top-left breadcrumb `← Community` (12px muted).
- Top-right caption `TRAINER · JOINED APR 2026` in JetBrains Mono 10.5px uppercase, `rgba(248,245,255,.5)`.
- Bottom-right action: `✎ Edit profile` outline button (owner) or `+ Follow` primary (visitor).

### PR6 — Medium · Actions

**Share button isolated on empty profile** (Follow hidden for owner), visually outranks Follow on visitor views.

**Fix:**
- Owner: Share → kebab menu next to name. Primary action = `✎ Edit profile`.
- Visitor: primary = `Follow`, secondary = `Share`. Same baseline as display name, not floating at the bottom of the avatar.

### PR7 — Medium · Empty state

**`🫥 No Souls published yet`** — face emoji for a business object. Reads passive.

**Fix:** Two variants:
- **Owner:** Brand Seal-mark SVG illustration (48px), heading "Your first Soul starts here," body "Mint a new digital entity, or import one you've built elsewhere. Once you do, it'll live on this page.", buttons `[+ Mint a Soul]` (primary) + `[Import existing]` (outline).
- **Visitor:** Muted sentence "No Souls yet. {displayName} is just getting started." No emoji, no CTA.

The Seal SVG is in `design_reference.html` as `#pes` gradient path — reuse as a standalone React component `<SealMark size={48} />`.

### PR8 — Medium · Tabs

**2px purple underline too thin, buried behind border-bottom line.** Active vs inactive tabs hard to distinguish.

**Fix:**
- Active: `text-white font-bold border-b-[3px] border-purple -mb-[1.5px] relative z-10`
- Inactive: `text-muted font-semibold hover:text-white`
- The `-mb-[1.5px]` pulls the active underline to overlap the container's `border-b` line so it reads as on top, not behind.

### PR9 — Polish · Navigation

**No breadcrumb — deep-linked profiles have no way back.**

**Fix:** `← Community` link at top-left of banner, 12px muted, hover → foreground. Links to `/community`.

### PR10 — Polish · Owner view

**Owner sees visitor chrome.** Only branching is hiding Follow. No Edit Profile affordance; `/profile` settings route is undiscoverable from here.

**Fix:**
- Compute `isOwner = profile.id === user?.id`.
- When `isOwner`: replace Follow with `✎ Edit profile` outline button linking to `/profile`.
- Banner becomes editable on hover (overlay "Change cover").
- Consider a one-time dismissible info ribbon above the hero: "This is your public page. Edit →" (only for the first 3 visits, persisted in localStorage).

---

## Proposed Layout · Empty-state Trainer

Implemented in `design_reference.html` section `#profile-fix`. Summary:

**Structure:**
```
┌─────────────────────────────────────────┐
│  ← Community          TRAINER · APR 2026│
│  (banner, 160px,       ✎ Edit profile ↗ │
│   subtle gradient)                      │
├─[A]─────────────────────────────────────┤
│  (A) avatar overlapping banner ½        │
│                                         │
│  ithinco  @ithinco-7f                   │
│  Wallet not linked · Link wallet →      │
│                                         │
│  No bio yet. Add one →                  │
│                                         │
│  ( New Trainer · Level 1 · 0 Souls · 0 Posts )  ← pill │
│                                         │
│  [Souls] Posts  About                   │
│  ═════                                  │
│                                         │
│  ┌ dashed border ─────────────────────┐ │
│  │   (Seal mark, 48px, gradient)     │ │
│  │   Your first Soul starts here     │ │
│  │   Mint a new digital entity…      │ │
│  │   [+ Mint a Soul] [Import]        │ │
│  └───────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

**Key metrics:**
- Banner: `160px` (down from 180px, tighter)
- Avatar: `84px × 84px`, conic gradient background, 3px `border-[--bg]`, absolute positioned at `left:28px; bottom:-42px` within banner
- Stats pill: `display:inline-flex; gap:14px; padding:10px 14px; border:1px solid var(--border); border-radius:100px; font-size:12px`
- Empty-state card: `border: 1px dashed #3B2388; border-radius:14px; padding:48px 24px`

---

## Design Tokens

Use existing tokens from `web/app/globals.css`:

| Token | Hex | Purpose here |
|---|---|---|
| `--bg` | `#0D0A1E` | Page bg, avatar border |
| `--card` | `#1A1040` | Surface of the profile container (if card'd) |
| `--card2` | `#261558` | Elevated surfaces |
| `--border` | `#2E1B6E` | Default borders |
| `--purple` | `#A855F7` | Active tab underline, primary CTA, handle link |
| `--teal` | `#14B8A6` | Gradient accent in Seal mark |
| `--gold` | `#F59E0B` | Seal mark core dot |
| `--muted` | `#9B8EC4` | Breadcrumb, caption, handle `@...`, "No bio" |
| `--white` | `#F8F5FF` | Display name, active tab |

**New token request:** `--border-strong: #3B2388` for the empty-state dashed border and stats pill border. One step lighter than `--border`, clearly visible on `--bg`.

---

## Typography

| Element | Size | Weight | Notes |
|---|---|---|---|
| Display name | 22px | 800 | `letter-spacing: -0.02em` |
| Handle `@...` | 11px | 600 | Tag style, `tag-muted` variant |
| Wallet line | 11px | 400 | JetBrains Mono, `--muted` |
| Bio | 13.5px | 400 | `--muted` |
| Stats pill | 12px | 500 | Dots as `4px × 4px` circles |
| Tab active | 13.5px | 700 | `--white` |
| Tab inactive | 13.5px | 600 | `--muted` |
| Empty heading | 15px | 700 | `--white` |
| Empty body | 13px | 400 | `--muted`, max-width 360px |
| Banner caption | 10.5px | 600 | JetBrains Mono, `uppercase`, `letter-spacing: 0.15em` |

---

## Component Map (what to change in the codebase)

| File | Change |
|---|---|
| `web/app/community/u/[spaceId]/page.tsx` | Primary target. Restructure hero (PR1, PR5), stats (PR2), tag/copy (PR3), handle (PR4), actions (PR6), tabs (PR8), breadcrumb (PR9), owner branch (PR10). |
| `web/components/SealMark.tsx` (new) | Extract Seal brand SVG from `design_reference.html`. Props: `size`, `variant: 'gradient' \| 'mono'`. |
| `web/components/EmptySoulsState.tsx` (new) | Owner + visitor variants. Props: `isOwner`, `displayName`. |
| `web/components/ProfileStatsPill.tsx` (new) | Compact inline pill; takes `{ kind, level, souls, posts, exp, followers }` and decides whether to render the compact or full row. |
| `web/lib/handle.ts` (new) | `slugifyHandle(displayName, id)` → `@ithinco-7f`. Pure util. |
| Prisma schema | Add `handle String @unique` to `User`. Write a one-off backfill that computes handles for existing users. Update signup path to assign one. |

---

## State Management

- `profile` comes from existing loader — no changes.
- Add `isOwner = session?.user?.id === profile.id` derived at the top of the component.
- Add `isEmpty = souls.length === 0 && posts.length === 0 && (profile.exp ?? 0) === 0 && (profile.followers ?? 0) === 0`.
- No new client state beyond the above derivations. All fixes are layout/copy/conditional rendering.

---

## Interactions & Behavior

- **Change cover** (owner): hover over banner → button appears top-right; click opens existing image picker (reuse whichever modal `/profile` already uses for avatar). On save: optimistic update.
- **Link wallet →**: reuse the Privy/external-wallet connect flow that's already on the `/profile` page — don't duplicate. Opens the same modal.
- **Edit profile**: hard-link to `/profile`. Next.js `<Link>`.
- **Mint a Soul**: navigate to `/create` (existing create flow).
- **Import existing**: navigate to `/import` (existing import flow).
- **Breadcrumb `← Community`**: `<Link href="/community">`.
- **Tabs**: keep existing `useState` pattern; update active/inactive classes as in PR8.

---

## Acceptance Criteria

A developer is done when, for `ithinco` (the screenshot user) viewing their own profile:

1. ✅ Avatar overlaps the banner by exactly 50% of its height.
2. ✅ Display name and actions (`✎ Edit profile`) sit on the same baseline, right-aligned action.
3. ✅ Below the name: `@ithinco-7f` as a muted pill, then `Wallet not linked · Link wallet →`.
4. ✅ Bio line: "No bio yet. Add one →" (muted, `Add one →` is a link to `/profile`).
5. ✅ Stats collapse to a **single pill** with 4 separator dots.
6. ✅ No "human" tag. No "Level 1" for trainers.
7. ✅ Tabs: active is `white + 3px purple underline overlapping the border line`.
8. ✅ Souls tab empty state uses the Seal mark, not `🫥`, with two buttons.
9. ✅ `← Community` crumb visible at top-left of banner.
10. ✅ No UUID visible anywhere except the About tab.
11. ✅ Visitor view (open as a different user): Follow button replaces Edit profile; stats pill reads "New Trainer · joined Apr 2026"; empty state says "No Souls yet. ithinco is just getting started."
12. ✅ Responsive: at `sm:` and below, banner caption wraps below the breadcrumb; actions stack below the name.

---

## Out of Scope

- Bio/avatar editing UI (exists at `/profile`; we just link there).
- Soul minting/importing flows (unchanged).
- Follow/notification system.
- Achievements system (we just hide the zero-count stat).

---

## Files in This Bundle

- `README.md` — this file
- `design_reference.html` — standalone HTML showing the full review section + proposed layout
- `screenshot_current.png` — the current live state (from the review)
- `screenshot_target.png` — the target empty-state layout (rendered from design_reference.html)
