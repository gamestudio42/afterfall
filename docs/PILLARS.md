# Design pillars and core loop

These pillars are inferred from the current playable slice. They are not a
marketing list: each one is a promise the build must keep in play. Revise them
only with playtest evidence, and say what changed.

## Fantasy

You are the person who keeps a handful of survivors alive long enough to make
one building, then one street, work again. The city is not a backdrop: it is
the thing you reclaim, block by block, while the night tries to take it back.

## Pillars

### 1. Reclaim the city one building at a time

Every building is a decision: home, storage, workshop, shelter or wall. The
player should feel the settlement grow out of the map, not out of a menu.

- Loop beat: choose the headquarters, adapt buildings, place structures.
- Promise: progress is visible on the map and survives the night.
- Violated when: a building becomes a generic stat bonus, or the map stops
  mattering after the first minute.

### 2. The night is a promise, not a timer

The player should read the day as preparation for a specific night. Hordes
arrive on the map, choose a line, break the weakest wall and are answered by
the defenses the player built.

- Loop beat: build defenses, recall survivors, hold the night, count the cost.
- Promise: the night is legible and attributable; the player can say what
  failed and why.
- Violated when: an attack is an unexplained stat check, or the best answer is
  always to wait behind the same wall.

### 3. Every trip out is a risk/reward decision

Scavenging far, rich and dangerous should compete with scavenging near, poor
and safe. Gunfire, hidden infected, carry weight and the 17:00 recall all turn
the same verb into a cost.

- Loop beat: scavenge, clear, search, haul, return before dusk.
- Promise: the player chooses greed or safety with enough information to own
  the result.
- Violated when: there is one obviously correct route, or danger is random
  without a telegraph.

### 4. The community is the resource

Survivors are not interchangeable tokens. Health, hunger, fatigue, morale,
skills, infection and beds make the group the thing being managed, not just
the thing being moved.

- Loop beat: feed, rest, treat, train, assign work, recover at dawn.
- Promise: the player feels the cost of a death and the value of a survivor
  who has grown into a role.
- Violated when: survivors are only numbers, or a loss is invisible in the
  next minute.

## Core loop

1. **Choose**: pick a building to become the headquarters.
2. **Scavenge**: send survivors into the city; disturb the infected inside.
3. **Build**: adapt buildings, place walls, gates, towers, gardens and wells.
4. **Return**: bring the haul home before dusk.
5. **Hold**: survive the night waves and the noise the defense makes.
6. **Count**: treat wounds, cure infections, settle morale, autosave, repeat.

## Feature mapping

| Feature | Pillar | Loop beat |
|---|---|---|
| Headquarters choice, conversion and storage | 1 | Choose / build |
| Loot tables, hidden infected, carry weight | 3 | Scavenge |
| Walls, gates, towers and gunfire noise | 2, 3 | Build / hold |
| Beds, food, water, medicine, morale and skills | 4 | Dawn / hold |
| Refugees, trader, radio cache, storm and accident | 4 | Day / dawn |
| OpenStreetMap places and real footprints | 1 | Choose |
| Dawn autosave and the five-night victory | 4 | Count |

## Out of scope for this slice

Research, diplomacy, vehicles, energy and water networks, chunk streaming and
large-region logistics are roadmap items, not current pillars. They should not
be added until a pillar needs them and a playable slice can prove them.

## Using this document

- Before a player-facing change, name the pillar and the loop beat it serves.
- State the hypothesis in `docs/PLAYTEST.md` before changing feel or balance.
- If a feature serves none of these pillars, cut it or recast it.
- If playtest evidence contradicts a pillar, update this document instead of
  leaving the build and the design note disagreeing.
