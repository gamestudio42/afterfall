import { TICKS_PER_GAME_MINUTE } from "@afterfall/shared";
import { useFrame, useGame, useT } from "../app/hooks";
import { useTouchUi } from "../app/media";
import { useUi } from "../app/store";
import { firstCycleStep } from "../game/firstCycle";
import { Bag } from "./common";

export function FirstCycleGuide() {
  useFrame();
  const game = useGame();
  const t = useT();
  const touch = useTouchUi();
  const ui = useUi();
  const sim = game.sim!;
  const step = ui.guideDismissed ? null : firstCycleStep(sim, ui.selectedUnits.length);
  const receipt = sim.state.delivery;
  const recent = receipt && sim.state.tick - receipt.tick < 45 * TICKS_PER_GAME_MINUTE;
  if (
    ui.buildMode ||
    ui.drawer === "build" ||
    ui.showHelp ||
    ui.showResearch ||
    ui.showEcon ||
    ui.showDawn ||
    sim.state.pendingEvent ||
    sim.state.outcome
  )
    return null;
  if (!step && !recent) return null;
  const dismiss = () => {
    ui.set({ guideDismissed: true });
    try {
      localStorage.setItem("afterfall.guideDismissed", "1");
    } catch {
      /* Private storage may be unavailable. */
    }
  };
  const home = () => {
    const p = sim.hqEntrance();
    game.focusOn(p.x, p.y);
  };
  return (
    <section className="first-cycle" data-testid="first-cycle" aria-label={t("guide.title")}>
      {step && (
        <>
          <div className="guide-heading">
            <small>{t("guide.title")}</small>
            <button className="chip" onClick={dismiss} data-testid="dismiss-guide" aria-label={t("guide.dismiss")}>
              ×
            </button>
          </div>
          <strong data-testid="guide-step">{t(`guide.${step}.title`)}</strong>
          <p>{t(`guide.${step}.text${step === "explore" && touch ? "Touch" : ""}`)}</p>
          {(step === "select" || step === "explore") && (
            <button onClick={() => game.selectSurvivors()} data-testid="guide-select">
              {t("guide.selectAction")}
            </button>
          )}
          {step === "build" && (
            <button onClick={() => ui.set({ drawer: "build" })} data-testid="guide-build">
              {t("guide.buildAction")}
            </button>
          )}
          {step === "building" && <button onClick={() => ui.set({ drawer: "tasks" })}>{t("guide.tasksAction")}</button>}
          {step === "prepare" && <button onClick={() => ui.set({ showEcon: true })}>{t("guide.economyAction")}</button>}
          {step === "return" && (
            <button
              onClick={() => {
                game.command({ type: "returnToBase", units: [...sim.survivors()].filter((e) => e.survivor.mounted < 0).map((e) => e.id) });
                home();
              }}
              data-testid="guide-return"
            >
              {t("guide.returnAction")}
            </button>
          )}
          {step === "hold" && (
            <button
              onClick={() => {
                game.showThreats();
                home();
              }}
            >
              {t("guide.holdAction")}
            </button>
          )}
        </>
      )}
      {recent && (
        <div className="delivery-receipt" data-testid="delivery-receipt">
          <strong>{t("receipt.delivered")}</strong>
          <Bag bag={receipt.resources} />
          <small>{t("receipt.hint")}</small>
        </div>
      )}
    </section>
  );
}

export function DawnModal() {
  useFrame();
  const game = useGame();
  const ui = useUi();
  const t = useT();
  const sim = game.sim!;
  const report = sim.state.econ.lastDawn;
  if (!ui.showDawn || !report || sim.state.pendingEvent || sim.state.outcome) return null;
  const flows = sim.state.econ.yesterday;
  return (
    <div className="modal-backdrop">
      <div className="modal wide-modal dawn-report" role="dialog" aria-modal="true" aria-labelledby="dawn-title" data-testid="dawn-report">
        <h2 id="dawn-title">{t("dawn.title", { night: report.day - 1 })}</h2>
        <p className="goal">{t("dawn.community", { alive: report.alive, wounded: report.wounded, infected: report.infected })}</p>
        <div className="dawn-stats">
          {report.lost !== null && <span>{t("dawn.lost", { n: report.lost })}</span>}
          {report.built !== null && <span>{t("dawn.built", { n: report.built })}</span>}
          <span>{t("dawn.hq", { hp: Math.round(report.hqHp), max: report.hqMaxHp })}</span>
        </div>
        <div className="dawn-flows">
          {(["delivered", "produced", "consumed", "wasted"] as const).map((key) => (
            <section key={key}>
              <h4>{t(`dawn.${key}`)}</h4>
              <Bag bag={flows[key] ?? {}} empty={<p className="muted">{t("dawn.none")}</p>} />
            </section>
          ))}
        </div>
        <p className="muted small">{t("econ.flowHint")}</p>
        <p className="muted small">{t("dawn.treatment", { n: report.medicineUsed })}</p>
        <h4>{t("dawn.stock")}</h4>
        <Bag bag={report.stock} />
        <p className="note">
          {t(report.infected > 0 ? "dawn.needMedicine" : report.hqHp < report.hqMaxHp ? "dawn.needRepairs" : "dawn.next")}
        </p>
        <div className="modal-actions">
          <button
            data-testid="review-community"
            onClick={() => {
              game.setSpeed(0);
              game.selectSurvivors();
              ui.set({ showDawn: false, showHelp: false, showResearch: false, showEcon: false, drawer: null });
            }}
          >
            {t("dawn.reviewCommunity")}
          </button>
          <button className="primary" data-testid="close-dawn" onClick={() => ui.set({ showDawn: false })}>
            {t("dawn.continue")}
          </button>
        </div>
      </div>
    </div>
  );
}
