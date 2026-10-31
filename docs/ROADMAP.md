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

## Done — real maps (OpenStreetMap)
- [x] Importer in `@afterfall/world` (`cityFromOverpass`): real building outlines, types from tags and points of interest, floors from `building:levels` or `height`, road center lines, parks, doors facing the nearest street, horde entry points where streets leave the map
- [x] Simulation, navigation and window fire on polygon footprints; saves embed the imported map
- [x] Extruded footprints in the renderer, outline selection, roads as ribbons, polygon minimap
- [x] New game: preset places, address search (Nominatim), area size, download from Overpass with browser cache, ODbL attribution in game

## Next
1. **Balance with real play.** Follow [PLAYTEST.md](PLAYTEST.md) to collect human playtests; teach the bots to craft ammo; tune toward a target win rate per difficulty.
2. **Region overlays** (logistics, power).
3. **Real maps, next steps.** A map view (MapLibre) to pick the area by dragging, water and rail, multipolygon buildings with courtyards, a road graph for long trips on large areas, and an offline importer for bigger regions.
4. **Logistics and policies:** hauling between storages, "keep N food" policies, priority UI for tasks.
5. **Research tree** (survival, construction, energy, defense, society).
6. **Energy and water networks**, vehicles.
7. **Performance:** chunk streaming and LOD for large imported cities, simulation in a Web Worker, aggregated distant hordes.
8. **Settlements and diplomacy:** the "rebuild society" stage.
