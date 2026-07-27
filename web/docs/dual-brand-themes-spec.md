# Soulidity dual-brand visual themes

## Goal

Let one Soulidity web application present either the Soulidity visual system or
the Animacraft visual system without changing routes, authentication, wallet,
transactions, protocol behavior, or published artwork.

## Scope

- Add the preference contract `auto | animacraft | soulidity`.
- Resolve `auto` to `soulidity`; the DOM `data-theme` value is always
  `animacraft` or `soulidity`.
- Persist the preference in the `soulidity_visual_theme` cookie and fall back to
  `soulidity-visual-theme` in local storage.
- Apply the theme before first paint, keep it synchronized on page load and
  window focus, and update `theme-color` and `color-scheme`.
- Add one accessible three-choice theme menu to the navbar account controls.
- Theme the shared shell, wallet UI, shared controls, landing, market, Soul
  detail, Create flow, Animacraft integration, and mobile navigation.
- Keep purple/action, gold/value, teal/chain-tech, success, and error semantics
  intact across both palettes.

## Acceptance

1. A first-time visitor renders `data-theme="soulidity"` without a light/dark
   flash.
2. Selecting any preference updates the page immediately and survives reload;
   `auto` remains the stored preference while resolving to Soulidity.
3. Cookie settings use one year and `SameSite=Lax`; Soulidity hosts use
   `Domain=.soulidity.ai`, HTTPS uses `Secure`, and local HTTP development keeps
   the local-storage fallback without emitting an unusable Secure cookie.
4. The menu supports pointer, keyboard focus, arrow navigation, Escape,
   outside-click closing, and correct ARIA state on desktop and mobile.
5. Wallet dialogs and shared components remain readable in both themes.
6. Existing authentication, wallet, route, upload, mint, and transaction code
   is unchanged.
7. Theme contract tests plus web lint, typecheck, and production build pass.

## Rollback

Revert the files introduced or changed by this feature. The bootstrap defaults
to Soulidity and the pre-existing Soulidity token values remain the Soulidity
mapping, so disabling the switcher can be done independently by removing its
navbar entry while leaving the tokenized CSS in place.
