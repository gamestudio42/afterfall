# Roadmap

## Done — MVP vertical slice (phases 1–6)
- [x] Phase 1: procedural city (about 30 blocks, about 100 buildings), RTS camera, building selection and info panel, day and night lighting
- [x] Phase 2: survivors, box selection, squads, click-to-move, A* pathfinding, health indicators
- [x] Phase 3: loot, scavenging with ambushes, carrying, storage and stock HUD
- [x] Phase 4: building conversion, walls, gates, towers, farms, wells, task automation, food and water, beds
- [x] Phase 5: walkers, runners and brutes, perception and noise, hordes with weakest-wall pathing, combat with ammo, structure destruction, retreat
- [x] Phase 6: clock and speeds, night waves, alerts, events, policies, save/load and autosave, victory and defeat, main menu, pt-BR and en

## Next
1. **Balance pass with real play.** Tune horde sizes, loot density and wall costs. Add a second scripted player that builds walls, for regression.
2. **Minimap and region overlays** (logistics, power).
3. **Real maps (OpenStreetMap).** `tools/map-importer` (Python) produces a `GameMap` package (buildings, roads, POIs) that `@afterfall/world` turns into the same `CityMap` shape. MapLibre is used only for region picking. Keep ODbL attribution and cache imports, never hitting public Overpass at scale.
4. **Logistics and policies:** hauling between storages, "keep N food" policies, priority UI for tasks.
5. **Research tree** (survival, construction, energy, defense, society).
6. **Energy and water networks**, vehicles.
7. **Performance:** chunk streaming and LOD for large imported cities, simulation in a Web Worker, aggregated distant hordes.
8. **Settlements and diplomacy:** the "rebuild society" stage.
