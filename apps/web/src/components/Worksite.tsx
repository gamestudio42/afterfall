import { bagTotal } from "@afterfall/content";
import { worksiteSummary, type Simulation, type Task } from "@afterfall/core";
import { useGame, useT } from "../app/hooks";
import { Bag, Meter, Row } from "./common";

/** Same accounting in the queue and the inspected job, without changing assignments. */
export function Worksite({
  sim,
  task,
  compact = false,
  showProgress = true,
}: {
  sim: Simulation;
  task: Task;
  compact?: boolean;
  showProgress?: boolean;
}) {
  const t = useT();
  const game = useGame();
  const summary = worksiteSummary(sim, task);
  if (!summary) return null;
  return (
    <div className="worksite" data-testid={`worksite-${task.id}`}>
      {showProgress && (
        <>
          <Row label={t("worksite.progress")}>
            <span data-testid="job-progress">{summary.percent}%</span>
          </Row>
          <Meter value={summary.percent} color="#6fd0ff" />
        </>
      )}
      <p className="small muted" data-testid="worksite-reason">
        {t(`worksite.${summary.reason}`)}
      </p>
      {bagTotal(summary.shortfall) > 0 && (
        <div className="worksite-shortfall">
          <small>{t("worksite.shortfall")}</small>
          <Bag bag={summary.shortfall} />
        </div>
      )}
      {!compact && (
        <>
          <Row label={t("panel.workers")}>
            {task.assigned.length}/{task.maxWorkers}
          </Row>
          <h4>{t("worksite.materials")}</h4>
          <div className="worksite-materials">
            {(
              [
                ["delivered", task.delivered],
                ["inTransit", task.inTransit],
                ["toFetch", summary.toFetch],
              ] as const
            ).map(([label, bag]) => (
              <div key={label}>
                <small>{t(`worksite.${label}`)}</small>
                <Bag bag={bag} empty={<span className="muted">—</span>} />
              </div>
            ))}
          </div>
          <p className="small muted">{t("worksite.stockHint")}</p>
          {summary.reason === "workers" && (
            <button className="wide" onClick={() => game.selectSurvivors()}>
              {t("worksite.reviewWorkers")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
