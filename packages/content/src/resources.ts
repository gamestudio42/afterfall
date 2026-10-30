export const RESOURCE_IDS = ["food", "water", "wood", "metal", "ammo", "medicine", "firearms"] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

export type ResourceBag = Partial<Record<ResourceId, number>>;

export interface ResourceDefinition {
  id: ResourceId;
  category: "survival" | "material" | "military";
  /** Carry weight per unit; a survivor carries up to CARRY_CAPACITY weight. */
  weight: number;
  perishable: boolean;
}

export const RESOURCES: Record<ResourceId, ResourceDefinition> = {
  food: { id: "food", category: "survival", weight: 1, perishable: false },
  water: { id: "water", category: "survival", weight: 1, perishable: false },
  wood: { id: "wood", category: "material", weight: 1, perishable: false },
  metal: { id: "metal", category: "material", weight: 1, perishable: false },
  ammo: { id: "ammo", category: "military", weight: 0.1, perishable: false },
  medicine: { id: "medicine", category: "survival", weight: 0.5, perishable: false },
  firearms: { id: "firearms", category: "military", weight: 2, perishable: false },
};

export function bagTotal(bag: ResourceBag): number {
  let t = 0;
  for (const id of RESOURCE_IDS) t += bag[id] ?? 0;
  return t;
}

export function bagWeight(bag: ResourceBag): number {
  let t = 0;
  for (const id of RESOURCE_IDS) t += (bag[id] ?? 0) * RESOURCES[id].weight;
  return t;
}

export function addToBag(bag: ResourceBag, id: ResourceId, amount: number): void {
  const v = (bag[id] ?? 0) + amount;
  if (v <= 1e-9) delete bag[id];
  else bag[id] = v;
}
