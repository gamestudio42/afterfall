import { OsmImportError, type CityMap } from "@afterfall/world";
import { useEffect, useRef, useState } from "react";
import { useT } from "../app/hooks";
import { AREA_SIZES, LOAD_STEPS, PLACE_PRESETS, loadPlaceMap, searchPlaces, type LoadProgress, type Place } from "../app/osm";
import { useUi } from "../app/store";

type Status = { kind: "idle" } | { kind: "busy"; key: string } | { kind: "loading" } | { kind: "error"; key: string };

/** The steps the player watches: the loader's, then the scene the game builds from the map. */
const STEPS = [...LOAD_STEPS, "scene"] as const;
type Step = (typeof STEPS)[number];
type StepView = Omit<LoadProgress, "step"> | undefined;

const MARK: Record<string, string> = { active: "●", done: "✓", cached: "✓", skipped: "–", failed: "✕" };
/** After this long the list says the servers are slow and the place will be kept. */
const SLOW_S = 30;

/** New-game panel for playing on a real place from OpenStreetMap. */
export function RealPlacePicker({ onStart }: { onStart: (map: CityMap) => void }) {
  const t = useT();
  const lang = useUi((s) => s.lang);
  const [place, setPlace] = useState<Place>(PLACE_PRESETS[0]);
  const [size, setSize] = useState(AREA_SIZES[1]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);
  const [steps, setSteps] = useState<Partial<Record<Step, StepView>>>({});
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const loading = status.kind === "loading";
  const busy = status.kind === "busy" || loading;

  // The elapsed seconds, so a long wait shows it is still alive.
  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => setNow(performance.now()), 500);
    return () => window.clearInterval(id);
  }, [loading]);

  const search = async () => {
    if (!query.trim()) return;
    setStatus({ kind: "busy", key: "osm.searching" });
    try {
      const found = await searchPlaces(query.trim(), lang);
      setResults(found);
      if (found[0]) setPlace(found[0]);
      setStatus(found.length ? { kind: "idle" } : { kind: "error", key: "osm.noResults" });
    } catch {
      setStatus({ kind: "error", key: "osm.searchFailed" });
    }
  };

  const start = async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setSteps({});
    setStartedAt(performance.now());
    setNow(performance.now());
    setStatus({ kind: "loading" });
    try {
      const map = await loadPlaceMap(place, size, ctl.signal, (p) => {
        if (ctl.signal.aborted) return;
        const { step, ...view } = p;
        setSteps((s) => ({ ...s, [step]: view }));
      });
      if (ctl.signal.aborted) return;
      // The game builds the scene from the map in one go: show the step and let it paint
      // before the main thread is taken.
      setSteps((s) => ({ ...s, scene: { state: "active" } }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (ctl.signal.aborted) return;
      setStatus({ kind: "idle" });
      onStart(map);
    } catch (e) {
      if (ctl.signal.aborted) return;
      setStatus({ kind: "error", key: e instanceof OsmImportError ? `osm.${e.code}` : "osm.downloadFailed" });
    }
  };

  const cancel = () => {
    abort.current?.abort();
    abort.current = null;
    setSteps({});
    setStatus({ kind: "idle" });
  };

  const detail = (v: StepView): string | null => {
    if (!v) return null;
    if (v.state === "cached" || v.state === "skipped" || v.state === "failed") return t(`osm.state.${v.state}`);
    if (v.state !== "active") return null;
    if (v.retryIn) return t("osm.retry", { s: v.retryIn });
    if (v.server) return t("osm.server", { server: v.server, attempt: v.attempt ?? 1, attempts: v.attempts ?? 1 });
    if (v.tiles) return t("osm.tiles", { done: v.tiles[0], total: v.tiles[1] });
    return null;
  };
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));

  return (
    <div className="menu-buttons place-picker">
      <p className="muted small">{t("osm.intro")}</p>
      <div className="preset-grid">
        {PLACE_PRESETS.map((p) => (
          <button key={p.label} className={p === place ? "chip active" : "chip"} onClick={() => setPlace(p)} disabled={busy}>
            {p.label}
          </button>
        ))}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("osm.searchPlaceholder")}
          data-testid="place-search"
          disabled={busy}
        />
        <button type="submit" className="chip" disabled={busy || !query.trim()}>
          {t("osm.search")}
        </button>
      </form>
      {results && results.length > 0 && (
        <div className="place-results">
          {results.map((r) => (
            <button key={`${r.lat},${r.lon}`} className={r === place ? "chip active" : "chip"} onClick={() => setPlace(r)} disabled={busy}>
              {r.label}
            </button>
          ))}
        </div>
      )}
      <div className="kv">
        <span>{t("osm.selected")}</span>
        <strong data-testid="place-selected">{place.label}</strong>
      </div>
      <div className="row">
        <span className="muted">{t("osm.area")}</span>
        {AREA_SIZES.map((s) => (
          <button key={s} className={s === size ? "chip active" : "chip"} onClick={() => setSize(s)} disabled={busy}>
            {s} m
          </button>
        ))}
      </div>
      {(loading || (status.kind === "error" && Object.keys(steps).length > 0)) && (
        <ol className="load-steps" data-testid="load-steps" aria-live="polite">
          {STEPS.map((step) => {
            const v = steps[step];
            const state = v?.state ?? "waiting";
            const note = detail(v);
            return (
              <li key={step} className={state} data-testid={`load-${step}`} data-state={state}>
                <span className="mark" aria-hidden>
                  {MARK[state] ?? "○"}
                </span>
                <span>{t(`osm.step.${step}`)}</span>
                {note && <span className="detail">{note}</span>}
              </li>
            );
          })}
        </ol>
      )}
      {loading && elapsed >= SLOW_S && <p className="muted small">{t("osm.slow")}</p>}
      {(status.kind === "busy" || status.kind === "error") && (
        <p className={status.kind === "error" ? "error" : "muted"} data-testid="place-status">
          {t(status.key)}
        </p>
      )}
      {loading ? (
        <div className="load-footer">
          <span className="muted small" data-testid="load-elapsed">
            {t("osm.elapsed", { s: elapsed })}
          </span>
          <button className="chip" onClick={cancel} data-testid="cancel-real">
            {t("osm.cancel")}
          </button>
        </div>
      ) : (
        <button className="primary" onClick={() => void start()} disabled={busy} data-testid="start-real">
          {t("osm.start")}
        </button>
      )}
      <p className="credits-inline">
        {t("osm.dataFrom")}{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap
        </a>
      </p>
    </div>
  );
}
