# Testing

- `pnpm test`: Vitest
  - `packages/world/tests`: city determinism, required landmarks, no building and road overlap, every entrance reachable, paths never cross buildings, gate passability.
  - `packages/core/tests`: clock and RNG, base setup, **phase acceptance scenarios** (scavenge a supermarket into stock, convert a shelter, build a wall line that blocks the grid, meals, shooting with ammo use, infected chase, window fire, a closed fort ring, hordes damaging structures), determinism (same seed gives the same hash), save, load and resume with identical hashes, a five-day headless scenario report, and a fixed-seed victory for the wall-building player.
- `pnpm test:e2e`: Playwright in Chromium (SwiftShader WebGL). Covers new game, choosing the HQ by clicking, box selection, a right-click scavenge order, save, reload and continue, the build menu with a wall drag, the language switch, and the minimap moving the camera.
- `pnpm sweep [seeds] [firstSeed] [open|fort]`: plays many seeds with both scripted players and prints win rates. Use it before and after a balance change; 40 seeds take about 4 minutes on 4 cores when split into 4 processes.
- `pnpm sim <seed> <days>`: headless scripted game for balance. It prints the report (survivors, kills, stock, navigation failures, average tick time).

Simulation cost is measured at about 0.06 ms per tick (Node, 10 survivors and about 40 infected).
