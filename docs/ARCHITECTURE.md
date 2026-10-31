# Architecture

```
USER INPUT ─▶ GameController ─▶ Command queue ─▶ Simulation.tick() ─▶ GameState
                                                                    │
                       React panels (read, 5×/s)  ◀────────────────┤
                       GameRenderer (read, every frame, interpolated)◀┘
```

## Principles
1. **Simulation is independent from rendering.** `@afterfall/core` has no DOM, Three.js or React imports and runs headless in Node.
2. **Fixed timestep.** One tick = 100 ms of real time at 1× (`SIMULATION_TICK_MS`). Speed changes the number of ticks per frame, never the tick size. Catch-up is capped per frame.
3. **Determinism.** All randomness goes through a serialized mulberry32 `Rng`. `Math.random()` is never used in the simulation. The same seed and commands give the same `stateHash` (tested).
4. **Commands, not mutations.** The UI enqueues `Command`s, which are applied at the start of the next tick. Queued commands are also drained while time is frozen (a pause or a pending event) so a UI decision never waits for a tick; draining does not advance the clock.
5. **Data-driven content.** Loot tables, structures, weapons, infected, events and balance live in `@afterfall/content`. Player-facing text lives only in `apps/web/src/i18n`, and the simulation emits keys and parameters.

## Packages
| Package | Responsibility | Depends on |
|---|---|---|
| shared | RNG, math, clock | — |
| content | Game data | shared |
| world | City generation, OpenStreetMap import, NavGrid, SpatialHash, chunks | shared, content |
| core | Simulation, systems, persistence, reports | shared, content, world |
| renderer | Three.js scene from a Simulation | core, world, content |
| apps/web | UI, input, loop, saves, i18n | all |

## ECS-lite
`GameState.entities` is a `Map<id, Entity>`, where an entity is an id plus optional components (`transform`, `health`, `mover`, `survivor`, `infected`, `structure`). Systems iterate entities that have what they need. Map-aligned data (buildings) and tasks are plain arrays and maps. Everything is JSON-serializable.

Tick order: commands → hashes → tasks → survivors → infected → movement → combat → economy → events → clock → outcome.

## Navigation
- **NavGrid** (2 m cells): buildings are stamped from the city, and structures are stamped at runtime (`version` bumps invalidate cached paths and fields).
- **Survivors:** A* (8-way, no corner cutting) with string-pulling. They replan when the grid version changes and the next segment is blocked, or when stuck.
- **Infected:** chase with direct steering when the line is walkable, otherwise A* with a limited budget, staggered. Hordes descend a shared Dijkstra **distance field** to the HQ in which walls are expensive but passable, so a horde chooses the weakest line and attacks the structure blocking its next cell. A second field leads to the map edge for retreats.
- Building doors are explicit entrance cells, so nobody walks to a building's geometric center.

## Rendering
Buildings, roofs, units, heads, health bars, structures and blueprints are `InstancedMesh`es with per-instance color, which keeps the draw call count around 20 to 30. Ground and roads are merged static geometry. Lighting follows the game clock: a directional sun or moon with shadows that follow the camera, a hemisphere light, window glow and a warm HQ light at night. Positions are interpolated between ticks with `Simulation.alpha`.

## Persistence
`serialize()` produces a versioned `SaveGame` (state, RNG state and tick) and `deserialize()` validates, migrates and rebuilds the grid from the seed and the structures. The web app stores slots in IndexedDB (`autosave` at dawn, `manual`).
