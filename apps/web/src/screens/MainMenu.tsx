import { useEffect, useState, type CSSProperties } from "react";
import { desktop } from "../app/desktop";
import { publicAssetUrl } from "../app/publicUrl";
import { deleteSave, getSave, listSaves, type SaveSlot } from "../app/saves";
import { useGame, useT } from "../app/hooks";
import { useUi } from "../app/store";
import { HelpContent } from "../components/Help";
import { RealPlacePicker } from "../components/RealPlacePicker";
import { CITY_SIZES, type CityMap, type CitySize } from "@afterfall/world";

type View = "main" | "new" | "load" | "help";
type CityStyle = "varied" | "classic";

/** The street plan and size the player last chose for a generated city, remembered per browser. */
const STYLE_KEY = "afterfall.cityStyle";
const SIZE_KEY = "afterfall.citySize";

function readSize(): CitySize {
  try {
    const v = localStorage.getItem(SIZE_KEY);
    return v && v in CITY_SIZES ? (v as CitySize) : "medium";
  } catch {
    return "medium";
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private window or blocked storage: the choice just is not remembered.
  }
}

function readStyle(): CityStyle {
  try {
    return localStorage.getItem(STYLE_KEY) === "classic" ? "classic" : "varied";
  } catch {
    return "varied";
  }
}

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
  const [style, setStyleState] = useState<CityStyle>(readStyle);
  const setStyle = (next: CityStyle) => {
    setStyleState(next);
    remember(STYLE_KEY, next);
  };
  const [size, setSizeState] = useState<CitySize>(readSize);
  const setSize = (next: CitySize) => {
    setSizeState(next);
    remember(SIZE_KEY, next);
  };

  const start = () => {
    game.newGame(Number(seed) || 1, undefined, style, size);
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
    <div
      className="menu"
      style={
        {
          "--menu-bg": `url("${publicAssetUrl(import.meta.env.BASE_URL, "art/menu_bg.jpg", document.baseURI)}")`,
        } as CSSProperties
      }
    >
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
              {desktop && (
                <button onClick={() => desktop?.quit()} data-testid="quit">
                  {t("menu.quit")}
                </button>
              )}
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
            <div className="field">
              <span>{t("menu.cityStyle")}</span>
              <div className="row">
                <button
                  className={style === "varied" ? "chip active" : "chip"}
                  onClick={() => setStyle("varied")}
                  data-testid="style-varied"
                >
                  {t("menu.styleVaried")}
                </button>
                <button
                  className={style === "classic" ? "chip active" : "chip"}
                  onClick={() => setStyle("classic")}
                  data-testid="style-classic"
                >
                  {t("menu.styleClassic")}
                </button>
              </div>
            </div>
            {style === "varied" && (
              <div className="field">
                <span>{t("menu.citySize")}</span>
                <div className="row">
                  {(Object.keys(CITY_SIZES) as CitySize[]).map((k) => (
                    <button key={k} className={size === k ? "chip active" : "chip"} onClick={() => setSize(k)} data-testid={`size-${k}`}>
                      {t(`menu.size.${k}`, { m: CITY_SIZES[k] })}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
