import type { ResourceId } from "./resources";

export type StructureKind = "wall" | "gate" | "tower" | "farm" | "well";

export interface StructureDefinition {
  id: StructureKind;
  /** Footprint in navigation cells (2 m each). */
  size: number;
  cost: Partial<Record<ResourceId, number>>;
  /** Worker-minutes to build. */
  work: number;
  maxHp: number;
  /** Whether survivors can walk through it. Infected never can (they attack it). */
  passableBySurvivors: boolean;
  /** Whether it blocks movement at all (farms do not). */
  solid: boolean;
  height: number;
  color: number;
}

export const STRUCTURES: Record<StructureKind, StructureDefinition> = {
  wall: { id: "wall", size: 1, cost: { wood: 3 }, work: 6, maxHp: 600, passableBySurvivors: false, solid: true, height: 2.6, color: 0x7a6a55 },
  gate: { id: "gate", size: 1, cost: { wood: 4, metal: 2 }, work: 10, maxHp: 800, passableBySurvivors: true, solid: true, height: 2.2, color: 0x5d4b36 },
  tower: { id: "tower", size: 2, cost: { wood: 12, metal: 4 }, work: 60, maxHp: 900, passableBySurvivors: false, solid: true, height: 6, color: 0x6b5a45 },
  farm: { id: "farm", size: 4, cost: { wood: 10, water: 5 }, work: 60, maxHp: 120, passableBySurvivors: true, solid: false, height: 0.3, color: 0x6b8e3a },
  well: { id: "well", size: 2, cost: { wood: 4, metal: 6 }, work: 50, maxHp: 400, passableBySurvivors: false, solid: true, height: 1.4, color: 0x5f7f99 },
};
