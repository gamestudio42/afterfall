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

## The spatial hash stopped clearing the whole map (2026-11-10, PR #51)

With storage and hauling in, the slow campaign seed was back to 54 s, so it was profiled
again. The answer had moved: **44% of the samples were in `SpatialHash.clear`**.

The hash kept every bucket it had ever created and `clear()` walked them all, twice per
tick. Buckets are cheap and never removed, so over a twelve-night run the map filled with
the cells anything had passed through, and clearing them cost more than the queries the
hash exists to answer.

Clearing is now a generation counter: a bucket belonging to an older generation is treated
as empty and is emptied on its next insert. `query` skips stale buckets, `insert` claims
them, and `clear()` is an increment. The new `liveBuckets` accessor is what the test
asserts on: walking one agent across a thousand ticks must leave at most two live buckets,
which is the regression this fixes.

Same seed: **54 s → 23 s**. Together with the reachability change above, a seed that took
400 s before this work now takes 23 s.

What a profile shows after both fixes is flat — no function above 7.5% — which means the
next win is structural rather than local: the simulation in a Web Worker, or LOD and chunk
streaming for large imported cities. The 60 fps budget is still a render question and is
still unmeasured on a GPU.

## A large city could not be built at all (2026-11-10, PR #52)

Before deciding anything about level of detail or streaming, the obvious question was
what a large map costs today. The answer was not a cost: **it crashed.**

`BuildingBatch` concatenated its vertex groups with `push(...array)`. Spreading a
few hundred thousand numbers as call arguments overflows the stack, so a ten-block city
(435 buildings, 43k triangles) threw `RangeError: Maximum call stack size exceeded`
inside the constructor. Six blocks worked, ten did not — and a real imported
neighbourhood is far past ten. The fix is typed arrays and `set` with a running offset;
`owner` is per triangle, so its offset moves in triangles while the vertex buffers move in
vertices, which is the part that broke the existing ray-hit test until it was corrected.

Measured after the fix, one renderer per page load, eighteen blocks by eighteen:

| buildings | build | draw calls | triangles | frame (SwiftShader) |
| --- | --- | --- | --- | --- |
| 1,553 | 845 ms | 19 | 132,884 | 4.8 ms |

That is a 1.2 km square with more buildings than any imported map the game accepts (the
importer stays under a 600 m square). The renderer still batches everything into 19 draw
calls and 133k triangles, and the frame time does not move between six blocks and eighteen.

**So chunk streaming and level of detail are deferred, on measurement rather than on
taste.** They exist to bound a cost that is not there yet: the geometry is a one-off
845 ms on map load, the draw-call count is flat, and the triangle count is a fifth of what
a single prop-heavy scene would cost. What would justify them is a map an order of
magnitude larger than the importer allows, or a measured GPU budget that this project has
never had. The crash was the real blocker for large maps, and it is fixed and pinned by a
test that builds 435 buildings and checks every triangle still points at a real one.
