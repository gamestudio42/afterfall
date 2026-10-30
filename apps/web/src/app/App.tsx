import { useEffect, useRef, useState } from "react";
import { GameController } from "../game/GameController";
import { MainMenu } from "../screens/MainMenu";
import { GameScreen } from "../screens/GameScreen";
import { GameContext } from "./hooks";
import { useUi } from "./store";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<GameController | null>(null);
  const screen = useUi((s) => s.screen);
  const lang = useUi((s) => s.lang);

  useEffect(() => {
    const g = new GameController(canvasRef.current!);
    setGame(g);
    return () => g.dispose();
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem("afterfall.lang", lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  useEffect(() => {
    game?.resize();
  }, [screen, game]);

  return (
    <GameContext.Provider value={game}>
      <canvas ref={canvasRef} className={`world ${screen === "game" ? "" : "hidden"}`} data-testid="world" />
      {game && (screen === "menu" ? <MainMenu /> : <GameScreen />)}
    </GameContext.Provider>
  );
}
