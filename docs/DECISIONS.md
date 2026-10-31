# Architectural decisions

1. **Three.js over Babylon.js.** We need direct scene control, instancing and procedural geometry, not a full engine. Only one 3D library is used.
2. **Component-bag ECS instead of an ECS library.** Entities are plain objects with optional components. They are trivially serializable and fast enough for hundreds of agents. Archetype storage can be revisited if profiling demands it.
3. **Grid navigation (2 m cells) instead of a road graph for the MVP.** The procedural city is small (420 × 352 m, about 37k cells), so A* is cheap, and the same grid handles walls, gates and local movement. A road graph layer for long trips is planned with real maps.
4. **Shared distance field for hordes** instead of per-agent A*. Walls have a cost proportional to their HP, so hordes pick a breach point emergently, with no cheating spawns inside the base. The field is recomputed only when the grid version changes. Full recomputation is about 2 ms today. Region-local invalidation is a planned optimization for large maps.
5. **Global stock with physical storage nodes.** Each storage building holds its own stock, and workers physically carry materials from storage to sites. The HUD shows totals. Tower guards are resupplied abstractly.
6. **Renderer reads simulation state directly** (read-only) instead of copying snapshots. This is simpler and allocation-free. The command queue still enforces one-way mutation.
7. **No Web Worker yet.** The simulation costs well under 1 ms per frame. The core is DOM-free, so moving it to a worker later is mechanical.
8. **Time freezes while an event card is open or before a base is chosen**, so the player is never punished for reading.
9. **Units are drawn about 1.9× life size** so they read at strategic zoom levels.
13. **Pages from the `gh-pages` branch, with PR previews.** GitHub Pages serves a single site, so `main` is published to the branch root and each pull request to `pr-preview/pr-<number>/` in the same branch (`rossjrw/pr-preview-action`). The main deploy keeps that folder, and a closed PR removes its own.
