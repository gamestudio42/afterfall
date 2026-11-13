# Game Design Document — AFTERFALL (MVP)

## Pitch
A real-time strategy colony survival game set in a city emptied by an outbreak. The city still stands but no longer works. The player reclaims it building by building.

Genre references: city builders, wave-defense RTS and survival sandboxes. AFTERFALL is an original game: its code, names, content, art and UI are its own.

The fantasy and the four pillars are in [PILLARS.md](PILLARS.md). The playtest
protocol and the current balance baseline are in [PLAYTEST.md](PLAYTEST.md).

## Core loop
1. **Choose a headquarters.** Any building can become the HQ. It holds 6 beds and 600 storage and keeps half of what was inside.
2. **Day (06:00–17:00): scavenge and build.** Send survivors into buildings. Disturbing a building releases the infected hiding inside. Searching reveals loot, which survivors carry home (20 weight each). Workers automatically pick up construction, conversion, repair, farm and workshop jobs.
3. **Dusk (17:00–20:00): get home.** Scavengers are recalled at 17:00 (policy). Lookouts man the towers.
4. **Night (20:00–06:00): hold.** Survivors sleep in beds. Hordes enter from the city edge in waves from 21:00; later nights add waves at 23:30 and 02:00. Some roaming infected are drawn to the settlement at 20:00. Infected follow a distance field to the HQ, breaking the weakest walls in their path. When the base is attacked, armed sleepers wake up and defend.
5. **Dawn: count the cost.** Medicine cures infections and treats the wounded, morale settles, the game autosaves and the surviving horde retreats.

Victory: the cure, or dawn of day 13 (twelve nights). Defeat: the HQ falls or
everyone dies.

## Research and the cure

Searching a school, hospital, police station, office or pharmacy yields research
points once the search completes, and a **laboratory** — an office, school or
hospital converted to it — earns research every game hour and hosts the cure
project. Twelve nodes in four branches buy capabilities, not multipliers: cheaper
meals, deeper wells, bigger packs, faster repairs, a forge that doubles ammo, more
loot, a deeper ammo reserve, better aim, floodlit towers, a one-dose serum, faster
lab work, and finally the cure itself. The cure costs 12 medicine and 12 research,
then advances one step per dawn while its lab still stands: three dawns of holding a
building the player chose to defend. The ledger panel reports what the last closed
day produced and consumed, and how many days of each resource remain.

## Decisions with cost and risk
- **Scavenge far or near?** Hospitals and police stations are rich but full of infected. Nearby houses are safe but poor.
- **Shoot or not?** Gunfire kills fast but makes noise (45 m for a pistol), drawing more infected.
- **Walls or housing?** Wood builds walls (3 per 2 m) and shelters (8). Survivors without a bed sleep outside, lose morale and are exposed.
- **Who works?** Automatic units take jobs. Manual units obey you until you return them to automatic work.

## Content (MVP)
- **Resources:** food, water, wood, metal, ammo, medicine, firearms.
- **Buildings:** house, apartment, shop, supermarket, pharmacy, office, warehouse, gas station, hospital, school, police. Each type has its own loot table, hidden infected and chance of survivors inside.
- **Adaptations:** shelter (beds), storage (capacity), workshop (metal → ammo, with a "keep ammo at N" policy).
- **Structures:** wall, gate (survivors pass, infected do not; can be set into a finished wall, which stands until the gate is done), watchtower (+7 m range, guard is unreachable while it stands), garden (food), well (water).
- **Placing walls and gates:** drag to draw a straight run at any angle; every piece keeps the drawn angle, so walls follow the streets of imported real places. A single wall or gate lines up with the wall it joins, else the nearest street; R / Shift+R turns it by 15°.
- **Infected:** walker, runner, brute. States: idle, wander, investigate (noise), chase, assault, retreat.
- **Events:** refugees at the gate, wandering trader, radio cache, storm, accident. All data-driven.

## Survivors
Each survivor has health, hunger, fatigue, morale, an infection state and skills (combat, construction, medicine, farming, scavenging), which improve with use. Work efficiency = health × fatigue × morale × hunger × skill. A bite has an 8% chance to infect. Without 2 medicine at dawn, the infection progresses until the survivor turns.

## Balance targets
See `packages/content/src/balance.ts`. Two scripted players are used for regression (`pnpm sweep`):

- **open**: picks a large central HQ, scavenges, converts a shelter and builds two towers. No walls.
- **fort**: picks a compact HQ and also rings it with walls and a gate on day one.

Over seeds 1 to 40, open wins about 72% and fort about 78%. Most defeats happen on night 5, so the last night is the climax. The sweep options `craft` and `econ` make the bots build a workshop or a farm, a well and a second shelter. Measured with them, ammo is **not** the bottleneck (a workshop moves wins by at most one seed) and the farm and well cost wins in open play, because they take labour from scavenging. Difficulty has to come from the early economy, structural defence or nights 3–4; the fifth night sets how many survive, not whether you win. See [BALANCE.md](BALANCE.md).

The last recorded sweep (2026-10-31, `main` at `02c8d10`, `pnpm sweep 40 1`)
gave **open 29/40 (72.5%)** and **fort 31/40 (77.5%)**. This is a scripted
regression baseline, not human playtest evidence; see [PLAYTEST.md](PLAYTEST.md).

## Character presentation

Survivors have shaped faces, hair, layered field jackets, packs, boots and visible
crowbars, pistols or rifles. Clothing and skin palettes vary deterministically by
entity, while selection and infection remain readable. Walkers drag an uneven
step, runners use a separate running cycle, and brutes have a broader silhouette.
Distance-driven, continuously blended poses cover locomotion, breathing, aiming,
melee and hit reactions; simulation time freezes them when paused. This serves
community identity (pillar 4) and readable threats during scavenging and defense
(pillars 2–3). These are presentation changes; attack timing, damage, movement
speed, collision, saved state and the economy are unchanged.
