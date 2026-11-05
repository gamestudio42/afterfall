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
