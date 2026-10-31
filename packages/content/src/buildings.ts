import type { ResourceId } from "./resources";

export type BuildingType =
  "house" | "apartment" | "shop" | "supermarket" | "pharmacy" | "office" | "warehouse" | "gasStation" | "hospital" | "school" | "police";

export type Zone = "residential" | "commercial" | "industrial" | "civic" | "park";

export interface BuildingTypeDefinition {
  id: BuildingType;
  floors: [number, number];
  /** Base color used by the renderer (hex). */
  color: number;
  /** Relative loot weights; total loot scales with floor area. */
  loot: Partial<Record<ResourceId, number>>;
  /** Loot units per 100 m² of floor area. */
  lootDensity: number;
  /** Range of infected hiding inside. */
  infected: [number, number];
  /** Chance that survivors are hiding inside. */
  survivorChance: number;
  /** Building functions this structure can be converted into. */
  adaptations: BuildingFunction[];
}

export type BuildingFunction = "none" | "hq" | "shelter" | "storage" | "workshop";

export const BUILDING_TYPES: Record<BuildingType, BuildingTypeDefinition> = {
  house: {
    id: "house",
    floors: [1, 2],
    color: 0xc9b79c,
    loot: { food: 4, water: 3, wood: 3, medicine: 1, metal: 1, ammo: 1 },
    lootDensity: 9,
    infected: [0, 2],
    survivorChance: 0.08,
    adaptations: ["shelter", "storage"],
  },
  apartment: {
    id: "apartment",
    floors: [3, 6],
    color: 0xb0a395,
    loot: { food: 4, water: 3, wood: 2, medicine: 1, metal: 1, ammo: 0.5 },
    lootDensity: 4,
    infected: [1, 5],
    survivorChance: 0.15,
    adaptations: ["shelter", "storage"],
  },
  shop: {
    id: "shop",
    floors: [1, 2],
    color: 0xd2a679,
    loot: { food: 3, water: 2, wood: 2, metal: 2 },
    lootDensity: 9,
    infected: [0, 2],
    survivorChance: 0.05,
    adaptations: ["storage", "workshop", "shelter"],
  },
  supermarket: {
    id: "supermarket",
    floors: [1, 1],
    color: 0xe0c060,
    loot: { food: 13, water: 4, wood: 1, metal: 1, medicine: 1 },
    lootDensity: 14,
    infected: [2, 6],
    survivorChance: 0.1,
    adaptations: ["storage", "workshop"],
  },
  pharmacy: {
    id: "pharmacy",
    floors: [1, 1],
    color: 0x8fc9a8,
    loot: { medicine: 10, water: 2, food: 1 },
    lootDensity: 10,
    infected: [0, 2],
    survivorChance: 0.05,
    adaptations: ["storage", "shelter"],
  },
  office: {
    id: "office",
    floors: [3, 7],
    color: 0x8d9aa8,
    loot: { wood: 3, metal: 3, water: 2, food: 1 },
    lootDensity: 3,
    infected: [1, 4],
    survivorChance: 0.08,
    adaptations: ["shelter", "storage", "workshop"],
  },
  warehouse: {
    id: "warehouse",
    floors: [1, 1],
    color: 0x9b8a78,
    loot: { wood: 6, metal: 6, water: 1, food: 1 },
    lootDensity: 8,
    infected: [1, 4],
    survivorChance: 0.05,
    adaptations: ["storage", "workshop"],
  },
  gasStation: {
    id: "gasStation",
    floors: [1, 1],
    color: 0xc7584a,
    loot: { food: 3, water: 4, metal: 2 },
    lootDensity: 12,
    infected: [0, 2],
    survivorChance: 0.05,
    adaptations: ["storage", "workshop"],
  },
  hospital: {
    id: "hospital",
    floors: [3, 5],
    color: 0xe8e8e8,
    loot: { medicine: 12, food: 2, water: 2, metal: 2 },
    lootDensity: 3,
    infected: [6, 12],
    survivorChance: 0.3,
    adaptations: ["shelter", "storage"],
  },
  school: {
    id: "school",
    floors: [2, 3],
    color: 0xd9c38c,
    loot: { food: 4, water: 3, wood: 4, medicine: 1 },
    lootDensity: 5,
    infected: [3, 7],
    survivorChance: 0.25,
    adaptations: ["shelter", "storage", "workshop"],
  },
  police: {
    id: "police",
    floors: [2, 3],
    color: 0x5a6f9a,
    loot: { ammo: 40, firearms: 0.5, medicine: 2, food: 1, metal: 2 },
    lootDensity: 6,
    infected: [3, 6],
    survivorChance: 0.15,
    adaptations: ["shelter", "storage", "workshop"],
  },
};

export interface BuildingFunctionDefinition {
  id: BuildingFunction;
  cost: Partial<Record<ResourceId, number>>;
  /** Worker-minutes needed to convert. */
  work: number;
  /** Beds per 100 m² of floor area. */
  bedsPer100m2: number;
  /** Storage units per 100 m² of floor area. */
  storagePer100m2: number;
  maxHp: number;
}

export const BUILDING_FUNCTIONS: Record<BuildingFunction, BuildingFunctionDefinition> = {
  none: { id: "none", cost: {}, work: 0, bedsPer100m2: 0, storagePer100m2: 0, maxHp: 0 },
  hq: { id: "hq", cost: {}, work: 0, bedsPer100m2: 0, storagePer100m2: 0, maxHp: 3000 },
  shelter: { id: "shelter", cost: { wood: 8, metal: 2 }, work: 120, bedsPer100m2: 2.2, storagePer100m2: 0, maxHp: 1500 },
  storage: { id: "storage", cost: { wood: 6 }, work: 90, bedsPer100m2: 0, storagePer100m2: 120, maxHp: 1500 },
  workshop: { id: "workshop", cost: { wood: 6, metal: 8 }, work: 160, bedsPer100m2: 0, storagePer100m2: 0, maxHp: 1500 },
};

/** Fixed capacity of the headquarters regardless of its size. */
export const HQ_BEDS = 6;
export const HQ_STORAGE = 600;
