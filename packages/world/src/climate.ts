/**
 * Whether a place is desert, from where it is: the ground there is bare rock and sand,
 * and little grows back. A coarse table of the world's hot and cold deserts (Köppen BW),
 * kept small on purpose and checked against the places the game is played on: OSM rarely
 * maps bare ground (Petra's 600 m have no `natural=bare_rock` or `sand` at all), and the
 * request for it would be a fourth one to a server that is often busy.
 */
export type Climate = "arid";

/** South, north, west and east edges in degrees. */
const DESERTS: [number, number, number, number, string][] = [
  [15, 32, -17, 34, "Sahara and the Nile valley"],
  [12, 30.6, 34, 40, "Sinai, the Negev and southern Jordan"],
  [12, 34, 40, 48, "Arabia and Mesopotamia"],
  [12, 30, 48, 60, "the Gulf"],
  [24, 30, 69, 76, "Thar"],
  [37, 42, 75, 90, "Taklamakan"],
  [40, 46, 95, 110, "Gobi"],
  [30, 37.5, -118, -109, "Mojave and Sonora"],
  [-27, -17, -71.5, -68.5, "Atacama"],
  [-31, -20, 120, 141, "Australia's interior"],
  [-28, -17, 12, 22, "Namib and Kalahari"],
];

export function climateAt(lat: number, lon: number): Climate | undefined {
  for (const [s, n, w, e] of DESERTS) if (lat >= s && lat <= n && lon >= w && lon <= e) return "arid";
  return undefined;
}
