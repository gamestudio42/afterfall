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

/** Thickness of the wall slab in `art/structures/wall.glb`, in metres. */
export const WALL_THICKNESS = 0.5;

/**
 * Scale for the long axis of a junction block, so it fills its whole cell. The factor is
 * the cell size divided by the slab thickness: a cell is 2 m and the slab is 0.5 m, so the
 * block needs 4x, not the cell size itself — the first version passed 2 and left half a
 * metre of notch on either side, which is exactly the joint the block was meant to close.
 */
export function cornerBlockScale(cellSize: number): number {
  return cellSize / WALL_THICKNESS;
}
