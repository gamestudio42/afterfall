import { useGame } from "../app/hooks";

/** OpenStreetMap attribution, required (ODbL) while playing on an imported map. */
export function MapCredit() {
  const source = useGame().sim?.city.source;
  if (!source) return null;
  return (
    <div className="map-credit" data-testid="map-credit">
      {source.label} ·{" "}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © OpenStreetMap
      </a>
    </div>
  );
}
