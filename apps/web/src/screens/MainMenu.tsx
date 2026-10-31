import { useEffect, useState } from "react";
import { deleteSave, getSave, listSaves, type SaveSlot } from "../app/saves";
import { useGame, useT } from "../app/hooks";
import { useUi } from "../app/store";
import { HelpContent } from "../components/Help";
import { RealPlacePicker } from "../components/RealPlacePicker";
import type { CityMap } from "@afterfall/world";

type View = "main" | "new" | "load" | "help";

export function MainMenu() {
  const t = useT();
  const game = useGame();
  const set = useUi((s) => s.set);
  const lang = useUi((s) => s.lang);
  const [view, setView] = useState<View>("main");
  const [seed, setSeed] = useState(() => String(Math.floor(Math.random() * 99999)));
  const [saves, setSaves] = useState<SaveSlot[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listSaves().then(setSaves);
  }, [view]);

  const [mapKind, setMapKind] = useState<"procedural" | "real">("procedural");

  const start = () => {
    game.newGame(Number(seed) || 1);
    set({ screen: "game", showHelp: true });
  };

  const startReal = (map: CityMap) => {
    game.newGame(map.seed, map);
    set({ screen: "game", showHelp: true });
  };

  const load = async (name: string) => {
    try {
      const slot = await getSave(name);
      if (!slot) return;
      game.load(slot.data);
      set({ screen: "game" });
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="menu">
      <div className="menu-card">
        <h1 className="logo">
          AFTER<span>FALL</span>
        </h1>
        <p className="subtitle">{t("app.subtitle")}</p>
        {view === "main" && (
          <>
            <p className="tagline">{t("menu.tagline")}</p>
            <div className="menu-buttons">
              <button className="primary" data-testid="new-game" onClick={() => setView("new")}>
                {t("menu.newGame")}
              </button>
              {saves.length > 0 && (
                <button onClick={() => load(saves[0].name)} data-testid="continue">
                  {t("menu.continue")} <small>· {t("menu.saveInfo", { day: saves[0].day, survivors: saves[0].survivors })}</small>
                </button>
              )}
              <button onClick={() => setView("load")}>{t("menu.load")}</button>
              <button onClick={() => setView("help")}>{t("menu.controls")}</button>
              <div className="lang-row">
                <span>{t("menu.language")}</span>
                <button className={lang === "pt-BR" ? "chip active" : "chip"} onClick={() => set({ lang: "pt-BR" })}>
                  Português
                </button>
                <button className={lang === "en" ? "chip active" : "chip"} onClick={() => set({ lang: "en" })}>
                  English
                </button>
              </div>
            </div>
          </>
        )}
        {view === "new" && (
          <div className="menu-buttons">
            <div className="tabs" role="tablist">
              <button
                role="tab"
                className={mapKind === "procedural" ? "chip active" : "chip"}
                onClick={() => setMapKind("procedural")}
                data-testid="map-procedural"
              >
                {t("menu.mapProcedural")}
              </button>
              <button
                role="tab"
                className={mapKind === "real" ? "chip active" : "chip"}
                onClick={() => setMapKind("real")}
                data-testid="map-real"
              >
                {t("menu.mapReal")}
              </button>
            </div>
          </div>
        )}
        {view === "new" && mapKind === "real" && (
          <>
            <RealPlacePicker onStart={startReal} />
            <div className="menu-buttons">
              <button onClick={() => setView("main")}>{t("menu.back")}</button>
            </div>
          </>
        )}
        {view === "new" && mapKind === "procedural" && (
          <div className="menu-buttons">
            <label className="field">
              <span>{t("menu.seed")}</span>
              <div className="row">
                <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} data-testid="seed" />
                <button className="chip" onClick={() => setSeed(String(Math.floor(Math.random() * 99999)))}>
                  {t("menu.random")}
                </button>
              </div>
            </label>
            <button className="primary" onClick={start} data-testid="start">
              {t("menu.start")}
            </button>
            <button onClick={() => setView("main")}>{t("menu.back")}</button>
          </div>
        )}
        {view === "load" && (
          <div className="menu-buttons">
            {saves.length === 0 && <p className="muted">{t("menu.noSaves")}</p>}
            {saves.map((s) => (
              <div className="save-row" key={s.name}>
                <button onClick={() => load(s.name)}>
                  <strong>{s.name}</strong>
                  <small>
                    {t("menu.saveInfo", { day: s.day, survivors: s.survivors })} · {s.place ?? `#${s.seed}`} ·{" "}
                    {new Date(s.updatedAt).toLocaleString(lang)}
                  </small>
                </button>
                <button className="chip danger" onClick={() => deleteSave(s.name).then(() => listSaves().then(setSaves))}>
                  {t("menu.delete")}
                </button>
              </div>
            ))}
            {error && <p className="error">{error}</p>}
            <button onClick={() => setView("main")}>{t("menu.back")}</button>
          </div>
        )}
        {view === "help" && (
          <div className="menu-buttons">
            <HelpContent />
            <button onClick={() => setView("main")}>{t("menu.back")}</button>
          </div>
        )}
      </div>
      <p className="credits">AFTERFALL · v0.1 · AGPL-3.0</p>
    </div>
  );
}
