import { useT } from "../app/hooks";
import { useUi } from "../app/store";

export function HelpContent() {
  const t = useT();
  return (
    <div className="help">
      <p className="goal">{t("help.goal")}</p>
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
  const t = useT();
  const set = useUi((s) => s.set);
  return (
    <div className="modal-backdrop" onClick={() => set({ showHelp: false })}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="help">
        <h2>{t("help.title")}</h2>
        <HelpContent />
        <div className="modal-actions">
          <button className="primary" onClick={() => set({ showHelp: false })}>
            {t("help.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
