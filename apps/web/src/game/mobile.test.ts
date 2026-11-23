import { describe, expect, it } from "vitest";
import { publicAssetUrl } from "../app/publicUrl";
import { grabPan, pinchFactor, twistDelta } from "./touch";

describe("public asset URL", () => {
  it("resolves the menu backdrop next to the page, not next to the stylesheet", () => {
    const pages = publicAssetUrl("./", "art/menu_bg.jpg", "https://gamestudio42.github.io/afterfall/");
    expect(pages).toBe("https://gamestudio42.github.io/afterfall/art/menu_bg.jpg");
    expect(pages).not.toContain("/assets/");

    const index = publicAssetUrl("./", "art/menu_bg.jpg", "https://gamestudio42.github.io/afterfall/index.html");
    expect(index).toBe("https://gamestudio42.github.io/afterfall/art/menu_bg.jpg");

    const bare = publicAssetUrl("./", "art/menu_bg.jpg", "https://gamestudio42.github.io/afterfall");
    expect(bare).toBe("https://gamestudio42.github.io/afterfall/art/menu_bg.jpg");
  });

  it("keeps a dev server rooted at /", () => {
    expect(publicAssetUrl("/", "art/menu_bg.jpg", "http://localhost:5173/")).toBe("http://localhost:5173/art/menu_bg.jpg");
  });
});

describe("touch camera", () => {
  it("grabs the ground: a finger moving right pans the target left", () => {
    const pan = grabPan(100, 0, 120, 42, 740);
    expect(pan.right).toBeLessThan(0);
    expect(pan.forward).toBe(0);
    expect(Math.abs(pan.right)).toBeGreaterThan(5);
    expect(Math.abs(pan.right)).toBeLessThan(30);
  });

  it("zooms in when the pinch opens and ignores a broken span", () => {
    expect(pinchFactor(100, 200)).toBeCloseTo(0.5);
    expect(pinchFactor(200, 100)).toBeCloseTo(2);
    // A fast pinch can more than double the span in one sample.
    expect(pinchFactor(80, 200)).toBeCloseTo(0.4);
    expect(pinchFactor(100, 0)).toBe(1);
    expect(pinchFactor(10, 100)).toBe(1);
  });

  it("takes the short way around when a twist crosses the branch cut", () => {
    expect(twistDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
    expect(twistDelta(0, 0.4)).toBeCloseTo(0.4);
  });
});
