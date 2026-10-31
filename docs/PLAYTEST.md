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

- Date: 2026-10-31
- Base: `main` at `02c8d10`
- Command: `pnpm sweep 40 1`
- Seeds: 1 through 40
- Result: **open 29/40 (72.5%)**, **fort 31/40 (77.5%)**
- Notes: the open bot wins most runs but loses several on night 5; the fort
  bot trades early wall investment for a stronger late position. Neither bot
  builds a workshop, so ammo remains their binding constraint.

This reproduces the targets written in `docs/GDD.md`. It is a regression
baseline, not evidence that a human player will feel the same difficulty.

### Human sessions

No human playtest has been recorded yet. The roadmap lists "balance with real
play" as the next step. Until a session is logged here, do not claim that the
game is fun, too hard, or too easy.

## When the build changes

- If the change is about feel, readability or balance, play the affected slice
  before claiming it works.
- If the change is only a refactor or test, run the validators and say the
  playtest was not performed.
- After a balance change, rerun `pnpm sweep` and record the new numbers here
  with the commit and date.
- If a feature is cut, say so in `docs/GDD.md` instead of leaving a dead
  system behind.
