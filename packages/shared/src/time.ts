/** One simulation tick lasts 100 ms of real time at 1x speed. */
export const SIMULATION_TICK_MS = 100;
/** Simulated seconds advanced per tick (used for movement and combat). */
export const TICK_SECONDS = SIMULATION_TICK_MS / 1000;
/** At 1x a full day lasts 24 real minutes: one game minute per real second. */
export const TICKS_PER_GAME_MINUTE = 10;
export const MINUTES_PER_DAY = 24 * 60;
export const TICKS_PER_DAY = MINUTES_PER_DAY * TICKS_PER_GAME_MINUTE;
export const DAWN_HOUR = 6;
export const DUSK_HOUR = 18;
/** The first game starts on day 1 at 07:00. */
export const START_MINUTE = 7 * 60;

export type DayPhase = "dawn" | "day" | "dusk" | "night";

export interface GameClock {
  day: number;
  hour: number;
  minute: number;
  /** Fractional hour, 0..24. */
  hourFloat: number;
  phase: DayPhase;
}

export function clockFromTick(tick: number): GameClock {
  const totalMinutes = START_MINUTE + tick / TICKS_PER_GAME_MINUTE;
  const day = Math.floor(totalMinutes / MINUTES_PER_DAY) + 1;
  const minuteOfDay = totalMinutes % MINUTES_PER_DAY;
  const hourFloat = minuteOfDay / 60;
  const hour = Math.floor(hourFloat);
  const minute = Math.floor(minuteOfDay % 60);
  let phase: DayPhase;
  if (hourFloat >= DAWN_HOUR && hourFloat < DAWN_HOUR + 1) phase = "dawn";
  else if (hourFloat >= DAWN_HOUR + 1 && hourFloat < DUSK_HOUR) phase = "day";
  else if (hourFloat >= DUSK_HOUR && hourFloat < DUSK_HOUR + 2) phase = "dusk";
  else phase = "night";
  return { day, hour, minute, hourFloat, phase };
}

/** Tick at which the given day/hour starts. */
export function tickAt(day: number, hour: number): number {
  return ((day - 1) * MINUTES_PER_DAY + hour * 60 - START_MINUTE) * TICKS_PER_GAME_MINUTE;
}

export const isNight = (c: GameClock) => c.phase === "night" || c.phase === "dusk";
