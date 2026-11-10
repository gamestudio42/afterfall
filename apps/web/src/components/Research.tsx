import { BALANCE, RESOURCE_IDS, TECH_BRANCHES, techsOfBranch, type ResourceId } from "@afterfall/content";
import { useFrame, useGame, useT } from "../app/hooks";
import { useUi } from "../app/store";

/**
 * Research and the ledger. Two panels because they answer two different
 * questions: "what can I become?" and "what am I spending?".
 */
export function ResearchModal() {
  useFrame();
  const t = useT();
  const game = useGame();
  const set = useUi((s) => s.set);
  const sim = game.sim!;
  const r = sim.state.research;
  const cure = r.cure;
  const lab = sim.standingLab();

  return (
    <div className="modal-backdrop" onClick={() => set({ showResearch: false })}>
      <div className="modal wide-modal" onClick={(e) => e.stopPropagation()} data-testid="research">
        <h2>{t("research.title")}</h2>
        <div className="research-head">
          <span className="points" data-testid="research-points">
            {t("research.points", { n: Math.floor(r.points) })}
          </span>
          <span className="muted small">{t("research.hint")}</span>
        </div>
        <div className="tech-grid">
          {TECH_BRANCHES.map((branch) => (
            <div className="tech-branch" key={branch}>
              <h4>{t(`branch.${branch}`)}</h4>
              {techsOfBranch(branch).map((tech) => {
                const unlocked = r.unlocked.includes(tech.id);
                const locked = !!tech.requires && !r.unlocked.includes(tech.requires);
                const afford = r.points >= tech.cost;
                return (
                  <button
                    key={tech.id}
                    className={`tech ${unlocked ? "done" : ""}`}
                    disabled={unlocked || locked || !afford}
                    data-testid={`tech-${tech.id}`}
                    onClick={() => game.command({ type: "unlockTech", tech: tech.id })}
                  >
                    <strong>{t(`tech.${tech.id}`)}</strong>
                    <small>{t(`tech.desc.${tech.id}`)}</small>
                    <span className="cost">{unlocked ? t("research.done") : t("research.cost", { n: tech.cost })}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="cure-row">
          <h4>{t("cure.title")}</h4>
          <p className="muted small">{t("cure.hint")}</p>
          {cure.started ? (
            <p data-testid="cure-status">
              {lab ? t("cure.progress", { n: cure.progress, total: BALANCE.research.cureDawns }) : t("cure.stalled")}
            </p>
          ) : (
            <button
              className="primary"
              data-testid="start-cure"
              disabled={
                !sim.hasTech("cure") ||
                !lab ||
                r.points < BALANCE.research.cureResearch ||
                sim.totals().medicine < BALANCE.research.cureMedicine
              }
              onClick={() => game.command({ type: "startCure" })}
            >
              {t("cure.start", { medicine: BALANCE.research.cureMedicine, research: BALANCE.research.cureResearch })}
            </button>
          )}
        </div>
        <div className="modal-actions">
          <button onClick={() => set({ showResearch: false })}>{t("research.close")}</button>
        </div>
      </div>
    </div>
  );
}

export function EconomyModal() {
  useFrame();
  const t = useT();
  const game = useGame();
  const set = useUi((s) => s.set);
  const sim = game.sim!;
  const stock = sim.totals();
  const { produced, consumed, wasted } = sim.state.econ.yesterday;
  const pop = sim.survivorCount();
  let worst: { id: ResourceId; days: number } | null = null;
  for (const id of RESOURCE_IDS) {
    const eat = consumed[id] ?? 0;
    if (eat <= 0) continue;
    const days = (stock[id] ?? 0) / eat;
    if (!worst || days < worst.days) worst = { id, days };
  }
  return (
    <div className="modal-backdrop" onClick={() => set({ showEcon: false })}>
      <div className="modal wide-modal" onClick={(e) => e.stopPropagation()} data-testid="economy">
        <h2>{t("econ.title")}</h2>
        <p className="muted small">{t("econ.subtitle", { day: sim.state.econ.day - 1, pop })}</p>
        <table className="ledger">
          <thead>
            <tr>
              <th>{t("econ.resource")}</th>
              <th>{t("econ.produced")}</th>
              <th>{t("econ.consumed")}</th>
              <th>{t("econ.wasted")}</th>
              <th>{t("econ.stock")}</th>
              <th>{t("econ.days")}</th>
            </tr>
          </thead>
          <tbody>
            {RESOURCE_IDS.map((id) => {
              const made = produced[id] ?? 0;
              const used = consumed[id] ?? 0;
              const lost = wasted[id] ?? 0;
              const have = stock[id] ?? 0;
              const days = used > 0 ? have / used : null;
              const low = days !== null && days < 2;
              return (
                <tr key={id} data-testid={`econ-${id}`} className={low ? "low" : undefined}>
                  <td>{t(`res.${id}`)}</td>
                  <td>{made.toFixed(0)}</td>
                  <td>{used.toFixed(0)}</td>
                  <td className={lost > 0 ? "low" : undefined}>{lost > 0 ? `-${lost.toFixed(0)}` : "—"}</td>
                  <td>{have.toFixed(0)}</td>
                  <td>{days === null ? "—" : days.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {worst && (
          <p className="note warn" data-testid="econ-bottleneck">
            {t("econ.bottleneck", { resource: t(`res.${worst.id}`), days: worst.days.toFixed(1) })}
          </p>
        )}
        <div className="modal-actions">
          <button onClick={() => set({ showEcon: false })}>{t("research.close")}</button>
        </div>
      </div>
    </div>
  );
}
