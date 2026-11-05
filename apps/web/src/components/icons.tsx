import type { ReactElement } from "react";

/**
 * HUD icons, drawn as inline SVG rather than shipped as images: they stay crisp
 * at any device pixel ratio, cost no request and no asset budget, and they take
 * the resource colour from the same palette the rest of the HUD uses.
 *
 * Every icon is authored on a 24x24 grid with a 2 px stroke, so they read at
 * 14 px in the top bar and at 20 px in a panel without redrawing anything.
 */

export type IconName = "food" | "water" | "wood" | "metal" | "ammo" | "medicine" | "firearms" | "beds" | "people" | "clock";

const PATHS: Record<IconName, ReactElement> = {
  // A can with a lid: food keeps, it is not a steak on a plate.
  food: (
    <>
      <path d="M7 7h10v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z" />
      <path d="M7 7c0-2 2-3 5-3s5 1 5 3" />
      <path d="M9 12h6" />
    </>
  ),
  // A droplet.
  water: (
    <>
      <path d="M12 3c3.5 4.2 6 7.4 6 10.5A6 6 0 0 1 6 13.5C6 10.4 8.5 7.2 12 3z" />
      <path d="M9.5 14.5a2.6 2.6 0 0 0 2.5 2.6" />
    </>
  ),
  // A log, end-on.
  wood: (
    <>
      <ellipse cx="9" cy="12" rx="3.2" ry="5.2" />
      <path d="M12 7.2c3.6.4 6 2.4 6 4.8s-2.4 4.4-6 4.8" />
      <path d="M9 10.4v3.2" />
    </>
  ),
  // An ingot.
  metal: (
    <>
      <path d="M4 16l3-7h10l3 7z" />
      <path d="M8.2 9l-1.3 3.4h10.2L15.8 9" />
    </>
  ),
  // A cartridge.
  ammo: (
    <>
      <path d="M9 21V9l3-5 3 5v12z" />
      <path d="M9 15h6" />
    </>
  ),
  // A capsule: at 14 px the two halves read as medicine where a cross inside a
  // bottle turns into a red smudge.
  medicine: (
    <>
      <rect x="4.4" y="8.8" width="15.2" height="7.4" rx="3.7" transform="rotate(-40 12 12)" />
      <path d="M9.6 14.4l4.8-4.8" />
    </>
  ),
  // A rifle silhouette, kept simple at 14 px.
  firearms: (
    <>
      <path d="M3 10h13l2 3h3v2h-5l-2 4h-3l1-4H3z" />
      <path d="M8 15v3" />
    </>
  ),
  // A bed, for the population cap.
  beds: (
    <>
      <path d="M3 18v-7h13a4 4 0 0 1 4 4v3" />
      <path d="M3 14h17" />
      <path d="M6.5 11V8.5A1.5 1.5 0 0 1 8 7h2" />
    </>
  ),
  // Two people.
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M15.5 5.6a3 3 0 0 1 0 5.8M17 20a5.5 5.5 0 0 0-2-4.3" />
    </>
  ),
  // A clock face.
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
};

export function Icon({ name, size = 14, color }: { name: IconName; size?: number; color?: string }): ReactElement {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
