import type { Task } from "@afterfall/core";
import { STRUCTURES, type StructureKind } from "@afterfall/content";
import { useFrame, useGame, useT } from "../app/hooks";
import { useUi } from "../app/store";
import { Bag } from "./common";
import { Worksite } from "./Worksite";
import type { OverlayMode } from "@afterfall/renderer";

const KINDS: StructureKind[] = ["wall", "gate", "tower", "farm", "well"];

export function BottomBar() {
  useFrame();
  const t = useT();
  const game = useGame();
  const sim = game.sim!;
  const ui = useUi();
  const open = ui.drawer;
  const setOpen = (drawer: typeof open) => ui.set({ drawer });
  const totals = sim.totals();
  const started = sim.state.started;
  const p = sim.state.policies;

  const save = async () => {
    try {
      await game.save("manual");
      ui.set({ toast: t("saved") });
    } catch {
      ui.set({ toast: t("saveFailed") });
    }
    setTimeout(() => useUi.getState().set({ toast: null }), 1800);
  };

  return (
    <footer className="bottombar">
      {open === "build" && started && (
        <div className="drawer" data-testid="build-menu">
          {KINDS.map((k) => {
            const def = STRUCTURES[k];
            const ok = Object.entries(def.cost).every(([r, v]) => totals[r as keyof typeof totals] >= (v ?? 0));
            return (
              <button
                key={k}
                className={`build-item ${ui.buildMode === k ? "active" : ""}`}
                data-testid={`build-${k}`}
                disabled={!ok}
                onClick={() =>
                  ui.set({ buildMode: ui.buildMode === k ? null : k, selectedUnits: [], selectedBuilding: -1, buildRejection: null })
                }
              >
                <strong>{t(`struct.${k}`)}</strong>
                <small>{t(`struct.desc.${k}`)}</small>
                <Bag bag={def.cost} />
              </button>
            );
          })}
        </div>
      )}
      {open === "tasks" && (
        <div className="drawer tasks" data-testid="task-menu">
          {[...sim.state.tasks.values()].length === 0 && <small className="muted">{t("tasks.none")}</small>}
          {[...sim.state.tasks.values()]
            .sort((a, b) => b.priority - a.priority || a.id - b.id)
            .map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
        </div>
      )}
      {open === "policies" && (
        <div className="drawer policies">
          <label>
            {t("policy.keepAmmo")}
            <input
              type="number"
              min={0}
              step={10}
              value={p.keepAmmo}
              onChange={(e) => game.command({ type: "setPolicy", policy: { keepAmmo: Number(e.target.value) } })}
            />
          </label>
          <label>
            {t("policy.haulAbove")}
            <select
              value={p.haulAbove ?? 0.9}
              onChange={(e) => game.command({ type: "setPolicy", policy: { haulAbove: Number(e.target.value) } })}
            >
              {[0.6, 0.75, 0.9, 1].map((v) => (
                <option key={v} value={v}>
                  {Math.round(v * 100)}%
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("policy.autoRepair")}
            <select
              value={p.autoRepairBelow}
              onChange={(e) => game.command({ type: "setPolicy", policy: { autoRepairBelow: Number(e.target.value) } })}
            >
              {[0, 0.5, 0.7, 0.9].map((v) => (
                <option key={v} value={v}>
                  {Math.round(v * 100)}%
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={p.recallBeforeDusk}
              onChange={(e) => game.command({ type: "setPolicy", policy: { recallBeforeDusk: e.target.checked } })}
            />
            {t("policy.recall")}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={p.autoDefend}
              onChange={(e) => game.command({ type: "setPolicy", policy: { autoDefend: e.target.checked } })}
            />
            {t("policy.autoDefend")}
          </label>
        </div>
      )}
      <div className="bar">
        <button
          className={open === "build" ? "active" : ""}
          disabled={!started}
          data-testid="open-build"
          onClick={() => setOpen(open === "build" ? null : "build")}
        >
          {t("bar.build")}
        </button>
        <button
          className={open === "tasks" ? "active" : ""}
          disabled={!started}
          data-testid="open-tasks"
          onClick={() => setOpen(open === "tasks" ? null : "tasks")}
        >
          {t("bar.tasks")}
        </button>
        <div className="squads">
          <span className="muted squad-label">{t("bar.squads")}</span>
          {sim.state.squads.length === 0 && <small className="muted squad-hint">{t("bar.noSquads")}</small>}
          {sim.state.squads.map((s) => (
            <button
              key={s.id}
              className="chip"
              onClick={() => ui.set({ selectedUnits: [...s.members], selectedBuilding: -1, selectedStructure: -1 })}
            >
              {s.name} · {s.members.length}
            </button>
          ))}
        </div>
        <div className="views">
          <span className="muted view-label">{t("bar.view")}</span>
          {(["none", "resources", "danger"] as OverlayMode[]).map((m) => (
            <button
              key={m}
              className={ui.overlay === m ? "chip active" : "chip"}
              onClick={() => {
                game.renderer.overlay = m;
                ui.set({ overlay: m });
              }}
            >
              {t(`view.${m}`)}
            </button>
          ))}
        </div>
        <button className={open === "policies" ? "active" : ""} onClick={() => setOpen(open === "policies" ? null : "policies")}>
          {t("bar.policies")}
        </button>
        <button onClick={save} disabled={!started} data-testid="save">
          {t("bar.save")}
        </button>
        <button onClick={() => ui.set({ showHelp: true })}>{t("bar.help")}</button>
        <button
          onClick={async () => {
            if (started) await game.save("autosave");
            ui.set({ screen: "menu" });
          }}
        >
          {t("bar.menu")}
        </button>
      </div>
    </footer>
  );
}

function TaskRow({ task }: { task: Task }) {
  const t = useT();
  const game = useGame();
  const ui = useUi();
  const sim = game.sim!;
  const structures = task.structures.map((id) => sim.state.entities.get(id)).filter((e) => !!e?.structure);
  const target = structures.find((e) => !e!.structure!.built) ?? structures[0];
  const building = task.building >= 0 ? sim.state.buildings[task.building] : undefined;
  const destination = task.convertTo
    ? t(`fn.${task.convertTo}`)
    : building
      ? t(building.fn === "none" ? `building.${sim.city.buildings[building.index].type}` : `fn.${building.fn}`)
      : target?.structure
        ? t(`struct.${target.structure.kind}`)
        : "";
  const inspect = () => {
    if (!building && !target) return;
    ui.set({
      selectedUnits: [],
      selectedBuilding: building?.index ?? -1,
      selectedStructure: building ? -1 : target!.id,
      buildMode: null,
      buildRejection: null,
      drawer: null,
    });
    game.focusSelection();
  };
  return (
    <div className="task-row" data-testid={`task-${task.id}`}>
      <div className="task-heading">
        <span className={`dot ${task.status}`} aria-hidden="true" />
        <strong>
          {t(`task.${task.type}`)}
          {destination && ` · ${destination}`}
        </strong>
      </div>
      <small className="muted">
        {t(`status.${task.status}`)} · {t("tasks.workers", { n: task.assigned.length, max: task.maxWorkers })} ·{" "}
        {t("tasks.priority", { n: task.priority })}
      </small>
      {task.type === "build" && (
        <small>{t("worksite.pieces", { n: structures.filter((e) => e!.structure!.built).length, total: structures.length })}</small>
      )}
      <Worksite sim={sim} task={task} compact />
      {task.type === "guard" && task.status === "pending" && <small className="muted">{t("tasks.guardWait")}</small>}
      <div className="task-actions">
        <button disabled={!building && !target} data-testid={`task-focus-${task.id}`} onClick={inspect}>
          {t("worksite.inspect")}
        </button>
        <span className="task-priority">
          <button
            data-testid={`task-up-${task.id}`}
            disabled={task.priority >= 100}
            title={t("tasks.raise")}
            aria-label={t("tasks.raise")}
            onClick={() => game.command({ type: "setTaskPriority", task: task.id, priority: Math.min(100, task.priority + 10) })}
          >
            ↑
          </button>
          <button
            data-testid={`task-down-${task.id}`}
            disabled={task.priority <= 0}
            title={t("tasks.lower")}
            aria-label={t("tasks.lower")}
            onClick={() => game.command({ type: "setTaskPriority", task: task.id, priority: Math.max(0, task.priority - 10) })}
          >
            ↓
          </button>
        </span>
      </div>
    </div>
  );
}
