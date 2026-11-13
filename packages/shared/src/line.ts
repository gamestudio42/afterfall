/** Cells along a straight line between two cells, both ends included (Bresenham). */
export function lineCells(from: [number, number], to: [number, number]): [number, number][] {
  let [x, y] = from;
  const [x1, y1] = to;
  const dx = Math.abs(x1 - x);
  const dy = -Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let err = dx + dy;
  const cells: [number, number][] = [];
  for (;;) {
    cells.push([x, y]);
    if (x === x1 && y === y1) return cells;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * How one piece of a wall line sits on the exact line the player drew.
 *
 * `lineCells` puts the pieces on grid cells, so a line at an angle the grid does not
 * have (every street of an imported real place) is a staircase of straight and diagonal
 * steps. Turning each piece from its neighbours gave a mix of 0°, 45° and 90° slabs —
 * a zigzag where the player drew a straight line. Every piece of the line instead takes
 * the line's own angle, slides off its cell centre onto the line (at most half a cell,
 * across the major axis), and stretches to the spacing of the cells along that line.
 *
 * `yaw` is a turn about the vertical axis in render space (x east, z = grid y south),
 * `ox`/`oy` the offset in cells. Returns null for a line along an axis, which the grid
 * already draws straight.
 */
export interface LineFrame {
  yaw: number;
  stretch: number;
  ox: number;
  oy: number;
}

export function lineFrame(from: [number, number], to: [number, number], at: [number, number]): LineFrame | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (dx === 0 || dy === 0) return null;
  let ox = 0;
  let oy = 0;
  if (Math.abs(dx) >= Math.abs(dy)) oy = from[1] + ((at[0] - from[0]) / dx) * dy - at[1];
  else ox = from[0] + ((at[1] - from[1]) / dy) * dx - at[0];
  return {
    yaw: Math.atan2(-dy, dx),
    stretch: Math.hypot(dx, dy) / Math.max(Math.abs(dx), Math.abs(dy)),
    ox,
    oy,
  };
}
