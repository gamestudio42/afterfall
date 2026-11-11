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

## Character presentation — 2026-11-11

- **Fantasy / pillars:** keep a recognisable community alive (4), and read the
  infected threat before it reaches the defenses (2).
- **Loop beats:** scavenge, return, hold; presentation only, with unchanged rules.
- **Hypothesis:** shaped faces, layered clothing and equipment, distinct infected
  silhouettes, grounded strides and continuous pose blending make people feel
  alive and attacks readable at both close and tactical zoom.
- **Watch:** foot contact, silhouette separation, idle-to-walk transitions,
  animation at pause/1×/2×/4×, combat feedback and horde rendering cost.
- **Change again if:** feet detach or skate, enemies resemble survivors, poses
  snap, or the new geometry makes a normal horde impractical to render.
- **Observed:** Chromium rendered all six representative characters with layered
  clothing, independent palettes, readable faces and equipped weapons. Captured
  contact, passing, stride, windup and impact frames using the game's renderer.
  Visual inspection caught a limb-ring orientation flip that collapsed calves
  between poses; a stable transverse basis fixed it. The new GLB regression test
  failed on the old infected asset (mid-blend triangle area ratio 0.00645) and
  passed after regeneration. `docs/art/characters.png` is the inspection scene,
  with obstructing scenery hidden, not a normal gameplay screenshot.
- **Executed:** `pnpm check` (203 tests), `pnpm build`, and asset validation
  (44 assets, 2,195 KiB total). Full Chromium suite: 16 passed, 16 optional
  captures skipped. Final character capture passed; final infected-load and
  600-infected stress checks passed. Each infected material drew exactly 600
  instances in four batches. Three GPU-synchronized stress frames measured
  3.2 / 6.7 / 3.8 ms in this Chromium/SwiftShader configuration (60 total scene
  draw calls); this short diagnostic is not a hardware FPS benchmark.
- **Interpreted:** continuously blended gait and stable limb volume address the
  observed snapping and stick-like anatomy; silhouettes separate the three
  infected archetypes without changing gameplay.
- **Decision:** keep this presentation pass, pending human feel feedback.
- **Not executed:** a human playtest, a full campaign, cross-browser rendering,
  or a representative player-hardware performance benchmark. Speed-specific
  human review at 2×/4× remains open; automated checks cover distance/frame-rate
  independence and frozen animation while paused.

## Urban surfaces and vegetation — 2026-11-11

- **Fantasy / pillars:** reclaim an abandoned city (1); read safe routes and
  entrances while scavenging (3).
- **Hypothesis:** layered asphalt, weathered paving, road-aligned wear and varied
  Refloreste vegetation give streets a convincing history at tactical and close zoom.
- **Watch:** repeated stamps, decal spill beyond curved roads, flickering surfaces,
  canopy readability, visible entrances, loading fallbacks and scene cost.
- **Change again if:** vegetation hides access routes, decal noise overwhelms
  characters, or imported streets show dirt across unrelated courtyards.
- **Observed:** inspected actual Chromium renders of seed 4242 at street/park zoom
  and at 10:00/22:00, plus the synthetic imported-map fixture at midday. The first
  pass repeated bright clouds in asphalt/grass; reduced contrast and a rotated
  second texture scale corrected that. Lane paint was changed from uniform
  speckles to clustered wear after inspecting the crossing capture.
- **Implemented:** asphalt/paving bump and roughness, twelve road-aligned decal
  types, worn crossings, Refloreste manacá/pequi/bare trees/bushes with wind and
  earth around roots. Seed 4242 uses seven vegetation batches for 66 plants
  (44 trees and 22 bushes); this count is not a player-hardware benchmark.
- **Automated:** `pnpm check` passed (209 tests). V8 coverage passed all 68%
  thresholds (71.39% statements, 70.52% branches, 73.91% functions, 72.88% lines).
  Build and production debug-hook exclusion passed; all 52 art assets passed
  header/checksum/budget validation (3748 KiB, below the 8 MiB limit). Dependency
  audit passed its high/critical threshold, with three moderate advisories.
  The final complete Chromium run passed all 18 active tests; 16 optional capture
  tests were skipped. The dedicated environment/imported-map capture run also
  passed all three selected tests with the screenshot flags enabled.
- **Regression found during validation:** StrictMode discarded the first game
  controller but left its audio-unlock listeners registered. The added browser
  assertion reproduced two native audio contexts instead of one. Disposal now
  removes those listeners, closes the context, clears its diagnostic hook and
  prevents late loading from reviving it. Three concurrent audio regressions
  passed after the fix. The missing-asset case also uses the existing main-loop
  allowance for a queued base command, requiring exactly four founding survivors.
- **Evidence files:** `docs/art/environment_street.png`, `environment_park.png`,
  `environment_night.png` and the refreshed `osm_ground.png`.
- **Not executed:** a human playtest, a full campaign, WebKit/Firefox rendering,
  or a representative player-hardware performance benchmark.

## Buildings and urban objects — 2026-11-11

- **Fantasy / pillars:** reclaim a recognisable city (1), and read routes and
  destinations during scavenging (3); defenses should read as built by survivors (2).
- **Loop beats:** choose a headquarters, scavenge, build and hold.
- **Hypothesis:** shaped vehicles, authored street/roof equipment, layered facade
  details and material wear make the remaining scenery belong to the renewed streets.
- **Watch:** oversized props, blocked doorways, repeated facade details, lost
  resource/selection colours, night readability and extra rendering batches.
- **Change again if:** detail hides characters or entrances, a model outgrows its
  existing footprint, or a normal city becomes impractical to render.
- **Implemented:** 19 rebuilt street, roof and settlement models, packed vertex
  colours, per-instance vehicle/container paint, floor bands and upper-window
  sills, roof felt with relief/roughness and restrained facade weathering. Vehicles
  align with curbs, check their complete footprint and leave door clearance.
- **Observed:** inspected normal seed-4242 city renders at 10:00 and 22:00, a
  residential facade close-up, and all three model kits in isolated arrangements
  using the actual renderer. Body/glass faces initially pointed inward; the new
  ray regression failed before the winding correction. Close inspection also
  exposed displaced lamp arms and tower braces caused by baking the primitive's
  location before rotating it; explicit transform flags corrected the pivots.
  A second ray regression failed on the detached arm and passed after regeneration.
  Ground-floor sills were removed after a regression showed them projecting
  across a doorway; upper-floor depth remains.
- **Evidence files:** `docs/art/urban_street_day.png`, `urban_street_night.png`,
  `urban_facade.png`, `urban_objects.png`, `urban_roof_equipment.png` and
  `urban_structures.png`. The last three are inspection arrangements, not
  settlements or streets built through normal play.
- **Automated:** `pnpm check` passed (216 tests). Coverage passed all 68%
  thresholds: 71.61% statements, 70.56% branches, 74.24% functions and 73.10%
  lines. Production build and debug-hook exclusion passed. All 54 assets passed
  header/checksum/budget validation (5111 KiB total, below 8 MiB). The dependency
  audit passed its high/critical threshold with three existing moderate advisories.
  The optional urban-kit capture passed, including all 19 runtime models.
- **Browser load observation:** the first full Chromium run with three workers
  passed 18 tests and timed out in the combined start/scavenge/save test (120 s).
  The host reported a load average near 22 across 16 logical CPUs. That test
  passed unchanged in isolation with tracing (about 72 s); this supports runner
  contention as a contributor, but does not establish a player-hardware frame rate.
  The two-worker CI configuration also reached the total deadline, this time
  during the final population check after Continue. The test now has a 180 s
  combined budget for two scene boots and real-time scavenging, pauses before
  saving, and checks the saved population exactly plus preserved search progress.
  Its individual action/progress checks remain bounded. The final full run,
  `CI=1 pnpm test:e2e`, passed all 19 active tests in 4.2 minutes; 16 optional
  captures were skipped. Final TypeScript, targeted lint and formatting checks
  also passed after the browser-test changes.
- **Rendering diagnostic:** five frozen, GPU-synchronized frames measured
  1.1–1.6 ms with the full scene, 0.6–0.9 ms with props hidden, 0.8–1.0 ms with
  trim hidden and 0.7–1.0 ms without prop shadows in this Chromium/SwiftShader
  session. Full submission: 46 calls, 467646 triangles. This short diagnostic
  excludes simulation and loading and does not support a gameplay FPS claim.
- **Not executed:** a human playtest, a complete campaign, WebKit/Firefox rendering
  or a representative player-hardware performance benchmark.

## Abandoned vehicles and collision — 2026-11-11

- **Player report:** cars occupied sidewalks and civilians walked through them.
- **Pillars / loop:** reclaim an abandoned city (1), read routes while scavenging
  (3), and prepare defenses (2). Vehicles should look abandoned and be obstacles.
- **Implemented:** shared deterministic road placement for renderer and navigation,
  curbside and stranded vehicles, open doors, collision for survivors/infected,
  and recovery of saved characters overlapping new vehicle cells. Clear entrance
  approaches preserve defense construction space.
- **Observed:** inspected the actual road capture in `docs/art/abandoned_cars.png`.
  Unit movement tests exercise both agents crossing a vehicle's vicinity, checking
  every position and arrival. A save regression verifies relocation from a car.
- **Validation:** `pnpm check` passed (217 tests), `pnpm build` passed, and
  `CI=1 pnpm test:e2e` passed all 20 active Chromium tests (16 optional captures
  skipped). The vehicle capture also passed separately and was visually inspected.
  `pnpm test:coverage` passed its thresholds: 71.48% statements, 70.71% branches,
  74.01% functions and 73.04% lines. Human campaign playtesting and validation on
  representative player hardware remain open.
