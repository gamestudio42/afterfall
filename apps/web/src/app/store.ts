import { create } from "zustand";
import type { StructureKind } from "@afterfall/content";
import type { EntityId } from "@afterfall/core";
import type { OverlayMode } from "@afterfall/renderer";
import type { Lang } from "../i18n";

export type Speed = 0 | 1 | 2 | 4;

export interface UiState {
  screen: "menu" | "game";
  lang: Lang;
  speed: Speed;
  /** Speed to resume to after pausing. */
  lastSpeed: Speed;
  /** Bumped a few times per second so panels re-read simulation state. */
  frame: number;
  selectedUnits: EntityId[];
  selectedBuilding: number;
  selectedStructure: EntityId;
  buildMode: StructureKind | null;
  overlay: OverlayMode;
  dragRect: { x0: number; y0: number; x1: number; y1: number } | null;
  showHelp: boolean;
  showDev: boolean;
  outcomeAck: boolean;
  toast: string | null;
  /** Volume geral do jogo, 0..1. */
  volume: number;
  muted: boolean;
  set: (patch: Partial<UiState>) => void;
}

function initialNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const v = Number(raw);
      if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
    }
  } catch {
    /* storage unavailable */
  }
  return fallback;
}

function initialFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* storage unavailable */
  }
  return fallback;
}

function initialLang(): Lang {
  try {
    const v = localStorage.getItem("afterfall.lang");
    if (v === "en" || v === "pt-BR") return v;
  } catch {
    /* storage unavailable */
  }
  return "pt-BR";
}

export const useUi = create<UiState>((set) => ({
  screen: "menu",
  lang: initialLang(),
  speed: 1,
  lastSpeed: 1,
  frame: 0,
  selectedUnits: [],
  selectedBuilding: -1,
  selectedStructure: -1,
  buildMode: null,
  overlay: "none",
  dragRect: null,
  showHelp: false,
  showDev: false,
  outcomeAck: false,
  toast: null,
  volume: initialNumber("afterfall.volume", 0.7),
  muted: initialFlag("afterfall.muted", false),
  set: (patch) => set(patch),
}));
