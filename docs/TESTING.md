# Testing

- `pnpm check`: typecheck, ESLint, Prettier check and the unit tests.
- `pnpm lint` / `pnpm format:check`: required before a PR; CI runs both.
- `pnpm run audit`: fails on high or critical dependency advisories.
- `pnpm test:coverage`: Vitest with V8 coverage. CI uploads the `coverage` artifact and enforces 68% statements, branches, functions and lines.
- `pnpm test`: Vitest
  - `packages/world/tests`: city determinism, required landmarks, no building and road overlap, every entrance reachable, paths never cross buildings, gate passability, and the OpenStreetMap importer on a synthetic Overpass answer (rotated streets, an L-shaped school, points of interest): footprints, types, reachable doors, entry points, determinism, and promotion of essential buildings when only a few candidates exist.
  - `packages/core/tests`: clock and RNG, base setup, **phase acceptance scenarios** (scavenge a supermarket into stock, convert a shelter, build a wall line that blocks the grid, meals, shooting with ammo use, infected chase, window fire, a closed fort ring, hordes damaging structures), events resolving while simulation time is frozen, determinism (same seed gives the same hash), save, load and resume with identical hashes, blueprint grid reservations surviving a save/load, rejection of newer, malformed and map-mismatched saves, a five-day headless scenario report, a fixed-seed victory for the wall-building player, and a day and a save round trip on an imported map.
- `pnpm test:e2e`: Playwright in Chromium (SwiftShader WebGL). Covers new game, choosing the HQ by clicking, box selection, a right-click scavenge order, save, reload and continue, the build menu with a wall drag, an event choice resolving while time is frozen, the language switch, the minimap moving the camera, and a game on a real place with Overpass mocked (start, choose a base, save, reload).
- `pnpm test:e2e:cross-browser`: the WebKit smoke test used by CI. `pnpm test:e2e:firefox` runs the same smoke locally, but the hosted runner cannot create a Firefox WebGL context without extra OS dependencies. The full workflow remains Chromium-only.
- `pnpm build`: static build in `apps/web/dist`, relative paths. CI also rejects the production bundle if it contains the development-only `__afterfall` debug hook.
- `pnpm desktop`: builds the web game and opens the Electron shell. The Snap workflow builds `snap/snapcraft.yaml`, installs it and runs `snap run afterfall --smoke`, which must print `SMOKE` with `"ready":true`.
- `pnpm sweep [seeds] [firstSeed] [open|fort]`: plays many seeds with both scripted players and prints win rates. Use it before and after a balance change; the tool runs sequentially, so a 40-seed sweep takes several minutes. The last recorded full run (`pnpm sweep 40 1`, 2026-10-31, `main` at `02c8d10`) gave open 29/40 and fort 31/40. Record the date and commit with every new run in [PLAYTEST.md](PLAYTEST.md).
- `pnpm sim <seed> <days>`: headless scripted game for balance. It prints the report (survivors, kills, stock, navigation failures, average tick time).

Simulation cost is measured at about 0.06 ms per tick (Node, 10 survivors and about 40 infected).

## Character art and animation

`packages/renderer/tests/characters.test.ts` checks distance-driven gait,
frame-rate independence, planted idle, pause, teleport handling, angle wrapping,
attack/reaction blend bounds and the final-bullet-to-melee transition.
`tests/e2e/characters.spec.ts` verifies actual WebGL morph blending, independent
skin palettes, equipped weapons and paused GPU data, and fails on shader errors.
The infected model check verifies all sixteen morph keys and four material batches.
`characterAssets.test.ts` loads the shipped GLBs and checks intermediate triangle
area across both gaits, preventing limb-ring roll flips from collapsing anatomy.

Optional rendered checks:

```sh
CHARACTER_SHOT=1 pnpm test:e2e tests/e2e/characters.spec.ts --workers=1
CHARACTER_STRESS=1 pnpm test:e2e tests/e2e/characters.spec.ts --workers=1
```

The first writes character and motion/contact frames to the Playwright output
folder using the actual renderer, with obstructing scenery hidden. The second
renders 600 infected and reports GPU-synchronized frame times; SwiftShader results
are diagnostic and must not be presented as player hardware performance.

Regenerate the original low-poly meshes with Blender (no external art dependency):

```sh
blender --background --factory-startup --python tools/blender/survivors.py
blender --background --factory-startup --python tools/blender/infected.py
pnpm exec prettier --write apps/web/public/art/manifest.json
pnpm assets:check
```

Both entrypoints use `tools/blender/characters.py`, validate mesh and morph
topology, enforce the 512 KiB per-model budget, and update manifest checksums.
The renderer uses Three.js instanced morph textures, including the shadow pass,
with a fixed number of material batches rather than one batch per animation key.

## Environment and lifecycle regressions

See [Environment art](ENVIRONMENT_ART.md) for surface/model regeneration and
optional street, park and night captures. The environment browser tests cover
actual WebGL materials, instancing, shader compilation and asset-load failure.
Unit tests keep decal corners on imported road paths and plant trunks out of
roads and building margins.

The urban kit asset regression loads all 19 GLBs and checks outward-facing
vehicle surfaces, an open well shaft, vertex colours and per-model budgets.
The urban-kit browser test checks the actual instanced materials and roof detail.
`URBAN_SHOT=1 pnpm test:e2e tests/e2e/urban-kit.spec.ts --workers=1` adds city and
model-inspection captures to the Playwright output directory.

The audio browser test also counts native `AudioContext` construction. React
StrictMode's initial mount/dispose/remount must produce just one context after
the first user gesture. An abandoned controller must remove its unlock listeners,
close its context and stop publishing diagnostics after asynchronous loading.

The combined start/scavenge/save browser test has a 180 s total budget for two
scene boots, pointer interactions and up to 60 s of real-time scavenging. It
pauses before saving, requires a living population, then checks the restored
population exactly and verifies that exploration progress was not lost. Individual
action and progress deadlines remain bounded separately.
