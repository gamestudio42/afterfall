# Game Design Document — AFTERFALL (MVP)

## Pitch
A real-time strategy colony survival game set in a city emptied by an outbreak. The city still stands but no longer works. The player reclaims it building by building.

Genre references: city builders, wave-defense RTS and survival sandboxes. AFTERFALL is an original game: its code, names, content, art and UI are its own.

## Core loop
1. **Choose a headquarters.** Any building can become the HQ. It holds 6 beds and 600 storage and keeps half of what was inside.
2. **Day (06:00–17:00): scavenge and build.** Send survivors into buildings. Disturbing a building releases the infected hiding inside. Searching reveals loot, which survivors carry home (20 weight each). Workers automatically pick up construction, conversion, repair, farm and workshop jobs.
3. **Dusk (17:00–20:00): get home.** Scavengers are recalled at 17:00 (policy). Lookouts man the towers.
4. **Night (20:00–06:00): hold.** Survivors sleep in beds. Hordes enter from the city edge at 21:00, 23:30 and 02:00, and some roaming infected are drawn to the settlement at 20:00. Infected follow a distance field to the HQ, breaking the weakest walls in their path. When the base is attacked, armed sleepers wake up and defend.
5. **Dawn: count the cost.** Medicine cures infections and treats the wounded, morale settles, the game autosaves and the surviving horde retreats.

Victory: dawn of day 6 (five nights). Defeat: the HQ falls or everyone dies.

## Decisions with cost and risk
- **Scavenge far or near?** Hospitals and police stations are rich but full of infected. Nearby houses are safe but poor.
- **Shoot or not?** Gunfire kills fast but makes noise (45 m for a pistol), drawing more infected.
- **Walls or housing?** Wood builds walls (3 per 2 m) and shelters (8). Survivors without a bed sleep outside, lose morale and are exposed.
- **Who works?** Automatic units take jobs. Manual units obey you until you return them to automatic work.

## Content (MVP)
- **Resources:** food, water, wood, metal, ammo, medicine, firearms.
- **Buildings:** house, apartment, shop, supermarket, pharmacy, office, warehouse, gas station, hospital, school, police. Each type has its own loot table, hidden infected and chance of survivors inside.
- **Adaptations:** shelter (beds), storage (capacity), workshop (metal → ammo, with a "keep ammo at N" policy).
- **Structures:** wall, gate (survivors pass, infected do not), watchtower (+7 m range, guard is unreachable while it stands), garden (food), well (water).
- **Infected:** walker, runner, brute. States: idle, wander, investigate (noise), chase, assault, retreat.
- **Events:** refugees at the gate, wandering trader, radio cache, storm, accident. All data-driven.

## Survivors
Each survivor has health, hunger, fatigue, morale, an infection state and skills (combat, construction, medicine, farming, scavenging), which improve with use. Work efficiency = health × fatigue × morale × hunger × skill. A bite has an 8% chance to infect. Without 2 medicine at dawn, the infection progresses until the survivor turns.

## Balance targets
See `packages/content/src/balance.ts`. Two scripted players are used for regression (`pnpm sweep`):

- **open**: picks a large central HQ, scavenges, converts a shelter and builds two towers. No walls.
- **fort**: picks a compact HQ and also rings it with walls and a gate on day one.

Over seeds 1 to 40, open wins about 72% and fort about 78%. Most defeats happen on night 5, so the last night is the climax. Neither bot builds a workshop, so ammo is their binding constraint; a player who crafts ammo should do better.
