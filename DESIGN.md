# Design System — Soul Marketplace

## Product Context
- **What this is:** One-of-one encrypted content marketplace on Sui blockchain
- **Who it's for:** Crypto-native content creators and buyers (alpha, research, trading strategies)
- **Space/industry:** Web3 / NFT marketplace, but positioned as a content product store (not a trading floor)
- **Project type:** Web app (Next.js) with on-chain settlement

## Aesthetic Direction
- **Direction:** Industrial/Utilitarian with content-focus
- **Decoration level:** Intentional — glass-card pattern with subtle borders, dot-grid background
- **Mood:** Clean, functional, trustworthy. Premium content store, not dark trading terminal
- **Competitive positioning:** Light mode in a dark-mode-dominated category (OpenSea, Blur, Tensor, Foundation all dark). Closest peer: Zora (also light). Signals "content product" not "trading floor"
- **Research references:** OpenSea OS2, Blur, Tensor, Zora, Foundation (analyzed 2026-03-31)

## Typography
- **Display/Hero:** Bricolage Grotesque (800 weight) — Variable serif-grotesque hybrid, distinctive without trying. No competitor uses this. Tight letter-spacing (-0.02em)
- **Body:** Outfit (300-600 weights) — Clean geometric sans, reads well at all sizes
- **UI/Labels:** Outfit — Same as body, with uppercase tracking (0.12-0.16em) for category labels
- **Data/Tables:** JetBrains Mono (tabular-nums) — Standard, solid for prices and addresses
- **Code:** JetBrains Mono
- **Loading:** Google Fonts CDN (`https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;600;700;800&family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap`)
- **Scale:**
  - Hero: 2.5rem / 40px (Bricolage, 800)
  - Page heading: 1.75rem / 28px (Bricolage, 700)
  - Section heading: 1.125rem / 18px (Bricolage, 600)
  - Body: 1rem / 16px (Outfit, 400)
  - Small/Helper: 0.875rem / 14px (Outfit, 400)
  - Category label: 0.6875rem / 11px (Outfit, uppercase, tracking 0.12-0.16em)
  - Badge: 0.75rem / 12px (Outfit, 500)

## Color
- **Approach:** Balanced — meaningful accent colors with clear semantic assignments
- **Primary (Cyan):** `#0891b2` — Listed status, primary actions, interactive elements, focus rings. Unoccupied territory (OpenSea=blue, Blur=orange, Tensor=purple, Zora=green)
- **Emerald:** `#059669` — Held status, download/access actions, upload success
- **Sealed (Slate):** `#64748b` — Encrypted/sealed state indicators, content bundle panel
- **Rose:** `#e11d48` — Danger actions (cancel listing, clear allowlist, revoke), error messages
- **Amber:** `#d97706` — Warnings (allowlist revocation warning)
- **Neutrals:** Warm-cool gray range:
  - Background: `#fafafa`
  - Surface: `#ffffff`
  - Elevated: `#f3f4f6`
  - Hover: `#e5e7eb`
  - Border subtle: `#e5e7eb`
  - Border default: `#d1d5db`
  - Border bright: `#9ca3af`
  - Text muted: `#9ca3af`
  - Text secondary: `#4b5563`
  - Text primary: `#111827`
- **Dim variants:** Each accent has a dim variant at 8% opacity for badge/alert backgrounds
- **Dark mode:** Not implemented. Light mode is a deliberate differentiator in this category

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64)

## Layout
- **Approach:** Grid-disciplined
- **Grid:**
  - Listing page: 3-column card grid (max-w-6xl, 1200px)
  - Detail page: 2-column split (1.1fr / 0.9fr, max-w-5xl)
  - Publish form: Single column (max-w-3xl)
- **Max content width:** 1200px (listing), 1024px (detail), 768px (forms)
- **Border radius:** xs(6px) sm(8px) default(12px) full(9999px for badges/pills)

## Motion
- **Approach:** Minimal-functional
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:**
  - Micro: 150ms — hover states, focus rings, border-color transitions
  - Short: 200ms — chevron rotation, card translate-y, collapsible toggle
  - Entrance: 400-500ms — fade-up page entrance, staggered children (50ms intervals)

## Soul-Specific Design Decisions

### 1. Status Badge on Cards
Every SoulCard shows a status badge pill overlaid on the preview image:
- **Listed** — Cyan badge with white text, blur backdrop
- **Held** — Emerald badge with white text, blur backdrop

**Rationale:** No major marketplace puts owner state on browse cards. For Souls, the allowlist model makes listing/held status actionable information. A buyer seeing "Held" knows they can't purchase yet. A buyer seeing "Listed" knows they can act.

### 2. Sealed Content Panel
Detail page sidebar includes a "Sealed Content" panel showing:
- Bundle state (Encrypted)
- Storage provider (Walrus)
- Access model (Owner or Allowlisted)

**Rationale:** Unique to Soul. No other marketplace needs this because nobody else sells encrypted bundles. It answers the buyer's question: "What am I getting and how do I access it after purchase?"

### 3. Access-First Action Hierarchy
When the owner views their Soul detail page:
1. **Primary (top):** "Access content" panel with download button
2. **Secondary (below):** Collapsible "Owner management" with list-for-sale and allowlist controls

**Rationale:** Flips the marketplace pattern (price-first) to a content product pattern (access-first). The owner bought the Soul to access the content, not to stare at the price. Download is the action they came for.

## Component Patterns

### Glass Card (`glass-card`)
- White background, 1px subtle border, 12px radius
- Hover: border darkens, 4px shadow, -2px translateY
- Used for: SoulCard in listing grid

### Glass Panel (`glass-panel`)
- White background, 1px subtle border, 12px radius
- No hover effect (static container)
- Used for: Detail page panels, publish form sections, search bar

### Badges
- Pill shape (9999px radius), 12px font, 500 weight
- Color-coded: cyan(listed), emerald(held), sealed(encrypted), amber(warning), rose(revoked), muted(tags)

### Buttons
- Primary: Cyan background, white text — for purchase, list, allowlist actions
- Emerald: Emerald background, dark text — for download/access actions
- Surface: Elevated background, border — for cancel/secondary
- Danger: Rose-dim background, rose text — for cancel listing, clear allowlist
- Large variant: 12px padding, 16px font, 12px radius — for primary CTAs

### Content Bundle Panel
- Sealed-dim background (#64748b at 8%), sealed border
- Lock icon + "Sealed Content" header
- Key-value rows for bundle metadata
- Used only on detail page sidebar

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-31 | Light mode as differentiator | Every competitor (OpenSea, Blur, Tensor, Foundation) defaults dark. Light signals "content product" |
| 2026-03-31 | Bricolage Grotesque + Outfit retained | Distinctive, no competitor uses this combo. Works well for content marketplace |
| 2026-03-31 | Cyan #0891b2 as primary accent | Unoccupied color territory in the Web3 marketplace space |
| 2026-03-31 | Status badges on SoulCards | Allowlist model makes listing state actionable for browse |
| 2026-03-31 | Sealed Content panel added | Encrypted bundles need explainable access model for buyers |
| 2026-03-31 | Access-first owner hierarchy | Content product pattern over marketplace pattern |
| 2026-03-31 | --accent-sealed (#64748b) added | New semantic color for encrypted/sealed state indicators |
