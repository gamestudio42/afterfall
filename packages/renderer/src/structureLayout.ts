/**
 * Walls and gates are axial pieces: their long side runs along the line they belong to.
 * The model is authored east-west, so a piece in a north-south line has to be turned a
 * quarter turn — otherwise the run reads as a row of slabs lying across the line, which
 * is exactly what the first version of the structure kit looked like.
 *
 * A corner (neighbours on both axes) keeps the authored orientation, and a lone piece
 * has nothing to align with.
 */
export function axialYaw(north: boolean, south: boolean, east: boolean, west: boolean): number {
  const alongZ = (north ? 1 : 0) + (south ? 1 : 0);
  const alongX = (east ? 1 : 0) + (west ? 1 : 0);
  return alongZ > alongX ? Math.PI / 2 : 0;
}

/**
 * Orientation and length for a wall piece, from its eight neighbours.
 *
 * A Bresenham wall runs diagonally, and a diagonal neighbour is 2.83 m away while the
 * panel is 2 m long: orienting by the four orthogonal neighbours alone left every piece
 * lying across the line, so a diagonal wall came out as a row of dashes. The panel turns
 * to the diagonal and stretches by √2, which is exactly the distance between the two cell
 * centres — the pieces meet again.
 */
export function wallFrame(
  north: boolean,
  south: boolean,
  east: boolean,
  west: boolean,
  ne: boolean,
  se: boolean,
  sw: boolean,
  nw: boolean,
): { yaw: number; stretch: number } {
  const alongZ = (north ? 1 : 0) + (south ? 1 : 0);
  const alongX = (east ? 1 : 0) + (west ? 1 : 0);
  if (alongZ || alongX) return { yaw: alongZ > alongX ? Math.PI / 2 : 0, stretch: 1 };
  // North-east and south-west lie on one line; so do south-east and north-west.
  if (ne || sw) return { yaw: Math.PI / 4, stretch: Math.SQRT2 };
  if (se || nw) return { yaw: -Math.PI / 4, stretch: Math.SQRT2 };
  return { yaw: 0, stretch: 1 };
}

/** A structure's footprint on the ground: its length along its yaw, and its depth across. */
export interface PlinthFrame {
  yaw: number;
  length: number;
  depth: number;
}

/** A wall's slab is 0.7 m deep at its foot; its plinth stands a little wider. */
export const WALL_PLINTH_DEPTH = 1;

/**
 * The ground a structure stands on. A wall or gate panel is as long as its stretched piece
 * and a metre deep, along its line; a junction pier (no frame) and a tower, farm or well
 * are their own square, turned as placed.
 */
export function plinthFrame(kind: string, size: number, wall: { yaw: number; stretch: number } | null, yaw = 0): PlinthFrame {
  if ((kind === "wall" || kind === "gate") && wall) return { yaw: wall.yaw, length: size * wall.stretch, depth: WALL_PLINTH_DEPTH };
  return { yaw: kind === "wall" || kind === "gate" ? 0 : yaw, length: size, depth: size };
}

/**
 * Offsets (east, south) from a footprint's centre where its ground is read: the corners,
 * the middle, and every metre along a long side, turned with it. Render yaw turns +x
 * towards -z.
 */
export function footprintSamples(f: PlinthFrame): [number, number][] {
  const cos = Math.cos(f.yaw);
  const sin = Math.sin(f.yaw);
  const out: [number, number][] = [];
  const nu = Math.max(1, Math.ceil(f.length));
  const nv = Math.max(1, Math.ceil(f.depth));
  for (let i = 0; i <= nu; i++)
    for (let j = 0; j <= nv; j++) {
      if (i > 0 && i < nu && j > 0 && j < nv) continue;
      const u = (i / nu - 0.5) * f.length;
      const v = (j / nv - 0.5) * f.depth;
      out.push([u * cos + v * sin, -u * sin + v * cos]);
    }
  out.push([0, 0]);
  return out;
}
