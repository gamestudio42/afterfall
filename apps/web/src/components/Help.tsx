import { useGame, useT } from "../app/hooks";
import { useTouchUi } from "../app/media";
import { useUi } from "../app/store";

export function HelpContent() {
  const t = useT();
  const touch = useTouchUi();
  return (
    <div className="help">
      <p className="goal">{t("help.goal")}</p>
      {touch && (
        <ul data-testid="help-touch">
          <li>{t("help.touch.camera")}</li>
          <li>{t("help.touch.select")}</li>
          <li>{t("help.touch.orders")}</li>
          <li>{t("help.touch.build")}</li>
          <li>{t("help.touch.actions")}</li>
        </ul>
      )}
      {touch && <p className="muted small">{t("help.keyboard")}</p>}
      <ul>
        <li>{t("help.camera")}</li>
        <li>{t("help.select")}</li>
        <li>{t("help.orders")}</li>
        <li>{t("help.keys")}</li>
      </ul>
    </div>
  );
}

export function HelpModal() {
  const game = useGame();
  const first = !game.sim?.state.started;
  const dismissed = useUi((s) => s.guideDismissed);
  const t = useT();
  const set = useUi((s) => s.set);
  return (
    <div className="modal-backdrop" onClick={() => set({ showHelp: false })}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="help">
        <h2>{t(first ? "guide.title" : "help.title")}</h2>
        {first ? (
          <>
            <p className="goal">{t("guide.welcome")}</p>
            <p>{t("banner.chooseBase")}</p>
            <p className="muted small">{t("guide.welcomeHint")}</p>
            <details>
              <summary>{t("help.title")}</summary>
              <HelpContent />
            </details>
          </>
        ) : (
          <HelpContent />
        )}
        {dismissed && (
          <button
            className="chip"
            onClick={() => {
              set({ guideDismissed: false });
              try {
                localStorage.setItem("afterfall.guideDismissed", "0");
              } catch {
                /* Private storage may be unavailable. */
              }
            }}
          >
            {t("guide.restore")}
          </button>
        )}
        <div className="modal-actions">
          <button className="primary" onClick={() => set({ showHelp: false })}>
            {t("help.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
