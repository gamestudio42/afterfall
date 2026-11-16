import { describe, expect, it } from "vitest";
import { resolveQuality, TIERS, wantsEffects } from "../src/quality";

const INTEL = "ANGLE (Intel, Mesa Intel(R) Graphics (RPL-P), OpenGL 4.6)";
const NVIDIA = "ANGLE (NVIDIA, NVIDIA GeForce RTX 4050 Laptop GPU, OpenGL 4.6)";

describe("quality tier", () => {
  it("starts high, and low only on the GPU that was too slow before", () => {
    expect(resolveQuality("auto", INTEL)).toBe("high");
    expect(resolveQuality("auto", INTEL, INTEL)).toBe("low");
    expect(resolveQuality("auto", NVIDIA, INTEL)).toBe("high");
  });

  it("does not match a hidden driver name against a hidden one", () => {
    expect(resolveQuality("auto", "", "")).toBe("high");
  });

  it("lets the caller force either tier", () => {
    expect(resolveQuality("high", INTEL, INTEL)).toBe("high");
    expect(resolveQuality("low", NVIDIA)).toBe("low");
  });

  it("drops bloom and grade on the low tier unless they were forced on", () => {
    expect(wantsEffects("auto", "high", INTEL)).toBe(true);
    expect(wantsEffects("auto", "low", INTEL)).toBe(false);
    expect(wantsEffects("on", "low", INTEL)).toBe(true);
    expect(wantsEffects("off", "high", NVIDIA)).toBe(false);
    expect(wantsEffects("auto", "high", "SwiftShader")).toBe(false);
  });

  it("makes every knob of the low tier cheaper than the high one", () => {
    expect(TIERS.low.samples).toBeLessThan(TIERS.high.samples);
    expect(TIERS.low.softShadows).toBe(false);
    expect(TIERS.low.environment).toBe(false);
  });
});
