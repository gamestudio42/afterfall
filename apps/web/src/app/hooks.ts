import { createContext, useContext } from "react";
import type { GameController } from "../game/GameController";
import { translate } from "../i18n";
import { useUi } from "./store";

export const GameContext = createContext<GameController | null>(null);

export function useGame(): GameController {
  const g = useContext(GameContext);
  if (!g) throw new Error("GameController missing");
  return g;
}

export function useT() {
  const lang = useUi((s) => s.lang);
  return (key: string, params?: Record<string, string | number>) => translate(lang, key, params);
}

/** Re-renders the caller a few times per second while the game runs. */
export function useFrame(): number {
  return useUi((s) => s.frame);
}
