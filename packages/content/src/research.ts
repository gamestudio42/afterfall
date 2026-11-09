import type { BuildingFunction, BuildingType } from "./buildings";

/**
 * Research is the campaign's spine: points are earned by searching the buildings
 * that hold knowledge, and spent on capabilities. Each node is a capability, not a
 * multiplier — a node the player cannot describe in one sentence of play is a node
 * that should not exist.
 */
export type TechBranch = "survival" | "construction" | "defense" | "medicine";

export type TechId =
  | "preserves"
  | "cistern"
  | "rations"
  | "scaffolding"
  | "forge"
  | "salvage"
  | "armory"
  | "marksmanship"
  | "floodlights"
  | "serum"
  | "lab"
  | "cure";

export interface TechDefinition {
  id: TechId;
  branch: TechBranch;
  /** Research points to unlock. */
  cost: number;
  /** Must be unlocked before this one. */
  requires?: TechId;
  /** The building conversion this node unlocks, if any. */
  unlocks?: BuildingFunction;
}

/** UI order: branches in this order, nodes in chain order inside each branch. */
export const TECH_BRANCHES: TechBranch[] = ["survival", "construction", "defense", "medicine"];

export const TECHS: Record<TechId, TechDefinition> = {
  preserves: { id: "preserves", branch: "survival", cost: 4 },
  cistern: { id: "cistern", branch: "survival", cost: 7, requires: "preserves" },
  rations: { id: "rations", branch: "survival", cost: 11, requires: "cistern" },

  scaffolding: { id: "scaffolding", branch: "construction", cost: 4 },
  forge: { id: "forge", branch: "construction", cost: 7, requires: "scaffolding" },
  salvage: { id: "salvage", branch: "construction", cost: 11, requires: "forge" },

  armory: { id: "armory", branch: "defense", cost: 4 },
  marksmanship: { id: "marksmanship", branch: "defense", cost: 7, requires: "armory" },
  floodlights: { id: "floodlights", branch: "defense", cost: 11, requires: "marksmanship" },

  serum: { id: "serum", branch: "medicine", cost: 4 },
  // The lab building itself is not gated: gating the engine of research behind
  // points only research can produce is a deadlock. This node upgrades it.
  lab: { id: "lab", branch: "medicine", cost: 7, requires: "serum" },
  cure: { id: "cure", branch: "medicine", cost: 12, requires: "lab" },
};

/** Every node, in a stable order the UI and the bots share. */
export const TECH_ORDER: TechId[] = TECH_BRANCHES.flatMap((branch) =>
  (Object.values(TECHS) as TechDefinition[]).filter((t) => t.branch === branch).map((t) => t.id),
);

export function techsOfBranch(branch: TechBranch): TechDefinition[] {
  return TECH_ORDER.map((id) => TECHS[id]).filter((t) => t.branch === branch);
}

/**
 * Research points a building is worth when its search completes. Only the
 * buildings that would plausibly hold records, books or a lab bench are worth
 * anything; a house full of canned food teaches nothing.
 */
export const RESEARCH_YIELD: Partial<Record<BuildingType, number>> = {
  school: 3,
  hospital: 3,
  police: 2,
  office: 2,
  pharmacy: 1,
};

export function researchYield(type: BuildingType): number {
  return RESEARCH_YIELD[type] ?? 0;
}
