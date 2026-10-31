# Working on AFTERFALL (for humans and coding agents)

- Read `docs/PILLARS.md` and `docs/PLAYTEST.md` before a player-facing change or balance work.
- Keep `@afterfall/core` free of DOM, Three.js and React. Add gameplay through systems and commands, and add data to `@afterfall/content`.
- Never use `Math.random()` in the simulation. Use `sim.rng`.
- Player-facing strings go through i18n keys (`apps/web/src/i18n`, pt-BR first, then en).
- Before claiming a feature works: run `pnpm typecheck && pnpm test && pnpm test:e2e`, and look at it in the browser.
- Package ownership for parallel work: world (generation and navigation), core (gameplay), renderer (visuals), web (UI). Cross-package changes go through the public `index.ts` exports.
