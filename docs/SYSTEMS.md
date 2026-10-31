# Systems reference

| System | File | Summary |
|---|---|---|
| Tasks | `core/src/systems/tasks.ts` | Central job board. Build, convert, repair, farm, craft and guard tasks with priority, max workers, cost, delivered and in-transit resources. Idle automatic survivors are matched by priority, skill and distance. Workers fetch from the nearest storage, deliver to the site, then work. Wall lines complete segment by segment as delivered materials allow. It auto-creates repair tasks below the policy threshold and pauses crafting at the ammo target. Guards man towers from 17:00 to 07:00 and climb down to defend when the base is attacked out of their tower's reach. |
| Survivors | `systems/survivors.ts` | Activity state machine: idle, move, scavenge (going → clearing → searching → hauling), task, sleep, attack, flee, returnBase, defend. Also covers needs, infection, self-preservation retreat, rallying to defend the HQ and the night bed schedule. |
| Infected | `systems/infected.ts` | Perception (vision with LOS, larger at night), noise response, chase, horde assault along a distance field, structure and HQ attacks, dawn retreat, horde spawning schedule, dusk rally. |
| Movement | `systems/movement.ts` | Path following, axis-sliding collision, stuck detection and replanning, infected separation. |
| Combat | `systems/combat.ts` | Auto-targeting of the nearest visible infected, ammo, accuracy by skill, tower bonus, noise, XP. Armed survivors inside a settlement building fire from its windows (80% range, 85% accuracy) and restock from it when it stores ammo; at night they hold the building instead of going out. |
| Economy | `systems/economy.ts` | Meals at 07:00 and 19:00, wells, dawn medicine, morale drift, low-stock and idle alerts. |
| Events | `systems/events.ts` | Possible event at 09:00 with conditions, weights and cooldowns. Choices apply data-defined effects. A pending event auto-resolves with the last choice after 2 game hours. |
| Outcome | `systems/outcome.ts` | Victory at dawn of day 6. Defeat when the HQ falls or everyone dies. |
