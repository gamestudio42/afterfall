import type { ResourceId } from "./resources";

export type EventCondition =
  | { type: "minDay"; day: number }
  | { type: "minPopulation"; count: number }
  | { type: "resourceAtLeast"; resource: ResourceId; amount: number }
  | { type: "hasStructure" };

export type EventEffect =
  | { type: "resource"; resource: ResourceId; amount: number }
  | { type: "addSurvivors"; count: number; infectedChance?: number }
  | { type: "morale"; amount: number }
  | { type: "damageStructures"; fraction: number }
  | { type: "revealCache" }
  | { type: "injureRandom"; amount: number };

export interface EventChoice {
  /** Localization key of the choice label. */
  key: string;
  effects: EventEffect[];
  requires?: { resource: ResourceId; amount: number };
}

export interface GameEventDefinition {
  id: string;
  conditions: EventCondition[];
  choices: EventChoice[];
  weight: number;
  cooldownDays: number;
}

/**
 * Data-driven events. Titles and descriptions live in the localization
 * tables under `event.<id>.title` / `event.<id>.text`.
 */
export const EVENTS: GameEventDefinition[] = [
  {
    id: "refugees",
    conditions: [{ type: "minDay", day: 2 }],
    weight: 3,
    cooldownDays: 2,
    choices: [
      { key: "event.refugees.all", effects: [{ type: "addSurvivors", count: 3, infectedChance: 0.35 }] },
      {
        key: "event.refugees.healthy",
        effects: [
          { type: "addSurvivors", count: 2 },
          { type: "morale", amount: -6 },
        ],
      },
      { key: "event.refugees.refuse", effects: [{ type: "morale", amount: -10 }] },
    ],
  },
  {
    id: "trader",
    conditions: [
      { type: "minDay", day: 2 },
      { type: "resourceAtLeast", resource: "food", amount: 20 },
    ],
    weight: 2,
    cooldownDays: 2,
    choices: [
      {
        key: "event.trader.ammo",
        requires: { resource: "food", amount: 20 },
        effects: [
          { type: "resource", resource: "food", amount: -20 },
          { type: "resource", resource: "ammo", amount: 40 },
        ],
      },
      {
        key: "event.trader.meds",
        requires: { resource: "water", amount: 15 },
        effects: [
          { type: "resource", resource: "water", amount: -15 },
          { type: "resource", resource: "medicine", amount: 6 },
        ],
      },
      { key: "event.trader.decline", effects: [] },
    ],
  },
  {
    id: "radio",
    conditions: [{ type: "minDay", day: 1 }],
    weight: 2,
    cooldownDays: 3,
    choices: [
      { key: "event.radio.note", effects: [{ type: "revealCache" }] },
      { key: "event.radio.ignore", effects: [{ type: "morale", amount: 2 }] },
    ],
  },
  {
    id: "storm",
    conditions: [{ type: "minDay", day: 3 }, { type: "hasStructure" }],
    weight: 1,
    cooldownDays: 4,
    choices: [
      {
        key: "event.storm.ok",
        effects: [
          { type: "damageStructures", fraction: 0.15 },
          { type: "resource", resource: "water", amount: 12 },
        ],
      },
    ],
  },
  {
    id: "accident",
    conditions: [
      { type: "minDay", day: 2 },
      { type: "minPopulation", count: 3 },
    ],
    weight: 1,
    cooldownDays: 3,
    choices: [
      {
        key: "event.accident.treat",
        requires: { resource: "medicine", amount: 2 },
        effects: [{ type: "resource", resource: "medicine", amount: -2 }],
      },
      {
        key: "event.accident.rest",
        effects: [
          { type: "injureRandom", amount: 45 },
          { type: "morale", amount: -4 },
        ],
      },
    ],
  },
];
