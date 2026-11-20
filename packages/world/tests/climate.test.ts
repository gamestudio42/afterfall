import { describe, expect, it } from "vitest";
import { cityFromOverpass, climateAt } from "../src";
import { FIXTURE_CENTER, syntheticOverpass } from "./fixtures/osm";

describe("climate", () => {
  it("finds the deserts the game is played in, and leaves the rest alone", () => {
    for (const [lat, lon] of [
      [30.3222, 35.4515], // Petra
      [29.9792, 31.1342], // Giza
      [25.2048, 55.2708], // Dubai
      [36.1699, -115.1398], // Las Vegas
      [-23.6509, -70.3975], // Antofagasta
    ])
      expect(climateAt(lat, lon), `${lat},${lon}`).toBe("arid");
    for (const [lat, lon] of [
      [-22.9695, -43.1865], // Copacabana
      [48.8584, 2.2945], // Eiffel Tower
      [31.7767, 35.2345], // Jerusalem, a Mediterranean hill town
      [34.0522, -118.2437], // Los Angeles
      [-13.1631, -72.545], // Machu Picchu
    ])
      expect(climateAt(lat, lon), `${lat},${lon}`).toBeUndefined();
  });

  it("is kept with an imported map, so a save remembers it", () => {
    const city = cityFromOverpass(syntheticOverpass(), { ...FIXTURE_CENTER, size: 480, label: "Test" });
    expect(city.climate).toBe(climateAt(FIXTURE_CENTER.lat, FIXTURE_CENTER.lon));
  });
});
