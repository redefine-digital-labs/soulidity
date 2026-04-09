# Desktop Phase-One Smoke

## macOS smoke path

1. Start a desktop-facing web target that serves `/api/desktop/catalog*` and `/api/desktop/me*`.
2. Run `DESKTOP_WEB_PROXY_TARGET=<web-target> npm --prefix desktop run dev`.
3. Open `http://localhost:1420/#/explore`, verify one starter card and one curated soul card render from the shared catalog.
4. From the starter detail flow, install the starter persona, then open `#/library` and confirm it appears under installed personas.
5. In `#/library`, click `Set as active on this device` for the starter persona and confirm `Current local active persona` updates.
6. In `#/auth`, complete browser sign-in and confirm the desktop route shows the connected account state after the deep link returns.
7. Open `#/settings`, click `Refresh account sync`, then verify `Account active persona` reflects the current server-side value.
8. Click `Sync current device persona to account`, confirm the synced starter persona appears as the account active persona, then refresh once more.
9. Repeat the settings refresh against a curated soul response so at least one soul asset is covered in the same smoke pass.

## Windows fallback strategy

- Require `cargo check --manifest-path desktop/src-tauri/Cargo.toml` to pass before packaging.
- Require `npm --prefix desktop run typecheck` to pass on every iteration.
- Require `npm test -- tests/desktop/desktop-shell-contract.test.ts tests/desktop/desktop-auth-contract.test.ts tests/desktop/desktop-install-contract.test.ts tests/desktop/desktop-catalog-contract.test.ts tests/desktop/desktop-profile-sync-contract.test.ts` to pass as the minimum desktop regression set.
- Treat real Windows filesystem install QA as a second-pass manual validation after the cross-platform build and contract checks are green.
