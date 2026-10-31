# AFTERFALL — Rebuild the World

An original browser-based 3D survival RTS and colony builder. An outbreak emptied the city; you lead a handful of survivors, turn an abandoned building into a headquarters, scavenge by day, fortify, and hold out against the infected at night.

The MVP goal: **start a game, choose a base, explore buildings, gather resources, strengthen defenses and survive five consecutive nights.**

[![Play in browser](https://img.shields.io/badge/Play_in_browser-e8913a?style=for-the-badge&labelColor=11141a&color=e8913a)](https://gamestudio42.github.io/afterfall/)
[![CI and Pages](https://img.shields.io/github/actions/workflow/status/gamestudio42/afterfall/pages.yml?branch=main&style=for-the-badge&labelColor=11141a&label=Pages)](https://github.com/gamestudio42/afterfall/actions/workflows/pages.yml)

Play it at **[gamestudio42.github.io/afterfall](https://gamestudio42.github.io/afterfall/)**. No installation is needed.

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the game with Vite |
| `pnpm build` | Production build of `apps/web` |
| `pnpm test` | Vitest: world generation and simulation tests |
| `pnpm test:e2e` | Playwright: browser workflows (starts the dev server) |
| `pnpm typecheck` | TypeScript over the whole monorepo |
| `pnpm sim [seed] [days]` | Headless game with a scripted player, prints a JSON report |
| `pnpm sweep [seeds] [first] [open\|fort]` | Win rates of both scripted players over many seeds |

Every push to `main` runs the checks and publishes `apps/web/dist` to GitHub Pages. The build uses relative paths, so it runs from any folder.

## Controls

| Input | Action |
|---|---|
| WASD / arrows / screen edge | Move camera |
| Mouse wheel | Zoom |
| Right-drag, Q / E | Rotate camera |
| Left click / drag | Select (Shift adds) |
| Right click | Move · scavenge building · attack infected |
| Space | Pause · Shift+1–4 sets speed (pause, 1×, 2×, 4×) |
| Ctrl+1–9 / 1–9 | Form / select squad |
| F · H · Esc | Focus selection · return to base · cancel |
| F3 | Diagnostics (FPS, tick time, entities, draw calls, nav failures, memory) |

## Repository layout

```
apps/web            React + Zustand UI, input, main loop, IndexedDB saves, i18n (pt-BR default, en)
packages/shared     Seeded RNG, math, game clock constants
packages/content    Data: resources, buildings, structures, units, events, balance
packages/world      Procedural city generator, navigation grid (A*, distance fields), spatial hash, chunks
packages/core       Deterministic simulation: ECS-lite state, systems, commands, persistence, reports
packages/renderer   Three.js renderer: RTS camera, instanced buildings/units, day-night lighting, picking
tests/e2e           Playwright specs
tools               Headless runner; map-importer placeholder for the OpenStreetMap stage
docs                GDD, architecture, systems, roadmap, testing, decisions
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) to understand how the pieces fit, and [docs/ROADMAP.md](docs/ROADMAP.md) for what comes next.

## License

Code: AGPL-3.0-only (see `package.json`). Asset licensing will be defined separately. Future OpenStreetMap-derived maps will carry ODbL attribution.
