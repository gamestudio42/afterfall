export interface HordeSpec {
  waves: number;
  walkers: number;
  runners: number;
  brutes: number;
}

/** Tunable balance constants. Everything gameplay-relevant lives here. */
export const BALANCE = {
  startingResources: { food: 30, water: 30, wood: 30, metal: 12, ammo: 90, medicine: 4 },
  startingSurvivors: 4,
  /** Food and water eaten per survivor per meal (two meals a day). */
  mealFood: 1,
  mealWater: 1,
  mealHours: [7, 19],
  /** Search points per worker-minute at skill 1. */
  searchRate: 1.2,
  /** Food produced per worker-minute on a farm. */
  farmRate: 0.05,
  /** Water produced per hour by a well. */
  wellRate: 1,
  /** Workshop recipe: metal -> ammo. */
  ammoRecipe: { metal: 2, ammo: 12, work: 40 },
  /** Policy defaults. */
  policies: {
    autoRepairBelow: 0.7,
    keepAmmo: 60,
    recallHour: 17,
  },
  /** Infected roaming the city at the start, per 1000 m² of road. */
  wanderersAtStart: 22,
  /** Night horde schedule, indexed by night number (1-based). */
  hordes: [
    null,
    { waves: 1, walkers: 6, runners: 0, brutes: 0 },
    { waves: 2, walkers: 7, runners: 2, brutes: 0 },
    { waves: 2, walkers: 14, runners: 4, brutes: 0 },
    { waves: 3, walkers: 15, runners: 6, brutes: 1 },
    { waves: 3, walkers: 18, runners: 8, brutes: 2 },
  ] as (HordeSpec | null)[],
  /** Nights to survive for victory. */
  nightsToWin: 5,
  biteInfectionChance: 0.08,
  /** Infection growth per game hour once infected. */
  infectionPerHour: 2.2,
};

export function hordeForNight(night: number): HordeSpec | null {
  const table = BALANCE.hordes;
  if (night < table.length) return table[night];
  const last = table[table.length - 1]!;
  const extra = night - (table.length - 1);
  return {
    waves: last.waves + Math.floor(extra / 2),
    walkers: last.walkers + extra * 4,
    runners: last.runners + extra * 2,
    brutes: last.brutes + Math.floor(extra / 2),
  };
}
