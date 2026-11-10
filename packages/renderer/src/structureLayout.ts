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
