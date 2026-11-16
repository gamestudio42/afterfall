import { resolvePost, type PostMode } from "./post";

/** What a pixel costs. `low` is for a GPU that is out of fill rate at the resolution floor. */
export type Quality = "high" | "low";
/** auto: high, until this GPU proves too slow (now, or in a session the caller remembers). */
export type QualityMode = "auto" | Quality;

export interface Tier {
  /** MSAA samples of the target the scene is drawn into. */
  samples: number;
  /** PCF-soft shadows (36 fetches a lit fragment) or plain PCF. */
  softShadows: boolean;
  /** Whether lit fragments sample the sky environment. */
  environment: boolean;
}

export const TIERS: Record<Quality, Tier> = {
  high: { samples: 4, softShadows: true, environment: true },
  low: { samples: 2, softShadows: false, environment: false },
};

/**
 * The tier to start on. `slowGpu` is the driver name of a GPU that already ran out of
 * resolution in an earlier session; a hidden name (empty) never matches.
 */
export function resolveQuality(mode: QualityMode, gpu: string, slowGpu = ""): Quality {
  if (mode !== "auto") return mode;
  return gpu !== "" && gpu === slowGpu ? "low" : "high";
}

/** Bloom and grade: the low tier gives them up unless the player forced them on. */
export function wantsEffects(post: PostMode, quality: Quality, gpu: string): boolean {
  if (post === "auto" && quality === "low") return false;
  return resolvePost(post, gpu);
}
