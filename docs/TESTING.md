# Testing

- `pnpm check`: typecheck, ESLint, Prettier check and the unit tests.
- `pnpm lint` / `pnpm format:check`: required before a PR; CI runs both.
- `pnpm run audit`: fails on high or critical dependency advisories.
- `pnpm test:coverage`: Vitest with V8 coverage. CI uploads the `coverage` artifact and enforces 68% statements, branches, functions and lines.
- `pnpm test`: Vitest
  - `packages/world/tests`: city determinism, required landmarks, no building and road overlap, every entrance reachable, paths never cross buildings, gate passability, and the OpenStreetMap importer on a synthetic Overpass answer (rotated streets, an L-shaped school, points of interest): footprints, types, reachable doors, entry points, determinism, and promotion of essential buildings when only a few candidates exist.
  - `packages/core/tests`: clock and RNG, base setup, **phase acceptance scenarios** (scavenge a supermarket into stock, convert a shelter, build a wall line that blocks the grid, meals, shooting with ammo use, infected chase, window fire, a closed fort ring, hordes damaging structures), events resolving while simulation time is frozen, determinism (same seed gives the same hash), save, load and resume with identical hashes, blueprint grid reservations surviving a save/load, rejection of newer, malformed and map-mismatched saves, a five-day headless scenario report, a fixed-seed victory for the wall-building player, and a day and a save round trip on an imported map.
- `pnpm test:e2e`: Playwright in Chromium (SwiftShader WebGL). Covers new game, choosing the HQ by clicking, box selection, a right-click scavenge order, save, reload and continue, the build menu with a wall drag, an event choice resolving while time is frozen, the language switch, the minimap moving the camera, and a game on a real place with Overpass mocked (start, choose a base, save, reload).
- `pnpm test:e2e:cross-browser`: the smoke test in Firefox and WebKit. CI installs both browsers with dependencies; the full workflow remains Chromium-only.
- `pnpm build`: static build in `apps/web/dist`, relative paths. CI also rejects the production bundle if it contains the development-only `__afterfall` debug hook.
- `pnpm sweep [seeds] [firstSeed] [open|fort]`: plays many seeds with both scripted players and prints win rates. Use it before and after a balance change; the tool runs sequentially, so a 40-seed sweep takes several minutes. The last recorded full run (`pnpm sweep 40 1`, 2026-10-31, `main` at `02c8d10`) gave open 29/40 and fort 31/40. Record the date and commit with every new run in [PLAYTEST.md](PLAYTEST.md).
- `pnpm sim <seed> <days>`: headless scripted game for balance. It prints the report (survivors, kills, stock, navigation failures, average tick time).

Simulation cost is measured at about 0.06 ms per tick (Node, 10 survivors and about 40 infected).
