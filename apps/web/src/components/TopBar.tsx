import { RESOURCE_IDS } from "@afterfall/content";
import { useFrame, useGame, useT } from "../app/hooks";
import { useUi, type Speed } from "../app/store";
import { ResDot } from "./common";
import { Icon } from "./icons";

const SPEEDS: Speed[] = [0, 1, 2, 4];

export function TopBar() {
  useFrame();
  const t = useT();
  const game = useGame();
  const speed = useUi((s) => s.speed);
  const volume = useUi((s) => s.volume);
  const muted = useUi((s) => s.muted);
  const set = useUi((s) => s.set);
  const sim = game.sim!;
  const c = sim.clock;
  const totals = sim.totals();
  const storage = sim.storageSummary();
  const beds = sim.state.buildings.reduce((n, b) => n + (b.hp > 0 ? b.beds : 0), 0);
  const pop = sim.survivorCount();
  const phaseIcon = c.phase === "night" ? "☾" : c.phase === "dusk" ? "◐" : c.phase === "dawn" ? "◑" : "☀";
  const weather = game.renderer.weather;
  const weatherIcon = weather === "rain" ? "☂" : weather === "fog" ? "≋" : weather === "overcast" ? "☁" : "";
  // Where the day stands, 0 at midnight and 1 at the next: the strip under the bar.
  const dayFraction = (c.hour + c.minute / 60) / 24;
  return (
    <header className="topbar" data-testid="topbar">
      <div className="clock">
        <span className={`phase phase-${c.phase}`}>{phaseIcon}</span>
        <strong data-testid="day">{t("hud.day", { day: c.day })}</strong>
        <span className="time" data-testid="time">
          {String(c.hour).padStart(2, "0")}:{String(c.minute).padStart(2, "0")}
        </span>
        <span className="muted">{t(`phase.${c.phase}`)}</span>
        {weather !== "clear" && (
          <span className="weather" data-testid="weather" title={t(`weather.${weather}`)}>
            {weatherIcon} {t(`weather.${weather}`)}
          </span>
        )}
      </div>
      <div className="speeds">
        {SPEEDS.map((s) => (
          <button key={s} className={speed === s ? "chip active" : "chip"} onClick={() => game.setSpeed(s)} data-testid={`speed-${s}`}>
            {s === 0 ? "❚❚" : `${s}×`}
          </button>
        ))}
      </div>
      <div className="audio" data-testid="audio">
        <button
          className={muted ? "chip active" : "chip"}
          title={t("hud.mute")}
          aria-label={t("hud.mute")}
          data-testid="mute"
          onClick={() => {
            const next = !muted;
            set({ muted: next });
            try {
              localStorage.setItem("afterfall.muted", next ? "1" : "0");
            } catch {
              /* storage unavailable */
            }
          }}
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(volume * 100)}
          title={t("hud.volume")}
          aria-label={t("hud.volume")}
          data-testid="volume"
          onChange={(e) => {
            const next = Number(e.target.value) / 100;
            set({ volume: next });
            try {
              localStorage.setItem("afterfall.volume", String(next));
            } catch {
              /* storage unavailable */
            }
          }}
        />
      </div>
      <div className="stat" title={t("hud.pop")}>
        <Icon name="people" size={14} />
        <span className="muted">{t("hud.pop")}</span> <strong data-testid="pop">{pop}</strong>
        <small className={beds < pop ? "warn" : "muted"}>
          {" "}
          / <Icon name="beds" size={12} /> {beds} {t("hud.beds")}
        </small>
      </div>
      <div className="resources">
        {RESOURCE_IDS.filter((id) => id !== "firearms" || totals.firearms > 0).map((id) => (
          <span
            key={id}
            className={`res ${id === "food" && totals.food < pop * 2 ? "warn" : ""}`}
            title={t(`res.${id}`)}
            data-testid={`res-${id}`}
          >
            <ResDot id={id} />
            <span className="res-name">{t(`res.${id}`)}</span>
            <strong>{Math.floor(totals[id])}</strong>
          </span>
        ))}
        <span className="res muted" title={t("hud.storage")}>
          {Math.floor(storage.used)}/{storage.capacity}
        </span>
      </div>
      <div className="panels">
        <button
          className={`chip panel-open ${sim.state.research.points > 0 ? "ready" : ""}`}
          data-testid="open-research"
          title={t("research.title")}
          onClick={() => set({ showResearch: true })}
        >
          {t("research.chip", { n: Math.floor(sim.state.research.points) })}
        </button>
        <button className="chip" data-testid="open-econ" title={t("econ.title")} onClick={() => set({ showEcon: true })}>
          {t("econ.chip")}
        </button>
      </div>
      {/* The day as a strip: night, dawn, day, dusk, night, with a marker for now. */}
      <div className="daybar" aria-hidden="true">
        <i style={{ left: `${(dayFraction * 100).toFixed(2)}%` }} />
      </div>
    </header>
  );
}
