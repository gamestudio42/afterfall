import { useState } from "react";
import { STRUCTURES, type StructureKind } from "@afterfall/content";
import { useFrame, useGame, useT } from "../app/hooks";
import { useUi } from "../app/store";
import { Bag } from "./common";
import type { OverlayMode } from "@afterfall/renderer";

const KINDS: StructureKind[] = ["wall", "gate", "tower", "farm", "well"];

export function BottomBar() {
  useFrame();
  const t = useT();
  const game = useGame();
  const sim = game.sim!;
  const ui = useUi();
  const [open, setOpen] = useState<"build" | "policies" | null>(null);
  const totals = sim.totals();
  const started = sim.state.started;
  const p = sim.state.policies;

  const save = async () => {
    await game.save("manual");
    ui.set({ toast: t("saved") });
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
                onClick={() => ui.set({ buildMode: ui.buildMode === k ? null : k, selectedUnits: [], selectedBuilding: -1 })}
              >
                <strong>{t(`struct.${k}`)}</strong>
                <small>{t(`struct.desc.${k}`)}</small>
                <Bag bag={def.cost} />
              </button>
            );
          })}
        </div>
      )}
      {open === "policies" && (
        <div className="drawer policies">
          <label>
            {t("policy.keepAmmo")}
            <input type="number" min={0} step={10} value={p.keepAmmo} onChange={(e) => game.command({ type: "setPolicy", policy: { keepAmmo: Number(e.target.value) } })} />
          </label>
          <label>
            {t("policy.autoRepair")}
            <select value={p.autoRepairBelow} onChange={(e) => game.command({ type: "setPolicy", policy: { autoRepairBelow: Number(e.target.value) } })}>
              {[0, 0.5, 0.7, 0.9].map((v) => (
                <option key={v} value={v}>
                  {Math.round(v * 100)}%
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={p.recallBeforeDusk} onChange={(e) => game.command({ type: "setPolicy", policy: { recallBeforeDusk: e.target.checked } })} />
            {t("policy.recall")}
          </label>
          <label className="check">
            <input type="checkbox" checked={p.autoDefend} onChange={(e) => game.command({ type: "setPolicy", policy: { autoDefend: e.target.checked } })} />
            {t("policy.autoDefend")}
          </label>
        </div>
      )}
      <div className="bar">
        <button className={open === "build" ? "active" : ""} disabled={!started} data-testid="open-build" onClick={() => setOpen(open === "build" ? null : "build")}>
          {t("bar.build")}
        </button>
        <div className="squads">
          <span className="muted">{t("bar.squads")}</span>
          {sim.state.squads.length === 0 && <small className="muted">{t("bar.noSquads")}</small>}
          {sim.state.squads.map((s) => (
            <button key={s.id} className="chip" onClick={() => ui.set({ selectedUnits: [...s.members], selectedBuilding: -1, selectedStructure: -1 })}>
              {s.name} · {s.members.length}
            </button>
          ))}
        </div>
        <div className="views">
          <span className="muted">{t("bar.view")}</span>
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
