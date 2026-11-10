# Frame cost

Measured with `PERF_PROBE=1 pnpm test:e2e tests/e2e/perf.spec.ts`: the spec starts a
game on seed 4242, warms up, then runs the loop with a fixed 1/60 s delta and
reports the time split between simulation and render.

```sh
PERF_PROBE=1 pnpm test:e2e tests/e2e/perf.spec.ts --workers=1
```

The counters live in `GameController.cost`: `performance.now()` around
`sim.update`, around `renderer.render`, and around the whole frame body.

## Results

| Scene | entities | survivors | draw calls | simulation | render | frame |
|---|---|---|---|---|---|---|
| right after start, no base | 22 | 0 | 26 | **0.005 ms** | 1.7 ms | 1.8 ms |
| base set, squad of four | 25 | 4 | 31 | **0.045 ms** | 319.7 ms | 319.8 ms |
| 23:00, night | 25 | 4 | 28 | **0.041 ms** | 335.5 ms | 335.6 ms |

## What this says

**Decision 7 holds, with a lot of margin.** It claims the simulation costs "well
under 1 ms per frame"; the measured cost is **0.045 ms** with a city, a squad and
the task systems running — about twenty times under the claim.

**The render is the whole frame.** 320 to 336 ms of the frame is drawing, against
0.045 ms of simulation. Every optimisation that matters now lives in the
renderer, not in the core. Moving the simulation to a Web Worker, which decision 7
lists as a later step, would free 0.045 ms — it is not worth the complexity until
something else changes.

## What this does not say

- **These are software-rendered numbers.** Headless Chromium uses SwiftShader, so
  320 ms is CPU rasterisation of every pixel. A GPU would be far faster, but this
  probe cannot tell you how much: the 60 fps budget in `ROADMAP.md` still needs a
  measurement on real hardware.
- **The night sample is a quiet night.** The clock was jumped to 23:00, but no
  wave had spawned by the time the sample was taken (`entities` stayed at 25), so
  the 0.041 ms covers a night without a horde. A horde multiplies the entity count
  by two or three; the simulation cost would rise accordingly and is still
  expected to be small, but it was not measured.
- **The first row is not comparable.** With no base set, the camera sits over an
  empty part of the map and the render costs 1.7 ms. It is in the table to show
  that the simulation cost is small even before anything is built, not as a
  baseline for the art pass.

## Pathfinding was the wall, not the renderer (2026-11-10, PR #49)

A campaign seed with a twenty-two survivor settlement took **400 s of CPU** in the
headless runner, which made a 60-seed balance arm impossible. A CPU profile of one seed
(`node --cpu-prof`, 145k samples) put it beyond doubt:

| function | self time |
| --- | --- |
| `findPath` | 44.0% |
| `MinHeap.pop` | 40.6% |
| `passableIndex` | 8.5% |

The heap is a correct binary heap; it was simply popped millions of times. Once the
settlement walls itself in, a large share of destinations become unreachable — a task
site outside the ring, a building the ring sealed — and A* answered "no" by expanding
the whole 35k-cell grid, once per unit, on every retry. Nothing about the search was
wrong; the question was.

`NavGrid` now keeps connected components of its passable cells (one array per agent,
because survivors may cross a gate and infected may not), rebuilt lazily when `version`
changes — walls and gates, so rarely. `findPath` compares the start and goal components
first and returns in constant time when they differ. The flood fill uses the same
no-corner-cutting rule as the search, and `packages/world/tests/navgrid.test.ts` pins
that a rejected pair really is unreachable, that a gate splits the two agents, and that
a version bump recomputes.

Measured on the same seed: **400 s → 13 s**, and the result changed from a timeout to a
cure victory. Sixty seeds per arm now run in about eight minutes.

This is a simulation-side win; it says nothing about the 60 fps budget, which is still a
render question and still unmeasured on a GPU.
