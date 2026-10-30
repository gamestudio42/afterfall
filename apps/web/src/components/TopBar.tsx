import { RESOURCE_IDS } from "@afterfall/content";
import { useFrame, useGame, useT } from "../app/hooks";
import { useUi, type Speed } from "../app/store";
import { ResDot } from "./common";

const SPEEDS: Speed[] = [0, 1, 2, 4];

export function TopBar() {
  useFrame();
  const t = useT();
  const game = useGame();
  const speed = useUi((s) => s.speed);
  const sim = game.sim!;
  const c = sim.clock;
  const totals = sim.totals();
  const storage = sim.storageSummary();
  const beds = sim.state.buildings.reduce((n, b) => n + (b.hp > 0 ? b.beds : 0), 0);
  const pop = sim.survivorCount();
  const phaseIcon = c.phase === "night" ? "☾" : c.phase === "dusk" ? "◐" : c.phase === "dawn" ? "◑" : "☀";
  return (
    <header className="topbar" data-testid="topbar">
      <div className="clock">
        <span className={`phase phase-${c.phase}`}>{phaseIcon}</span>
        <strong data-testid="day">{t("hud.day", { day: c.day })}</strong>
        <span className="time" data-testid="time">
          {String(c.hour).padStart(2, "0")}:{String(c.minute).padStart(2, "0")}
        </span>
        <span className="muted">{t(`phase.${c.phase}`)}</span>
      </div>
      <div className="speeds">
        {SPEEDS.map((s) => (
          <button key={s} className={speed === s ? "chip active" : "chip"} onClick={() => game.setSpeed(s)} data-testid={`speed-${s}`}>
            {s === 0 ? "❚❚" : `${s}×`}
          </button>
        ))}
      </div>
      <div className="stat" title={t("hud.pop")}>
        <span className="muted">{t("hud.pop")}</span> <strong data-testid="pop">{pop}</strong>
        <small className={beds < pop ? "warn" : "muted"}>
          {" "}
          / {beds} {t("hud.beds")}
        </small>
      </div>
      <div className="resources">
        {RESOURCE_IDS.filter((id) => id !== "firearms" || totals.firearms > 0).map((id) => (
          <span key={id} className={`res ${id === "food" && totals.food < pop * 2 ? "warn" : ""}`} title={t(`res.${id}`)} data-testid={`res-${id}`}>
            <ResDot id={id} />
            <span className="res-name">{t(`res.${id}`)}</span>
            <strong>{Math.floor(totals[id])}</strong>
          </span>
        ))}
        <span className="res muted" title={t("hud.storage")}>
          {Math.floor(storage.used)}/{storage.capacity}
        </span>
      </div>
    </header>
  );
}
