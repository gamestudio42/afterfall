import { EVENTS } from "@afterfall/content";
import { getReport } from "@afterfall/core";
import { TICKS_PER_GAME_MINUTE } from "@afterfall/shared";
import { useFrame, useGame, useT } from "../app/hooks";
import { useUi } from "../app/store";
import { alertKey } from "../i18n";

export function Alerts() {
  useFrame();
  const t = useT();
  const game = useGame();
  const sim = game.sim!;
  const now = sim.state.tick;
  // Show alerts from the last two game hours, newest first.
  const recent = sim.state.alerts.filter((a) => now - a.tick < 120 * TICKS_PER_GAME_MINUTE).slice(-6).reverse();
  return (
    <div className="alerts" data-testid="alerts">
      {recent.map((a) => (
        <button
          key={a.id}
          className={`alert ${a.severity}`}
          onClick={() => a.pos && game.focusOn(a.pos.x, a.pos.y)}
          style={{ opacity: Math.max(0.45, 1 - (now - a.tick) / (120 * TICKS_PER_GAME_MINUTE)) }}
        >
          {t(alertKey(a.key), a.params)}
        </button>
      ))}
    </div>
  );
}

export function EventModal() {
  useFrame();
  const t = useT();
  const game = useGame();
  const sim = game.sim!;
  const ev = sim.state.pendingEvent;
  if (!ev) return null;
  const def = EVENTS.find((e) => e.id === ev.eventId);
  if (!def) return null;
  const totals = sim.totals();
  return (
    <div className="modal-backdrop">
      <div className="modal event" data-testid="event-modal">
        <small className="muted">{t("hud.day", { day: sim.clock.day })}</small>
        <h2>{t(`event.${def.id}.title`)}</h2>
        <p>{t(`event.${def.id}.text`)}</p>
        <div className="choices">
          {def.choices.map((c, i) => {
            const ok = !c.requires || totals[c.requires.resource] >= c.requires.amount;
            return (
              <button key={c.key} disabled={!ok} onClick={() => game.command({ type: "resolveEvent", choice: i })} data-testid={`choice-${i}`}>
                {t(c.key)}
                {c.requires && <small>{t("event.requires", { amount: c.requires.amount, res: t(`res.${c.requires.resource}`) })}</small>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function OutcomeModal() {
  useFrame();
  const t = useT();
  const game = useGame();
  const set = useUi((s) => s.set);
  const sim = game.sim!;
  const o = sim.state.outcome;
  const ack = sim.state.eventCooldowns["ui:outcomeAck"];
  if (!o || ack) return null;
  const r = getReport(sim);
  const victory = o.type === "victory";
  return (
    <div className="modal-backdrop">
      <div className={`modal outcome ${o.type}`} data-testid="outcome">
        <h2>{victory ? t("outcome.victory") : t("outcome.defeat")}</h2>
        <p>{victory ? t("outcome.victoryText") : t(`outcome.${o.reason}`)}</p>
        <p className="muted">{t("outcome.stats", { day: r.day, killed: r.infectedKilled, lost: r.survivorsLost, built: r.structuresBuilt })}</p>
        <div className="modal-actions">
          {victory && (
            <button className="primary" onClick={() => (sim.state.eventCooldowns["ui:outcomeAck"] = 1)}>
              {t("outcome.continue")}
            </button>
          )}
          <button onClick={() => set({ screen: "menu" })}>{t("outcome.menu")}</button>
        </div>
      </div>
    </div>
  );
}

export function Banner() {
  useFrame();
  const t = useT();
  const game = useGame();
  const buildMode = useUi((s) => s.buildMode);
  const speed = useUi((s) => s.speed);
  const sim = game.sim!;
  if (!sim.state.started)
    return (
      <div className="banner" data-testid="choose-base">
        <strong>{t("banner.chooseBase")}</strong>
        <small>{t("banner.chooseBaseHint")}</small>
      </div>
    );
  if (buildMode)
    return (
      <div className="banner">
        <strong>{t(`struct.${buildMode}`)}</strong>
        <small>{t("banner.build")}</small>
      </div>
    );
  if (speed === 0) return <div className="banner subtle">{t("hud.paused")}</div>;
  return null;
}

export function DragRect() {
  const r = useUi((s) => s.dragRect);
  if (!r) return null;
  return (
    <div
      className="drag-rect"
      style={{ left: Math.min(r.x0, r.x1), top: Math.min(r.y0, r.y1), width: Math.abs(r.x1 - r.x0), height: Math.abs(r.y1 - r.y0) }}
    />
  );
}

export function DevOverlay() {
  useFrame();
  const game = useGame();
  const show = useUi((s) => s.showDev);
  if (!show) return null;
  const sim = game.sim!;
  let infected = 0;
  for (const _ of sim.infected()) infected++;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return (
    <pre className="dev" data-testid="dev">
      {`FPS        ${game.fps.toFixed(0)}
tick       ${sim.tickMs.toFixed(3)} ms
entities   ${sim.state.entities.size} (infected ${infected})
draw calls ${game.renderer.drawCalls}
nav fails  ${sim.state.stats.navFailures}
tasks      ${sim.state.tasks.size}
memory     ${mem ? (mem.usedJSHeapSize / 1048576).toFixed(0) + " MB" : "n/a"}
seed       ${sim.state.seed}  tick ${sim.state.tick}`}
    </pre>
  );
}

export function Toast() {
  const toast = useUi((s) => s.toast);
  if (!toast) return null;
  return <div className="toast">{toast}</div>;
}
