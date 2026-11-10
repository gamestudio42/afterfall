# Playtest and balance protocol

A design change is a hypothesis. This file records what we expect, what we
actually saw, and whether we keep, change or cut the change. Headless tests
validate behavior; they do not validate feel.

## Before a session

Write these down before touching the build:

- **Pillar and loop beat**: which pillar in `docs/PILLARS.md` this session is
  about, and which beat of the core loop it changes.
- **Hypothesis**: what the player should do or feel differently.
- **What to watch**: completion time, failure point, resources left, a quote
  about confusion, or a specific decision the player makes.
- **Revert condition**: the result that would make us undo the change.

## Session script

Use the same slice for every comparison unless the change is about the slice
itself:

1. New game, generated city, seed recorded.
2. Choose a headquarters without being told which one is best.
3. Play until the first night is resolved or the run is lost.
4. Ask the player to explain what went wrong or right before showing any
   numbers.
5. Record the day reached, survivors alive, resources left, and the first
   moment of confusion.

Do not coach the player through the first minute. If the slice needs a
paragraph of explanation, that is a pacing finding, not a tutorial success.

## Observation log

Keep observations and interpretations in separate sentences:

- **Observed**: what happened, without explaining why.
- **Interpreted**: why we think it happened.
- **Decision**: keep, change again, or cut.
- **Evidence**: day, survivors, stock, failure point, quote, build/commit.

Do not treat the designer's own best run as the target. Say who played and
whether they already knew the system.

## Current baseline

### Scripted balance sweep

- Date: 2026-11-09
- Base: `main` after #42 (campaign, research and the cure)
- Command: `pnpm sweep 10 1 fort craft,econ,research 12` and the same without `research`
- Seeds: 1 through 10, twelve nights
- Result: **3/10 with research, 2/10 without**. One seed of difference is inside the
  noise of ten seeds, so the tree is recorded as unresolved, not as a gain.
- Caveats that matter more than the number: the scripted player is a five-night player.
  Its build order trades walls for conversions and never both, and a trace of one seed
  (`tools/campaign-probe.ts`) shows it spending the first day's wood on a wall ring and
  then leaving every conversion blocked for days. Three attempts to give it a strategy
  layer (a reservation, a paused workshop, a cheaper ammo recipe) all measured worse and
  are recorded in `docs/BALANCE.md`. **The sweep cannot answer whether the campaign is
  fun, fair, or even the right length.**

Historical: the five-night slice measured **open 29/40 (72.5%)** and **fort 31/40
(77.5%)** on 2026-10-31 (`main` at `02c8d10`). Those numbers belong to a game that ended
at dawn of day 6 and are kept only as a regression baseline for the first five nights.

### Human sessions

No human playtest has been recorded yet. The roadmap lists "balance with real
play" as the next step. Until a session is logged here, do not claim that the
game is fun, too hard, or too easy.

## Campaign session script (12 nights)

The next open question is not a number, it is whether twelve nights with a cure hold a
player's attention and feel fair. One session answers more than a sweep:

1. **Setup.** New game, generated city, seed written down. Difficulty untouched.
2. **Play, uncoached.** Do not say where the research panel is, do not say the lab exists.
   Stop at the first defeat, at the cure, or at dawn of night 13.
3. **Ask the ledger to be opened** at dawn of nights 3, 6 and 9 and read out loud: what
   the last day produced, what it consumed, and which resource has the fewest days left.
4. **Ask one question at every dawn, before anything else:** "what are you worried
   about right now?" Write the answer down verbatim. That sentence is the tension curve.
5. **After the run**, before showing any numbers, ask the player to explain what killed
   them or what they were doing when they won.

### Questions, each mapped to a decision

| ask | if the answer is bad, change |
|---|---|
| When did you first think you were going to lose? | before night 5 in most runs: the early curve is too steep |
| Which night felt unfair rather than hard? And what did you think caused it? | cannot name a cause: legibility failure (pillar 2), not a balance failure |
| Did you ever change a build because of a night you saw coming? | never: the night is a timer, not a promise |
| What did you buy first in research, and did you notice the effect on the next day? | cannot name an effect: the node is a multiplier, cut or recast it |
| Did you build a laboratory? If not, why? | never reached it by night 8: the cure path is too slow or too expensive |
| Did you ever stop a job to afford another one? Which resource ran out? | always the same resource every run: that is a design hole, not difficulty |
| Describe the last ten minutes of play. | "waited and repaired": the endgame is empty (the failure we are trying to avoid) |
| Would you start a second run, and what would you do differently? | no and nothing: no replay pull |

### Recording template

| run | seed | who | outcome | day | pop | research bought | first "I might lose" | first confusion | quote |
|---|---|---|---|---|---|---|---|---|---|

Separate observation from interpretation as above, and never treat the designer's own
run as the target.

## When the build changes

- If the change is about feel, readability or balance, play the affected slice
  before claiming it works.
- If the change is only a refactor or test, run the validators and say the
  playtest was not performed.
- After a balance change, rerun `pnpm sweep` and record the new numbers here
  with the commit and date.
- If a feature is cut, say so in `docs/GDD.md` instead of leaving a dead
  system behind.
