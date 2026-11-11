import { expect, it } from "vitest";
import { abandonedVehicles, vehicleContains, generateCity, NavGrid } from "../src";

it("shares deterministic road wrecks with collision for both agents", () => {
  const city = generateCity({ seed: 4242 });
  const cars = abandonedVehicles(city),
    grid = NavGrid.fromCity(city);
  expect(cars.length).toBeGreaterThan(10);
  expect(abandonedVehicles(city)).toEqual(cars);
  for (const car of cars) {
    expect(city.roads.some((r) => car.x > r.rect.x && car.x < r.rect.x + r.rect.w && car.z > r.rect.y && car.z < r.rect.y + r.rect.h)).toBe(
      true,
    );
    for (const agent of ["survivor", "infected"] as const) {
      expect(grid.passable(car.x, car.z, agent)).toBe(false);
      for (let x = -1; x <= 1; x += 0.5)
        for (let z = -2; z <= 2; z += 0.5) {
          const wx = car.x + Math.cos(car.rot) * x + Math.sin(car.rot) * z;
          const wz = car.z - Math.sin(car.rot) * x + Math.cos(car.rot) * z;
          expect(vehicleContains(car, wx, wz)).toBe(true);
          expect(grid.passable(wx, wz, agent)).toBe(false);
        }
    }
  }
});
