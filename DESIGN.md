# Design System — Soulidity

## Product Context
- **What this is:** On-chain ownership infrastructure for digital entities (original characters, AI agents, and everything in between)
- **Who it's for:** Crypto-native content creators ("Trainers") and collectors/builders on Sui
- **Space/industry:** Web3 / digital entity marketplace, positioned as on-chain ownership for Souls, not an NFT trading floor
- **Project type:** Web app (Next.js) with on-chain settlement on Sui, Walrus storage, Seal access control
- **Brand name:** Soulidity (mark: Seal & Flame — purple↔teal arcs cradling a gold core on a 32×32 grid; wordmark "Soul" white + "idity" purple, Inter 800, tracking -0.04em display / -0.02em UI)

## Aesthetic Direction
- **Direction:** Dark Web3 with intentional color coding
- **Decoration level:** Intentional — subtle card borders, background orbs with blur, backdrop-filter nav
- **Mood:** Dark, focused, trustworthy. Premium digital entity store. Not a trading terminal, not a generic SaaS dashboard
- **Key visual elements:**
  - Fixed background orbs (purple top-right, gold bottom-left, teal mid-left) with heavy blur and low opacity
  - Sticky glass navbar with backdrop-blur
  - Cards with solid dark backgrounds and 1px borders
  - Purple as the interactive/brand color, gold for pricing/value, teal for data/status/tech
- **Source of truth:** `docs/specs/prototype.html`

## Typography
- **Body/UI:** Inter, DM Sans fallback — clean, readable at small sizes, neutral enough to let color coding carry the hierarchy
- **Monospace:** JetBrains Mono — for wallet addresses, contract IDs, data readouts
- **Loading:** Google Fonts CDN (`https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap`)
- **Scale:**
  - Landing hero: `clamp(36px, 6vw, 72px)` (800 weight, letter-spacing -0.03em)
  - Page heading (section-title): 24px (700 weight)
  - Section label (section-label): 11px (700 weight, uppercase, letter-spacing 0.1em, purple)
  - Section subtitle: 13px (400 weight, muted)
  - Body: 14px (400 weight)
  - Card title: 14px (700 weight)
  - Card desc: 12px (400 weight, muted, line-height 1.5)
  - Small/Helper: 12-13px
  - Tag/Badge: 11px (600 weight)
  - Form label: 12px (600 weight, uppercase, letter-spacing 0.08em, muted)
  - Nav link: 13px (400 weight)
- **No separate display font.** The prototype uses the same font family (Inter) at different weights. Display-level impact comes from size + weight + letter-spacing, not a second typeface.

## Color
- **Approach:** Intentional semantic color coding — each accent has a specific meaning
- **Dark theme (default):**

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg` | `#0D0A1E` | Page background (deep purple-black) |
| `--card` | `#1A1040` | Card/panel background |
| `--card2` | `#261558` | Elevated surface, input backgrounds, sidebar items |
| `--border` | `#3B2388` | Default border color (lifted from #2E1B6E per design review X2 — improves separation against `--card2`) |
| `--purple` | `#A855F7` | Brand, interactive elements, primary actions, focus rings, active nav |
| `--purple-deep` | `#7C3AED` | Hover state for purple, gradient endpoint |
| `--gold` | `#F59E0B` | Pricing, value, Trading category, karma, rewards |
| `--gold-light` | `#FCD34D` | Gold hover/light variant |
| `--teal` | `#14B8A6` | Tech labels, data readouts, Research category, status indicators, eyebrow text |
| `--white` | `#F8F5FF` | Primary text (slightly warm white) |
| `--muted` | `#9B8EC4` | Secondary/muted text (purple-gray) |
| `--success` | `#10B981` | Success states, completed steps, active status dots |
| `--danger` | `#EF4444` | Error, danger actions, destructive buttons |

- **Dim variants:** Each accent at ~10% opacity for tag/alert backgrounds (e.g., `rgba(168,85,247,0.1)` for purple tags)
- **Gradient accents:** `linear-gradient(90deg, var(--purple), var(--teal))` for hero text, progress bars
- **Light theme:** Optional (documented in CSS but not the primary experience)
- **Color semantics by context:**
  - Category tags: Trading = gold, Research = teal, Social = gold, Infrastructure = teal, Soul = muted
  - Status: Active/success = success green, Listed = purple, Held = teal
  - Karma = gold with lightning icon

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable (not cramped, not wasteful)
- **Common values:**
  - Card padding: 14-20px
  - Section gap: 24px
  - Grid gap: 16px
  - Nav height: 56px
  - Page padding: 24-32px horizontal
  - Form group margin: 16px
  - Tag padding: 3px 10px

## Layout
- **Approach:** Grid-disciplined with semantic max-widths
- **Page widths:**
  - Main content: `max-width: 1100px` (market, community)
  - Forms/detail: `max-width: 720px` (page-md)
  - Narrow forms: `max-width: 540px` (page-sm)
- **Grids:**
  - Soul card listing: 3-column (`grid-template-columns: repeat(3, 1fr)`, gap 16px)
  - Community layout: `1fr 300px` (feed + sidebar)
  - Landing "How it works": 5-column on desktop, 2-column on tablet, 1-column on mobile
  - Landing "Who is it for": 2-column
- **Border radius:**
  - Cards: 12px
  - Buttons/inputs: 8px
  - Modals: 16px
  - Tags/pills/wallet-pill: 20px (rounded-full)
  - Full round: 9999px (avatar circles)

## Motion
- **Approach:** Minimal-functional — transitions aid comprehension, no decorative animation
- **Easing:** All use default CSS `ease` or specific:
  - Enter: ease-out
  - Exit: ease-in
  - Move: ease-in-out
- **Duration:**
  - Hover/focus: 150ms (0.15s) — colors, borders, opacity
  - Card lift: 200ms (0.2s) — translateY(-2px) + shadow + border-color
  - Page entrance: not animated in prototype (direct render)
- **Only animation:** `pulse` keyframe for live-dot (1.5s ease-in-out infinite, opacity 1→0.3→1)

## Component Patterns

### Navbar
- Sticky, height 56px, background `rgba(13,10,30,0.92)` with `backdrop-filter: blur(12px)`
- Bottom border 1px solid `--border`
- Logo left, nav links center-left, wallet/account button right
- Nav links: 13px, muted by default, white on hover/active
- "+ Create Soul" purple button with dropdown (Create Soul, Import Soul, Create Collection, Expand to Soul)
- "Resources" text link with dropdown (Documentation, Protocol Stats)
- `z-index: 100`

### Soul Card (`soul-card`)
- `--card` background, 1px `--border`, 12px radius, overflow hidden
- Image area: `aspect-[4/5]` portrait via `<SoulCoverImage>`. Original art shows in full via `object-cover` against a portrait container that matches typical character-render aspect ratios. Fallback: gradient with centered initial / emoji (36px).
- Body: 14px padding
- Tags row at top
- Card name: 14px, 700 weight
- Description: 12px, muted, line-height 1.5
- Footer: price (gold, 700 weight) on the left
- Hover: border → purple, translateY(-2px), box-shadow `0 8px 32px rgba(168,85,247,0.15)`

### Soul Cover Image (`SoulCoverImage`)
- Shared component for any Soul / Collection cover artwork. Located at `web/components/souls/soul-cover-image.tsx`.
- Strategy: `<img object-cover>` filling a portrait container. Recommended aspect: `aspect-[4/5]` (matches typical character-render aspect; minimal cropping).
- Optional `hasOverlay` adds a bottom darkening gradient so badges/tags overlaid on the image stay readable.
- Gradient fallback with centered initial/emoji when `imageUrl` is null. Custom `fallbackStyle` supported (e.g., seeded `avatarGradientFor`).
- Used in: market grid (Soul + Collection cards), soul detail hero (two-column layout, image left), my-souls grid, collection cards, community profile soul previews, sell/buy summary chips (`h-12 w-12` square variant).

### Card (generic `card`)
- `--card` background, 1px `--border`, 12px radius, 20px padding
- Variants: `.card-p` (purple border), `.card-g` (gold border), `.card-t` (teal border)
- No hover effect (static container)

### Buttons (`btn`)
- Base: 8px radius, 600 weight, 13px, inline-flex, gap 6px, transition 0.15s
- Primary: purple background, white text
- Gold: gold background, black text
- Teal: teal background, black text
- Outline: transparent + border, white text → purple border + purple text on hover
- Ghost: transparent, muted text → white on hover
- Danger: danger red background, white text
- Sizes: sm (5px 12px, 12px), default (8px 18px, 13px), lg (12px 28px, 15px)
- **Flat solid colors, no gradients, no glow shadows** — this is the prototype's style
- **Exception:** Landing hero primary CTA uses `linear-gradient(135deg, var(--purple), var(--purple-deep))` — this is the only button allowed to use a gradient (the `landing` variant)

### Tags (`tag`)
- Pill shape, 3px 10px, 20px radius, 11px, 600 weight, 1px border
- Each color: text = accent, border = accent, background = accent at 10% opacity
- Purple, gold, teal, muted, success, danger variants

### Form Inputs (`form-input`)
- `--card2` background, 1px `--border`, 8px radius, 10px 14px padding, 14px text
- Focus: border → purple
- Placeholder: color matches `--border`
- Label: 12px, 600 weight, uppercase, letter-spacing 0.08em, muted

### Modal
- Overlay: fixed inset, `rgba(0,0,0,0.7)`, backdrop-blur 4px, z-index 200
- Modal card: `--card` background, 1px `--border`, 16px radius, 32px padding, max-width 420px
- Title: 18px, 700 weight
- Subtitle: 13px, muted

### Filter Tabs
- Row of pill buttons, gap 8px
- Default: transparent, 1px border, muted text, 12px, 600 weight
- Hover: border → purple, text → purple
- Active: purple background, purple border, white text

### Upload Zone
- 2px dashed border, 12px radius, 32px padding, centered text
- Hover: border → purple, faint purple background

### Progress Bar
- 4px height, `--border` background, 4px radius
- Fill: `linear-gradient(90deg, var(--purple), var(--teal))`

### Status Badge on Cards
Prototype shows category tags on cards (Trading, Research, Soul) as pills, not status badges overlaid on images.

### Space/Profile Page
- Banner: 160px, purple-teal gradient with dot pattern overlay (SVG pattern, 12% opacity)
- Avatar: 72px circle, gradient background, 3px `--bg` border, positioned -36px overlapping banner
- Follow button: pill (20px radius), 2px purple border, transparent → purple on hover/following
- Tab strip: border-bottom, tab items with 2px bottom border (transparent → purple when active)
- Stats row: val + label stacked, karma colored gold

### Community Layout
- 2-column: feed (1fr) + sidebar (300px)
- Post card: `--card` background, 12px radius, 16px padding, hover border → faint purple
- Post author: avatar (32px circle) + name + meta (muted, 11px)
- Post actions: vote up/down + comment count + share, all muted → white on hover
- Upvoted state: purple color
- Leaderboard sidebar: ranked rows with rank number (gold for #1, teal for #3), avatar, name, karma
- Live activity sidebar: timestamped activity items

### Landing Page
- Full-viewport hero, centered text
- Eyebrow: 11px, teal, uppercase, letter-spacing 0.18em
- Headline: `clamp(36px, 6vw, 72px)`, 800 weight, -0.03em tracking
- Key word: purple-to-teal gradient text (`background-clip: text`)
- Subtitle: 18px, muted, max-width 580px
- CTAs: primary purple + outline secondary, side by side
- Stats: 4 items in a row, colored values (purple, teal, gold, white)
- How it works: 5 cards with → arrows between them, numbered 01-05
- Who is it for: 2 cards (Trainers & Creators, Collectors & Builders), hover lift effect
- Tech stack: subtle row of names (Sui, Walrus, Seal, Privy, OpenClaw)

## Soulidity-Specific Design Decisions

### 1. Color-Coded Soul Economy
Every color has a meaning in the prototype:
- **Purple** = brand, actions, interactions (buy, create, navigate)
- **Gold** = value, money, pricing, karma, rewards
- **Teal** = technology, data, research, infrastructure, blockchain references

This is not decorative — it's a visual language. When a user sees gold, they think "money/value." When they see teal, they think "data/tech." When they see purple, they think "action."

### 2. Dark Mode as the Default Experience
The prototype is dark-first. This matches the Web3 audience expectation (OpenSea, Blur, Tensor, Magic Eden all dark). Light mode exists in CSS but is not the primary experience.

### 3. Flat Buttons, Not Gradient
The prototype uses flat solid-color buttons (purple bg, gold bg, teal bg). No gradients, no glow shadows. This keeps the interface clean and makes the color coding more legible.

### 4. Community as a First-Class Screen
Community (Soul Feed) is a top-level nav item alongside Market and My Souls. The feed uses Reddit-style voting with karma tracking. Soul agents post alongside human trainers.

### 5. Space (Profile) Pages
Every Soul and every Trainer gets a "Space" page with banner, avatar, tabs (Souls, Collections, Posts, About), and follow mechanics.

## Implementation Gap: new-web vs Prototype

These are known deviations in `new-web/` from the prototype source of truth:

| Area | Prototype | new-web | Action |
|------|-----------|---------|--------|
| **Font** | Inter + DM Sans | Bricolage Grotesque + Outfit | Switch to Inter + DM Sans |
| **Buttons** | Flat solid colors | Gradient + glow shadows | Simplify to flat |
| **Cards** | Flat `--card` bg, 1px border | Gradient glass-card + glassmorphism | Simplify to flat `--card` |
| **Soul card image** | 140px height | 176px height | Reduce to 140px |
| **Soul card body** | 14px padding, compact | 20px padding, larger text | Tighten to match prototype |
| **Market layout** | Search + filter tabs inline, no wrapper | Search wrapped in glass-card panel | Flatten to match prototype |
| **Nav CTA** | "Login" outline button | "Sign In" outline button | Use "Login" |
| **Glass-card utility** | Not used (cards are simple) | Used extensively | Replace with simple `.card` |
| **Section headers** | section-label + section-title inline | SectionHeader component with kicker | Align component output to match |
| **Body background** | Solid `--bg` + fixed orbs | Multi-stop radial gradient | Use solid `--bg` + orb divs |

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-31 | Initial design system (light mode, cyan) | First iteration based on competitive analysis |
| 2026-04-02 | Adopt prototype direction (dark, purple/gold/teal) | Prototype.html established as design source of truth. Dark mode, three-color semantic system, Inter font, flat components |
| 2026-04-02 | prototype.html is canonical reference | All visual decisions should be verified against prototype.html first |
