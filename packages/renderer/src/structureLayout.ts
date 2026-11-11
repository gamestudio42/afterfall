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
