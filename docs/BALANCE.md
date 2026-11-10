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


## Campaign length and research (2026-11-09, merged in #42)

The campaign moved from five nights to twelve, with the cure as the intended ending.
Measured with the scripted fort player over seeds 1-10: **3/10 wins with research,
2/10 without**, which is inside the noise of ten seeds and is recorded as unresolved,
not as a gain. A first pass blamed ammo starvation and raised the workshop recipe; a
second pass blamed metal and halved its price. Both were wrong, and the probe that
disproved them is the part worth keeping.

### What the trace actually shows

`tools/campaign-probe.ts <seed> <days> <plain|research|full>` prints one seed day by
day. On seed 3 the workshop produces **5,550 rounds over twelve days** while metal
sits between 30 and 104 in storage: `ammo 0` in the sweep rows is the *stock at dawn*,
not the supply, because the rounds are made and spent the same day. Ammo is therefore
not the constraint, and neither is the recipe (metal 2 vs 1 changed 3/10 to 3/10 on the
same seeds, seed for seed).

What kills the colony is the night. On seed 7 the population falls 4 → 1 between day 2
and day 7 with `convert:blocked` for days: the scripted player walls the base in on day
one, spends all forty wood on the ring, and never stands a workshop up. That is a flaw
in the instrument, not in the game, and it is why the sweep rows were read as "no
ammo": no workshop means no rounds at all.

### The instrument cannot answer this yet

The scripted player is a five-night player. Beyond that it starves one resource to
build another — walls or conversions, never both — and its result is dominated by that
ordering rather than by the curve. Two runs of the same arm with only the build order
changed moved the win rate from 3/10 to 2/20 and removed the walls entirely (3-4
structures per seed, all towers).

So the next step is **not** another content change. It is either a human playtest
(`docs/PLAYTEST.md`), which is what the roadmap already asks for, or a bot that keeps a
reserve for the next conversion — the second is a real piece of work, and building it
only to tune a curve nobody has played is the wrong order.

Kept from the experiment: `ammoSubsidy` in the autoplay options, so "would more ammo
change this?" can be answered in one run instead of a rule change.

### The reservation bot made it worse (2026-11-09)

The next attempt was a scripted player that keeps material back for its next goal: one
build decision at a time, an explicit reserve of wood and metal, scavenging aimed at
the building type the settlement needs (knowledge while a tech is unaffordable, metal
when storage is under twenty, medicine under four), and two towers before the wall
ring.

Measured over seeds 1-20, twelve nights: **2/20 with research and 1/20 without**,
against 3/10 and 2/10 for the simple player. Worse, and the trace says why: the two
towers cost twenty-four wood, the ring costs about forty more, and the ring never
became affordable again. The reservation traded "no workshop" for "no wall", and no
wall is the worse trade — the base falls on night five to seven instead of ten to
thirteen.

Two more levers were tried against the same baseline and also failed:

- **Pausing the workshop while a conversion is short of metal** (the bot setting
  `keepAmmo` to zero, the way a player pauses production). Ammo stops, the horde walks
  in, the headquarters falls on night five.
- **A cheaper recipe** (metal 1 for 60 rounds instead of 2 for 30). The workshop stops
  competing with construction, but the settlement spends the savings on nothing: the
  same defeats, one night earlier.

The conclusion is not a number, it is about the instrument. Metal is the single
currency that ammo, towers, walls and every conversion draw on, and the city's supply
is finite: over twelve nights the stock never rose above its starting twelve. Any
ordering that fixes one shortage creates another, and each measurement costs ten
minutes. **A campaign cannot be tuned by hand-written heuristics in `autoplay`.** The
honest options are a human playtest, or a bot with a real strategy layer (goal queue
with affordability and a wall step that is taken once, not conditionally) — and that
second one is a project, not a tweak.
