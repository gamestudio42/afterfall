/**
 * Uniform spatial hash for proximity queries. Rebuilt each tick; cheap for
 * a few hundred agents and avoids O(n²) scans.
 */
export class SpatialHash {
  private buckets = new Map<number, number[]>();
  constructor(readonly cellSize: number) {}

  clear(): void {
    for (const b of this.buckets.values()) b.length = 0;
  }

  private key(cx: number, cy: number): number {
    return (cx + 1024) * 4096 + (cy + 1024);
  }

  insert(id: number, x: number, y: number): void {
    const k = this.key(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize));
    let b = this.buckets.get(k);
    if (!b) this.buckets.set(k, (b = []));
    b.push(id);
  }

  /** Calls fn for every id in buckets overlapping the circle (caller filters by distance). */
  query(x: number, y: number, r: number, fn: (id: number) => void): void {
    const x0 = Math.floor((x - r) / this.cellSize);
    const x1 = Math.floor((x + r) / this.cellSize);
    const y0 = Math.floor((y - r) / this.cellSize);
    const y1 = Math.floor((y + r) / this.cellSize);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.buckets.get(this.key(cx, cy));
        if (b) for (let i = 0; i < b.length; i++) fn(b[i]);
      }
  }
}
