import type { ReactElement } from "react";
import { BUILDING_FUNCTIONS, BUILDING_TYPES, STRUCTURES, bagTotal, type BuildingFunction } from "@afterfall/content";
import { outstanding, type Entity, type Simulation, type Stance } from "@afterfall/core";
import { useFrame, useGame, useT } from "../app/hooks";
import { useUi } from "../app/store";
import { Bag, Meter, Row } from "./common";

export function SidePanel() {
  useFrame();
  const game = useGame();
  const sim = game.sim!;
  const units = useUi((s) => s.selectedUnits);
  const building = useUi((s) => s.selectedBuilding);
  const structure = useUi((s) => s.selectedStructure);
  let body: ReactElement | null = null;
  if (units.length > 0) body = <UnitsPanel sim={sim} ids={units} />;
  else if (structure >= 0 && sim.state.entities.has(structure)) body = <StructurePanel sim={sim} id={structure} />;
  else if (building >= 0) body = <BuildingPanel sim={sim} index={building} />;
  if (!body) return null;
  return (
    <aside className="side-panel" data-testid="side-panel">
      {body}
    </aside>
  );
}

function dangerLevel(sim: Simulation, index: number): string {
  const b = sim.state.buildings[index];
  if (!b.explored) return "unknown";
  if (b.hiddenInfected === 0) return "none";
  if (b.hiddenInfected <= 2) return "low";
  if (b.hiddenInfected <= 5) return "medium";
  return "high";
}

function BuildingPanel({ sim, index }: { sim: Simulation; index: number }) {
  const t = useT();
  const game = useGame();
  const units = useUi((s) => s.selectedUnits);
  const def = sim.city.buildings[index];
  const st = sim.state.buildings[index];
  const area = Math.round(def.area);
  const searched = st.searchTotal > 0 ? Math.round((st.searchProgress / st.searchTotal) * 100) : 100;
  const task = st.task >= 0 ? sim.state.tasks.get(st.task) : undefined;
  const repair = [...sim.state.tasks.values()].find((x) => x.type === "repair" && x.building === index);
  const noBase = sim.state.hq < 0;
  const danger = dangerLevel(sim, index);
  const fns = BUILDING_TYPES[def.type].adaptations.filter((f) => f !== "none" && f !== "hq") as BuildingFunction[];
  const totals = sim.totals();
  return (
    <>
      <div className="panel-head">
        <i className="swatch" style={{ background: `#${BUILDING_TYPES[def.type].color.toString(16).padStart(6, "0")}` }} />
        <div>
          <h3 data-testid="panel-title">{t(`building.${def.type}`)}</h3>
          <small className="muted">
            {t(`fn.${st.fn}`)} · {t("panel.floors", { n: def.floors })} · {t("panel.area", { n: area })}
          </small>
        </div>
      </div>
      {st.cache && <p className="note good">{t("panel.cache")}</p>}
      {noBase && (
        <div className="panel-section">
          <p className="muted small">{t("banner.chooseBaseHint")}</p>
          <button className="primary wide" data-testid="set-base" onClick={() => game.command({ type: "setBase", building: index })}>
            {t("panel.setBase")}
          </button>
        </div>
      )}
      {st.fn !== "none" && (
        <div className="panel-section">
          <Row label={t("panel.condition")}>
            {Math.round(st.hp)}/{st.maxHp}
          </Row>
          <Meter value={st.hp} max={st.maxHp} color={st.hp / st.maxHp > 0.5 ? "#5fd36b" : "#e0503c"} />
          {st.beds > 0 && (
            <Row label={t("panel.beds")}>
              {st.occupants.length}/{st.beds}
            </Row>
          )}
          {st.storageCapacity > 0 && (
            <>
              <Row label={t("panel.stock")}>
                {Math.floor(bagTotal(st.storage))}/{st.storageCapacity}
              </Row>
              <Bag bag={st.storage} />
            </>
          )}
          {repair && <p className="note">{t("panel.repairing")}</p>}
        </div>
      )}
      {st.fn === "none" && !noBase && (
        <div className="panel-section">
          <Row label={t("panel.searched")}>{st.explored ? `${searched}%` : "—"}</Row>
          <Meter value={searched} color="#d8b25a" />
          <Row label={t("panel.danger")}>
            <span className={`danger-${danger}`}>{t(`panel.danger.${danger}`)}</span>
          </Row>
          <h4>{t("panel.loot")}</h4>
          {st.explored ? <Bag bag={st.remainingLoot} empty={<p className="muted small">{t("panel.depleted")}</p>} /> : <p className="muted small">{t("panel.lootUnknown")}</p>}
          {units.length > 0 && searched < 100 ? (
            <button className="primary wide" data-testid="scavenge" onClick={() => game.command({ type: "scavenge", units, building: index })}>
              {t("panel.scavenge")}
            </button>
          ) : (
            searched < 100 && <p className="muted small">{t("panel.scavengeHint")}</p>
          )}
        </div>
      )}
      {st.fn === "none" && !noBase && (
        <div className="panel-section">
          <h4>{t("panel.convert")}</h4>
          {task ? (
            <>
              <Row label={t("panel.converting", { fn: t(`fn.${task.convertTo}`) })}>{Math.round((task.progress / task.work) * 100)}%</Row>
              <Meter value={task.progress} max={task.work} color="#6fd0ff" />
              {task.status === "blocked" && <p className="note warn">{t("panel.waiting")}</p>}
              <Row label={t("panel.workers")}>{task.assigned.length}</Row>
              <button className="wide" onClick={() => game.command({ type: "cancelTask", task: task.id })}>
                {t("panel.cancel")}
              </button>
            </>
          ) : st.hiddenInfected > 0 || !st.explored ? (
            <p className="muted small">{t("panel.convertNeedsClear")}</p>
          ) : (
            <div className="convert-list">
              {fns.map((fn) => {
                const cost = BUILDING_FUNCTIONS[fn].cost;
                const ok = Object.entries(cost).every(([r, v]) => totals[r as keyof typeof totals] >= (v ?? 0));
                return (
                  <button key={fn} className="convert" disabled={!ok} data-testid={`convert-${fn}`} onClick={() => game.command({ type: "convert", building: index, fn })}>
                    <strong>{t(`fn.${fn}`)}</strong>
                    <small>{t(`fn.desc.${fn}`)}</small>
                    <Bag bag={cost} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function activityLabel(t: ReturnType<typeof useT>, sim: Simulation, e: Entity): string {
  const a = e.survivor!.activity;
  if (a.type === "task") {
    const task = sim.state.tasks.get(a.task);
    return `${t("activity.task")} · ${task ? t(`task.${task.type}`) : ""}`;
  }
  if (a.type === "scavenge") return `${t("activity.scavenge")} · ${t(`building.${sim.city.buildings[a.building].type}`)}`;
  return t(`activity.${a.type}`);
}

function UnitsPanel({ sim, ids }: { sim: Simulation; ids: number[] }) {
  const t = useT();
  const game = useGame();
  const set = useUi((s) => s.set);
  const units = ids.map((id) => sim.state.entities.get(id)).filter((e): e is Entity => !!e?.survivor);
  if (units.length === 0) return null;
  const stance = units[0].survivor!.stance;
  const setStance = (s: Stance) => game.command({ type: "setStance", units: ids, stance: s });
  return (
    <>
      <div className="panel-head">
        <div>
          <h3 data-testid="panel-title">{units.length === 1 ? units[0].survivor!.name : t("panel.selected", { n: units.length })}</h3>
          {units.length === 1 && <small className="muted">{units[0].survivor!.manual ? t("panel.manual") : t("panel.automatic")}</small>}
        </div>
      </div>
      {units.length === 1 ? (
        <SurvivorDetail sim={sim} e={units[0]} />
      ) : (
        <div className="unit-list">
          {units.map((e) => (
            <button key={e.id} className="unit-row" onClick={() => set({ selectedUnits: [e.id] })}>
              <span>{e.survivor!.name}</span>
              <Meter value={e.health!.hp} color={e.health!.hp > 60 ? "#5fd36b" : "#e0503c"} />
              <small className="muted">{activityLabel(t, sim, e)}</small>
            </button>
          ))}
        </div>
      )}
      <div className="panel-section">
        <Row label={t("panel.stance")}>
          <span className="chips">
            {(["aggressive", "defensive", "passive"] as Stance[]).map((s) => (
              <button key={s} className={stance === s ? "chip active" : "chip"} onClick={() => setStance(s)}>
                {t(`stance.${s}`)}
              </button>
            ))}
          </span>
        </Row>
        <div className="button-grid">
          <button onClick={() => game.command({ type: "returnToBase", units: ids })} data-testid="return-base">
            {t("panel.returnBase")} <kbd>H</kbd>
          </button>
          <button onClick={() => game.command({ type: "stop", units: ids })}>{t("panel.stop")}</button>
          <button onClick={() => game.command({ type: "setAuto", units: ids })} data-testid="auto-work">
            {t("panel.auto")}
          </button>
          <button
            onClick={() => {
              const used = new Set(sim.state.squads.map((s) => s.name));
              const n = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((k) => !used.has(String(k))) ?? 9;
              game.command({ type: "createSquad", units: ids, name: String(n) });
            }}
          >
            {t("panel.createSquad")}
          </button>
        </div>
      </div>
    </>
  );
}

function SurvivorDetail({ sim, e }: { sim: Simulation; e: Entity }) {
  const t = useT();
  const s = e.survivor!;
  const h = e.health!;
  return (
    <div className="panel-section">
      <p className="activity">{activityLabel(t, sim, e)}</p>
      <Row label={t("panel.health")}>{t("panel.hp", { hp: Math.round(h.hp), max: h.max })}</Row>
      <Meter value={h.hp} max={h.max} color={h.hp > 60 ? "#5fd36b" : h.hp > 30 ? "#f0c040" : "#e0503c"} />
      <Row label={t("panel.morale")}>{Math.round(s.morale)}</Row>
      <Meter value={s.morale} color="#6fb4ff" />
      <Row label={t("panel.fatigue")}>{Math.round(s.fatigue)}</Row>
      <Meter value={s.fatigue} color="#b58cff" />
      {s.hunger > 0 && (
        <>
          <Row label={t("panel.hunger")}>{Math.round(s.hunger)}</Row>
          <Meter value={s.hunger} color="#e3b35a" />
        </>
      )}
      {s.infected && (
        <>
          <Row label={<span className="warn">{t("panel.infection")}</span>}>{Math.round(s.infection)}%</Row>
          <Meter value={s.infection} color="#9fbf6a" />
        </>
      )}
      <Row label={t("panel.weapon")}>
        {t(`weapon.${s.weapon}`)}
        {s.weapon !== "crowbar" && ` · ${s.ammo}`}
      </Row>
      {bagTotal(s.carry) > 0 && (
        <>
          <h4>{t("panel.carrying")}</h4>
          <Bag bag={s.carry} />
        </>
      )}
      <h4>{t("panel.skills")}</h4>
      <div className="skills">
        {(Object.keys(s.skills) as (keyof typeof s.skills)[]).map((k) => (
          <span key={k}>
            {t(`skill.${k}`)} <strong>{s.skills[k]}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function StructurePanel({ sim, id }: { sim: Simulation; id: number }) {
  const t = useT();
  const game = useGame();
  const e = sim.state.entities.get(id)!;
  const s = e.structure!;
  const def = STRUCTURES[s.kind];
  const task = s.task >= 0 ? sim.state.tasks.get(s.task) : undefined;
  return (
    <>
      <div className="panel-head">
        <i className="swatch" style={{ background: `#${def.color.toString(16).padStart(6, "0")}` }} />
        <div>
          <h3 data-testid="panel-title">{t(`struct.${s.kind}`)}</h3>
          <small className="muted">{s.built ? t(`struct.desc.${s.kind}`) : t("panel.blueprint")}</small>
        </div>
      </div>
      <div className="panel-section">
        {s.built && e.health && (
          <>
            <Row label={t("panel.condition")}>
              {Math.round(e.health.hp)}/{e.health.max}
            </Row>
            <Meter value={e.health.hp} max={e.health.max} color="#5fd36b" />
          </>
        )}
        {!s.built && task && (
          <>
            <Row label={t("panel.progress")}>{Math.round((task.progress / task.work) * 100)}%</Row>
            <Meter value={task.progress} max={task.work} color="#6fd0ff" />
            <Row label={t("panel.workers")}>{task.assigned.length}</Row>
            {bagTotal(outstanding(task)) > 0 && <Bag bag={outstanding(task)} />}
            {task.status === "blocked" && <p className="note warn">{t("panel.waiting")}</p>}
          </>
        )}
        {s.built && task && (
          <Row label={t(`task.${task.type}`)}>
            {task.assigned.map((w) => sim.state.entities.get(w)?.survivor?.name).filter(Boolean).join(", ") || "—"}
          </Row>
        )}
        <button className="wide" onClick={() => game.command({ type: "demolish", structure: id })}>
          {s.built ? t("panel.demolish") : t("panel.cancel")}
        </button>
      </div>
    </>
  );
}
