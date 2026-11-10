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
  ammoRecipe: { metal: 2, ammo: 30, work: 30 },
  /** Policy defaults. */
  policies: {
    autoRepairBelow: 0.7,
    keepAmmo: 60,
    recallHour: 17,
    /** Above this fill, a store with room takes the excess of a fuller one. */
    haulAbove: 0.9,
  },
  /** Logistics: how much one haul task moves, and how much a carrier takes. */
  logistics: { haulBatch: 40 },
  /** Infected roaming the city at the start, per 1000 m² of road. */
  wanderersAtStart: 22,
  /** Night horde schedule, indexed by night number (1-based). */
  hordes: [
    null,
    { waves: 1, walkers: 6, runners: 0, brutes: 0 },
    { waves: 2, walkers: 7, runners: 2, brutes: 0 },
    { waves: 2, walkers: 14, runners: 4, brutes: 0 },
    { waves: 3, walkers: 18, runners: 7, brutes: 1 },
    { waves: 3, walkers: 22, runners: 9, brutes: 2 },
    { waves: 3, walkers: 24, runners: 10, brutes: 2 },
    { waves: 3, walkers: 25, runners: 10, brutes: 3 },
    { waves: 4, walkers: 26, runners: 11, brutes: 3 },
    { waves: 4, walkers: 27, runners: 11, brutes: 3 },
    { waves: 4, walkers: 28, runners: 12, brutes: 4 },
  ] as (HordeSpec | null)[],
  /**
   * Nights to survive for victory. The cure is the intended ending; surviving is the
   * fallback. Twelve is where the measured curve still lets a walled settlement hold:
   * the bots lose 8 of 10 somewhere between night 5 and night 12, so a longer cap only
   * moves the defeat, it does not add campaign.
   */
  nightsToWin: 12,
  /**
   * Research and the cure. Points come from searching knowledge buildings and from
   * a standing lab; the cure costs medicine and a fixed number of research points,
   * then advances one step per dawn while the lab still stands.
   */
  research: {
    /**
     * Points per game hour per standing lab. The lab is the engine of research: a
     * searched school is worth a few points, but a lab is what turns a settlement
     * into a programme, so it has to out-earn scavenging by an order of magnitude.
     */
    perHourLab: 0.5,
    /** Kept for the dawn summary; a full day of lab time. */
    perDayLab: 12,
    cureMedicine: 12,
    cureResearch: 12,
    cureDawns: 3,
  },
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
    waves: last.waves + Math.floor(extra / 3),
    walkers: last.walkers + extra * 2,
    runners: last.runners + extra,
    brutes: last.brutes + Math.floor(extra / 3),
  };
}
