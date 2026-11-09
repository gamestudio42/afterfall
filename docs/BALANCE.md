# Balance notes

Measured with the scripted bot in `packages/core/tests/autoplay.ts` through `pnpm sweep`. The
simulation is deterministic, so the same seed and the same orders play out identically — which is
what makes an honest A/B between two configurations possible.

```sh
pnpm sweep 20 1                     # 20 seeds, both modes (open and fort)
pnpm sweep 20 1 fort craft,econ     # fort mode, workshop bot and economy bot
pnpm exec tsx tools/econ-probe.ts   # did the bot actually build it?
```

Each report line reads `seed:outcome@day s<survivors> k<infected killed> w<wood> a<ammo>
b<structures>`. **20 seeds carry roughly ±1 seed of noise**: a one-seed difference is not a signal.
Detecting five percentage points needs about 100 seeds per arm.

## Baseline (20 seeds, seeds 1–20)

| Arm | open | fort |
|---|---|---|
| Current bot (no workshop) | 14/20 (70%) | 17/20 (85%) |
| Survivors at the end (sum) | 57 | 69 |

**Fortification pays: 85% against 70%** on the same seed set, 15 percentage points. An earlier read
with 10 seeds (7/10 against 7/10) suggested the opposite; that was small-sample noise and the
larger sample corrects it.

The defeats are also structural rather than gradual: 4 of the 6 in open play are `hqDestroyed` on
day 6 (the dawn after the fifth night) and 2 are `allDead` on days 5 and 6; in fort mode all 3 are
`hqDestroyed`. And the fortified bot ends its defeats with `w0`: it spent every plank on ~47 wall
cells and has nothing left to repair with. Part of the day-6 failure may be repair economy rather
than weak defence.

## Experiment 1 — workshop and ammo (`craft`)

The bot never built a workshop, so the ammo recipe (`metal → ammo`) never ran during a sweep: any
conclusion about ammo measured the bot, not the game.

| Arm | open | fort |
|---|---|---|
| No workshop | 14/20 | 17/20 |
| Workshop (`craft`) | 15/20 | 17/20 |
| Workshop plus a cheaper, 66% larger recipe¹ | — | 17/20 |

¹ one-off: `ammoRecipe` from `{metal 2, ammo 12, work 40}` to `{metal 1, ammo 20, work 25}`,
reverted after the measurement and not shipped.

**Building a workshop improves the economy, not the outcome.** With a workshop, games ending with
zero ammo drop from 17/20 to 13/20 and the median survivors in open play rises from 2 to 4, yet wins
barely move (14→15 in open, 17→17 in fort).

**Ammo is not the bottleneck.** Three arms with very different ammo economies — no workshop, the
current recipe, and a much more generous one — all end at 17/20 in fort mode. If ammo decided the
match, the third arm would have moved.

## Experiment 2 — wall hit points (600 → 900): no gain

Same seed set, fort mode only, 20 simulations. The `wall` `maxHp` went from 600 to 900 and was
reverted after the measurement.

| | fort (wall 600) | fort (wall 900) |
|---|---|---|
| wins | **17/20** | **15/20** |
| survivors (sum) | 69 | 70 |
| defeats | seeds 1 (d4), 8 (d6), 10 (d6) | seeds 1 (d4), 4 (d5, allDead), 8 (d6), 10 (d5, allDead), 19 (d6) |

**There is no gain.** Two wins of difference at 20 seeds is inside the noise (a standard deviation
of about 2.6 seeds for a proportion), and the survivors sum — a continuous metric, far less noisy
than win/loss — came out essentially identical (69 against 70).

The interesting detail is the **change of cause**: with tougher walls, two new seeds die of
`allDead` (people dying) instead of `hqDestroyed`. The defence started holding the structure and
the cost showed up in the people. That is a lead for the next experiment, not a conclusion.

**Method consequence:** this instrument with 20 seeds does not decide differences of ~10 points.
To claim a balance effect, either raise the sample to 60–100 seeds per arm, or replace the binary
metric with a continuous one (survivors sum, mean day of death, infected killed). The survivors sum
has already proved to be the most stable of the three.

## Experiment 3 — a lighter final night (22/9/2 → 18/7/1): changes the cost, not the victory

Same 20 seeds, both modes. The night-5 horde became equal to night 4 and was reverted after the
measurement.

| | open | fort |
|---|---|---|
| wins | 14/20 → **15/20** | 17/20 → **18/20** |
| **survivors (sum)** | 57 → **81 (+42%)** | 69 → **86 (+25%)** |
| median survivors | 2 → 4 | 3 → 3 |

**The reading is the opposite of what the wins column suggests.** Weakening the last night moves
the win rate by one seed in each mode — noise. But the **survivors sum rises 42% in open play and
25% in fort mode**, and that is not noise: same sample, same seeds, same simulation.

In other words, the fifth night **is not the cliff for winning, it is the attrition dial**. It
decides how many people reach dawn, not whether you do. Defeats still happen on the same seeds and
for the same reasons (`hqDestroyed` on day 6, one `allDead` on day 5).

That has a direct consequence for design:

- To move **difficulty** (win or lose), the lever is not the size of the last horde. It is the
  earlier economy, structural defence, or nights 3–4.
- To move the **cost of the ending** (how many survive, how much the victory hurts), the last night
  is exactly the right place.
- And it confirms the method warning: **win/loss is a saturated metric** at this difficulty.
  Anyone looking only at the wins column would conclude "nothing changed" when the game changed a
  lot.

## Experiment 4 — economy (farm, well, second shelter): it feeds people and costs the match

The bot gained the `econ` option: it builds a farm and a well, and converts a second shelter when
beds are short. It only plants when there is spare material (wood ≥ 18 for the farm, ≥ 10 for the
well), because queueing without wood leaves the task `blocked` and stalls everything else.

Before measuring, `tools/econ-probe.ts` confirms the bot **really builds**: seeds 2, 3 and 5 come out
with `farms=1 wells=1`; seeds 1 and 8 build nothing because the match ends before wood reaches 18.
Without that check, "economy on" could mean nothing at all.

| | open | fort |
|---|---|---|
| wins | 14/20 → **6/20** | 17/20 → **17/20** |
| **survivors (sum)** | 57 → **79 (+39%)** | 69 → **77 (+12%)** |
| median survivors | 2 → 3 | 3 → 2 |
| defeat days | almost all on day 6 | 4, 6, 6 (the same seeds) |

**The economy feeds people and costs the match.** The survivors sum rises in both modes, but in
open play wins fall from 14 to 6, and defeats stop concentrating on day 6: they move to days 4 and
5. The bot that builds is not scavenging.

The reading is about **labour, not resources**: the farm requires one survivor working the whole
day (`farmRate` per worker-minute) and the well another. With 6–8 people at the start of a match,
pulling one or two off the street to plant is expensive, and the cost lands on defence and
scavenging, not on food.

Design implication: **producing food and water competes for the same scarce labour as scavenging.**
In this five-night slice that trade is bad. The levers to make it good are the farm's output per
worker-minute, how many workers it demands, or letting farm work happen at night, when nobody goes
out.

## Next experiments, in order

1. **Defence**: ~~wall hit points~~ (tested, no gain). What is left is tower damage and guard range.
2. **Fifth night**: ~~smaller horde~~ (tested: it moves survivors, not wins). If the goal is
   difficulty, the lever is the earlier economy or nights 3–4.
3. **Repair**: have the bot keep a wood reserve or repair below a threshold, to separate "weak
   defence" from "repair economy".
4. **Survival economy**: the bot now builds a farm and a well (`econ`), and the measurement shows the
   trade is bad: it feeds more people but costs wins in open play. The next step is the farm's output
   per worker-minute or night-time work, not hunger and water values.
5. **Instrument**: raise the sample to 60–100 seeds and report the survivors sum next to wins,
   otherwise 10-point differences stay indistinguishable from noise.

## What this document does not say

20 seeds per arm is enough to rule out large effects (10+ points) and not enough to claim small
ones. The conclusions above are: fortification matters (large), ammo does not decide (large), the
fifth night concentrates attrition (direct count, not statistics), and the economy costs wins in
open play (large). Anything smaller than that is still undecided.


## Campaign length and research (2026-11-09, `feat/campaign-research`)

The campaign moved from five nights to twelve, with the cure as the intended ending.
Four arms were measured with the scripted players over seeds 1-10. These are bot
numbers, not human playtest evidence, and ten seeds cannot resolve a difference under
ten points — that is why the research arm is reported as unresolved rather than as a
gain.

| arm | nights | wins | what happened |
|---|---|---|---|
| fort, craft+econ | 5 | 0 (7 of 10 alive at dawn of day 6) | the old slice no longer has a victory condition at five nights |
| fort, craft+econ | 12 | 2/10 | eight defeats between night 5 and night 12 |
| fort, craft+econ+research | 12 | 3/10 | one seed more; inside the noise of ten seeds |
| open, craft+econ | 20 | 0/10 | without a wall the base falls at night 4-9 |

**The mid-game is the wall, not the last night.** Bots that survive the first five
nights die between night 5 and night 12 in eight of ten seeds, and the traces show why:
`ammo` sits at 0 for most days, so the settlement fights the horde with crowbars. The
workshop recipe was raised from 12 to 30 rounds per 30 work and houses, apartments and
warehouses yield more metal, which moved the result by one seed — the bottleneck is
deeper than the recipe, and metal has to come from somewhere the player deliberately
goes: wrecks, garages, warehouses.

The cure itself works and is reachable: on seed 3 the research bot stood a lab up on
day 7, finished the tree by day 11 and won by cure on day 13 (`tools/campaign-probe.ts`).
It is not yet *reliably* reachable, and the tree's nodes were bought but not felt.

Next experiment, in this order: (1) measure with ammo granted at dawn to prove the ammo
hypothesis before changing content again; (2) if it holds, add metal nodes the player
must choose to visit (wrecks in the street, garage doors) rather than more metal in
houses; (3) then re-measure with 60 seeds per arm before claiming anything.
