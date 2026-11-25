import { describe, expect, it } from "vitest";
import { AmbientPlanner, MOAN_RANGE, type AmbientInput, type AmbientEvent } from "../src";

const zones = { residential: 0.5, commercial: 0.3, industrial: 0.2, park: 0.1 };

function input(over: Partial<AmbientInput> = {}): AmbientInput {
  return { hour: 12, daylight: 1, rain: 0, cloud: 0.2, water: 0, zones, infected: [], ...over };
}

/** Runs the planner for `seconds` at 30 frames a second; returns every event and the last beds. */
function run(seconds: number, w: AmbientInput, seed = 1, planner = new AmbientPlanner(seed)) {
  const events: (AmbientEvent & { t: number })[] = [];
  let beds = {};
  for (let f = 0; f < seconds * 30; f++) {
    const out = planner.update(1 / 30, w);
    for (const e of out.events) events.push({ ...e, t: f / 30 });
    beds = out.beds;
  }
  return { events, beds: beds as Record<string, number>, planner };
}

const count = (events: AmbientEvent[], sound: string) => events.filter((e) => e.sound === sound).length;

describe("the ambient planner", () => {
  it("sings at dawn, caws at dusk, and keeps the owls and the crickets for the night", () => {
    const dawn = run(600, input({ hour: 6.3, daylight: 0.6 })).events;
    const noon = run(600, input({ hour: 12 })).events;
    const dusk = run(600, input({ hour: 18.2, daylight: 0.4 })).events;
    const night = run(600, input({ hour: 1, daylight: 0 }));
    expect(count(dawn, "chirp")).toBeGreaterThan(count(noon, "chirp") * 5);
    expect(count(dusk, "caw")).toBeGreaterThan(count(noon, "caw") * 2);
    expect(count(night.events, "owl")).toBeGreaterThan(2);
    expect(count(night.events, "chirp")).toBe(0);
    expect(night.beds.crickets).toBeGreaterThan(0);
    expect(run(5, input({ hour: 12 })).beds.crickets).toBe(0);
  });

  it("hears the dead close by, their feet when very close, and a crowd as more come", () => {
    const one = run(120, input({ infected: [{ dx: 20, dy: 0 }] })).events;
    expect(count(one, "moan") + count(one, "groan")).toBeGreaterThan(4);
    expect(count(one, "shuffle")).toBeGreaterThan(4);
    // Beyond earshot, nothing.
    const far = run(120, input({ infected: [{ dx: MOAN_RANGE + 30, dy: 0 }] })).events;
    expect(count(far, "moan") + count(far, "groan") + count(far, "shuffle")).toBe(0);
    // Every moan comes from where one of them stands.
    for (const e of one.filter((e) => e.sound === "moan")) expect([e.dx, e.dy]).toEqual([20, 0]);
    const crowd = Array.from({ length: 40 }, (_, i) => ({ dx: 40 + i * 2, dy: 10 }));
    expect(run(2, input({ infected: crowd })).beds.horde).toBeCloseTo(1, 1);
    expect(run(2, input({ infected: crowd.slice(0, 3) })).beds.horde).toBe(0);
  });

  it("lets the rain cover some of the dead", () => {
    const pack = Array.from({ length: 8 }, (_, i) => ({ dx: 15 + i * 4, dy: 5 }));
    const dry = run(300, input({ infected: pack })).events;
    const wet = run(300, input({ infected: pack, rain: 1, cloud: 1 })).events;
    const moans = (e: AmbientEvent[]) => count(e, "moan") + count(e, "groan");
    expect(moans(wet)).toBeLessThan(moans(dry) * 0.75);
  });

  it("holds its breath now and then, longer at night, but the dead still break the silence", () => {
    const w = input({ hour: 1, daylight: 0, infected: [{ dx: 10, dy: 0 }] });
    const planner = new AmbientPlanner(3);
    let silentFrames = 0;
    let ambientInSilence = 0;
    let deadInSilence = 0;
    for (let f = 0; f < 900 * 30; f++) {
      const out = planner.update(1 / 30, w);
      if (!planner.silent) continue;
      silentFrames++;
      for (const e of out.events) {
        if (["moan", "groan", "shuffle"].includes(e.sound)) deadInSilence++;
        else ambientInSilence++;
      }
    }
    expect(silentFrames / 30).toBeGreaterThan(60);
    expect(ambientInSilence).toBe(0);
    expect(deadInSilence).toBeGreaterThan(0);
  });

  it("sounds like the district: warehouses clang, houses creak, and never on a beat", () => {
    const industrial = run(1200, input({ zones: { residential: 0, commercial: 0, industrial: 1, park: 0 } })).events;
    const residential = run(1200, input({ zones: { residential: 1, commercial: 0, industrial: 0, park: 0 } })).events;
    expect(count(industrial, "clang")).toBeGreaterThan(count(residential, "clang") * 2);
    expect(count(residential, "creak") + count(residential, "fence")).toBeGreaterThan(count(industrial, "fence"));
    // The gaps between far-off sounds spread widely, from a few seconds to tens of them.
    const city = industrial.filter((e) => ["creak", "fence", "can", "clang", "alarm"].includes(e.sound));
    const gaps = city.slice(1).map((e, i) => e.t - city[i].t);
    expect(Math.min(...gaps)).toBeLessThan(5);
    expect(Math.max(...gaps)).toBeGreaterThan(30);
    // Each from its own direction and distance, never at the listener's feet.
    for (const e of city) expect(Math.hypot(e.dx, e.dy)).toBeGreaterThan(50);
  });

  it("is the same soundscape for the same seed", () => {
    const w = input({ hour: 19, daylight: 0.3, infected: [{ dx: 30, dy: 10 }] });
    expect(run(120, w, 7).events).toEqual(run(120, w, 7).events);
  });
});
