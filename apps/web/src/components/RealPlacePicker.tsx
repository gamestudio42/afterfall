import { OsmImportError, type CityMap } from "@afterfall/world";
import { useRef, useState } from "react";
import { useT } from "../app/hooks";
import { AREA_SIZES, PLACE_PRESETS, loadPlaceMap, searchPlaces, type Place } from "../app/osm";
import { useUi } from "../app/store";

type Status = { kind: "idle" } | { kind: "busy"; key: string } | { kind: "error"; key: string };

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
  const busy = status.kind === "busy";

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
    setStatus({ kind: "busy", key: "osm.downloading" });
    try {
      const map = await loadPlaceMap(place, size, ctl.signal);
      setStatus({ kind: "idle" });
      onStart(map);
    } catch (e) {
      if (ctl.signal.aborted) return;
      setStatus({ kind: "error", key: e instanceof OsmImportError ? `osm.${e.code}` : "osm.downloadFailed" });
    }
  };

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
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("osm.searchPlaceholder")} data-testid="place-search" disabled={busy} />
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
      {status.kind !== "idle" && <p className={status.kind === "error" ? "error" : "muted"} data-testid="place-status">{t(status.key)}</p>}
      <button className="primary" onClick={() => void start()} disabled={busy} data-testid="start-real">
        {t("osm.start")}
      </button>
      <p className="credits-inline">
        {t("osm.dataFrom")}{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap
        </a>
      </p>
    </div>
  );
}
