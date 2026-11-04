# Roadmap

## Done — MVP vertical slice (phases 1–6)
- [x] Phase 1: procedural city (about 30 blocks, about 100 buildings), RTS camera, building selection and info panel, day and night lighting
- [x] Phase 2: survivors, box selection, squads, click-to-move, A* pathfinding, health indicators
- [x] Phase 3: loot, scavenging with ambushes, carrying, storage and stock HUD
- [x] Phase 4: building conversion, walls, gates, towers, farms, wells, task automation, food and water, beds
- [x] Phase 5: walkers, runners and brutes, perception and noise, hordes with weakest-wall pathing, combat with ammo, structure destruction, retreat
- [x] Phase 6: clock and speeds, night waves, alerts, events, policies, save/load and autosave, victory and defeat, main menu, pt-BR and en

## Done — balance pass and minimap
- [x] Second scripted player that walls the base in, and a seed sweep tool (`pnpm sweep`)
- [x] Window fire from settlement buildings, tower guards that help when the attack is out of reach
- [x] Cheaper walls, stronger nights 4 and 5, a little ammo in homes
- [x] Clickable minimap
- [x] GitHub Actions CI (typecheck, unit tests, build, E2E) and GitHub Pages deploy from `main`
- [x] Linux desktop shell (Electron) packaged as a snap, with a CI smoke test

## Done — real maps (OpenStreetMap)
- [x] Importer in `@afterfall/world` (`cityFromOverpass`): real building outlines, types from tags and points of interest, floors from `building:levels` or `height`, road center lines, parks, doors facing the nearest street, horde entry points where streets leave the map
- [x] Simulation, navigation and window fire on polygon footprints; saves embed the imported map
- [x] Extruded footprints in the renderer, outline selection, roads as ribbons, polygon minimap
- [x] New game: preset places, address search (Nominatim), area size, download from Overpass with browser cache, ODbL attribution in game

## Done — sound, impact effects and a balance instrument
- [x] `@afterfall/audio`: sound table and event mapping kept pure, a director that reads `sim.fx` and `sim.state.alerts`, 9 effects, 2 ambience beds with crossfade, voice caps, minimum interval per sound, volume and mute in the HUD persisted in `localStorage` (decision 19)
- [x] Impact particles instanced from the same events as the sound: one `InstancedMesh`, additive blending as the fade, no texture file, deterministic RNG (decision 20)
- [x] Bots that build a workshop and an economy (farm, well, second shelter), a sweep that takes its options (`pnpm sweep 20 1 fort craft,econ`), a probe that proves the bot really builds, and `docs/BALANCE.md` with four measured experiments
- [x] Chromium flags against timer throttling in background tabs, so the frame-dependent E2E specs stopped being flaky

## Next
1. **Balance with real play.** Follow [PLAYTEST.md](PLAYTEST.md) to collect human playtests and set a target win rate per difficulty. The scripts can already craft ammo and build an economy, and the measurements say ammo is **not** the bottleneck: difficulty has to come from the early economy, structural defence or nights 3–4, not from the last horde (see [BALANCE.md](BALANCE.md)). Any claim smaller than ten points needs 60–100 seeds per arm.
2. **Region overlays** (logistics, power).
3. **Real maps, next steps.** A map view (MapLibre) to pick the area by dragging, water and rail, multipolygon buildings with courtyards, a road graph for long trips on large areas, and an offline importer for bigger regions.
4. **Logistics and policies:** hauling between storages, "keep N food" policies, priority UI for tasks.
5. **Research tree** (survival, construction, energy, defense, society).
6. **Energy and water networks**, vehicles.
7. **Performance:** chunk streaming and LOD for large imported cities, simulation in a Web Worker, aggregated distant hordes.
8. **Settlements and diplomacy:** the "rebuild society" stage.

## Next — art and asset pipeline (ArtCraft apps and Blender)

Today every surface is a flat colour and every shape is a primitive: buildings are `MeshStandardMaterial` with vertex colours, the city is merged geometry, trees are two instanced meshes, and the only texture in the project is a 64 px radial gradient drawn to a canvas at runtime. That is a coherent look, but it is the ceiling of it. The tools to go past it are installed and have already produced measured results.

Two constraints learned the hard way, and they shape every item below:

- **No video with alpha reaches either engine.** Godot 4.7.2 has no `VideoStreamWebm`, and an OGV transcode loses alpha (`Requested planes not available`). Anything animated goes PNG sequence → atlas → flipbook, never a video file.
- **No asset enters the repository unverified.** Every render carries `ffprobe` metadata, an alpha measurement and a `sha256` in a `manifest.json`; a render once claimed by an agent was fabricated and left no file on disk.

Ordered by visual gain per unit of risk:

1. **Surface textures in one atlas.** Asphalt, concrete, facade, rust, grass. This is the largest visual jump available: the geometry is already merged, so a `map` on the existing materials adds no draw call. Risk: texture memory and UV seams on merged geometry, solved with an atlas addressed in world coordinates.
2. **Flipbook impact effects.** Replace the procedural radial gradient with the `hit_sparks_final` render that already exists (400×400, 30 fps, 1.0 s, 250 KB, peak coverage 7.62% of the frame). Same `InstancedMesh`; the change is a texture atlas plus frame selection by age. The current procedural burst covers 0.081% of the screen, roughly ninety times less visible.
3. **Low-poly prop kit in Blender.** Abandoned car, dumpster, fence, sign, lamp post, barricade — 100–500 triangles each, instanced the way trees already are. Props are what make the city read as *abandoned* instead of *empty*.
4. **Survivors with a real silhouette.** The eight-view atlas of the walker (1024×128, `walker.glb` at 244 triangles and 21 KB) already exists. Billboard atlas at distance versus GLB up close is a decision to measure — draw calls and frame time with forty survivors on screen — not a matter of taste.
5. **Night look development.** Cheap bloom on emissive materials (windows, torches, infected eyes), denser fog, moonlight. The five nights are the heart of the game and this is the item that changes how they feel. Measure the frame cost before and after; bloom is the easiest way to lose 60 fps.
6. **HUD and minimap.** Vector icons, map markers and survivor portraits. Cheap, and it is the first thing a new player sees.
7. **A pipeline with a contract.** `manifest.json` with dimensions, fps, duration, `sha256` and version, plus a CI check that rejects an asset without a measured alpha channel, over the byte budget, or outside the atlas convention. Today this lives as a habit in a staging directory, not as a rule the repository enforces.

## Budget

Every art item above has to be measured against a declared ceiling, otherwise "looks better" wins every argument:

- **Initial payload ≤ 1.5 MB.** The JS bundle is 869 kB raw and 245 kB gzip today; atlases are shared and tiled, and nothing ships per object.
- **60 fps at 1080p** with about 100 buildings, forty survivors and one night horde. Shadows, bloom and particle counts are the three knobs that move this number.
- **Audio and large textures stay out of the bundle:** sound streams from `public/sfx` (372 KB), and no texture over 64 kB is inlined.
- An asset that cannot be measured against these numbers does not ship.
