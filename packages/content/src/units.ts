export type WeaponId = "crowbar" | "pistol" | "rifle";

export interface WeaponDefinition {
  id: WeaponId;
  damage: number;
  /** Meters. */
  range: number;
  accuracy: number;
  /** Seconds between attacks. */
  cooldown: number;
  /** Radius (m) in which infected hear the attack. */
  noise: number;
  usesAmmo: boolean;
}

export const WEAPONS: Record<WeaponId, WeaponDefinition> = {
  crowbar: { id: "crowbar", damage: 16, range: 1.8, accuracy: 0.9, cooldown: 1.0, noise: 4, usesAmmo: false },
  pistol: { id: "pistol", damage: 24, range: 15, accuracy: 0.72, cooldown: 0.9, noise: 45, usesAmmo: true },
  rifle: { id: "rifle", damage: 48, range: 26, accuracy: 0.82, cooldown: 1.6, noise: 70, usesAmmo: true },
};

export type InfectedKind = "walker" | "runner" | "brute";

export interface InfectedDefinition {
  id: InfectedKind;
  hp: number;
  /** Meters per second. */
  speed: number;
  damage: number;
  structureDamage: number;
  cooldown: number;
  visionDay: number;
  visionNight: number;
  scale: number;
  color: number;
}

export const INFECTED: Record<InfectedKind, InfectedDefinition> = {
  walker: {
    id: "walker",
    hp: 60,
    speed: 1.15,
    damage: 9,
    structureDamage: 2,
    cooldown: 1.2,
    visionDay: 11,
    visionNight: 17,
    scale: 1,
    color: 0x7d8f5a,
  },
  runner: {
    id: "runner",
    hp: 35,
    speed: 3.1,
    damage: 6,
    structureDamage: 1,
    cooldown: 0.9,
    visionDay: 14,
    visionNight: 20,
    scale: 0.9,
    color: 0xa65b4b,
  },
  brute: {
    id: "brute",
    hp: 240,
    speed: 0.95,
    damage: 22,
    structureDamage: 9,
    cooldown: 1.6,
    visionDay: 9,
    visionNight: 14,
    scale: 1.45,
    color: 0x4f5c3a,
  },
};

/** A survivor in a hurry: ordered, fighting, fleeing, or with the infected close. A jog. */
export const SURVIVOR_SPEED = 3.0;
/**
 * A survivor about a chore with nothing near: a brisk walk. It was the jog for every step,
 * so the settlement trotted to the well and back all day and never looked at ease.
 */
export const SURVIVOR_WALK_SPEED = 1.7;
/** Infected this close put a survivor in a hurry, in metres. */
export const SURVIVOR_HURRY_RADIUS = 24;
/**
 * How far one infected's pace is from its kind's, either way: at one speed a horde marched
 * in step like a parade. Fixed per body, so the mean pace of a horde is the kind's.
 */
export const INFECTED_PACE_SPREAD = 0.12;
/** The pace of infected `id` as a fraction of its kind's speed, 1 ± INFECTED_PACE_SPREAD. */
export function infectedPace(id: number): number {
  // A hash, not a stride through [0, 1): ids spawned together sit in a horde together, and a
  // stride repeated its paces every few ids.
  const h = Math.sin(id * 91.3458 + 47.853) * 43758.5453;
  const u = h - Math.floor(h);
  return 1 + INFECTED_PACE_SPREAD * (2 * u - 1);
}
export const SURVIVOR_MAX_HEALTH = 100;
/** Carry weight per survivor. */
export const CARRY_CAPACITY = 20;
export const PERSONAL_AMMO_MAX = 30;

export const FIRST_NAMES = [
  "Ana",
  "Bruno",
  "Carla",
  "Diego",
  "Elisa",
  "Felipe",
  "Gabriela",
  "Heitor",
  "Iara",
  "João",
  "Kátia",
  "Lucas",
  "Marina",
  "Nícolas",
  "Olívia",
  "Paulo",
  "Rafaela",
  "Samuel",
  "Tainá",
  "Vitor",
  "Yara",
  "Zeca",
  "Amara",
  "Benício",
  "Cecília",
  "Davi",
  "Erika",
  "Fábio",
  "Helena",
  "Igor",
  "Jade",
  "Kauã",
  "Lívia",
  "Mateus",
  "Noah",
  "Pietra",
  "Renan",
  "Sofia",
  "Tomás",
  "Valentina",
];
export const LAST_NAMES = [
  "Silva",
  "Souza",
  "Costa",
  "Oliveira",
  "Pereira",
  "Lima",
  "Ferreira",
  "Almeida",
  "Ribeiro",
  "Carvalho",
  "Gomes",
  "Martins",
  "Rocha",
  "Barbosa",
  "Moreira",
  "Nunes",
  "Teixeira",
  "Mendes",
  "Freitas",
  "Kowalski",
];
