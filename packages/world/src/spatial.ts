/**
 * Uniform spatial hash for proximity queries. Rebuilt each tick; cheap for
 * a few hundred agents and avoids O(n²) scans.
 *
 * The rebuild used to walk every bucket it had ever created, and buckets are never
 * removed: over a long game the map filled with the cells anything had passed through,
 * and `clear()` became the most expensive function in the simulation (44% of a profile at
 * day nine with twenty-eight survivors). Clearing is now a counter bump — a bucket that
 * belongs to an older generation is simply treated as empty, and is emptied on its next
 * insert.
 */
export class SpatialHash {
  private buckets = new Map<number, { gen: number; ids: number[] }>();
  private gen = 0;
  constructor(readonly cellSize: number) {}

  clear(): void {
    this.gen++;
  }

  private key(cx: number, cy: number): number {
    return (cx + 1024) * 4096 + (cy + 1024);
  }

  insert(id: number, x: number, y: number): void {
    const k = this.key(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize));
    let b = this.buckets.get(k);
    if (!b) this.buckets.set(k, (b = { gen: this.gen, ids: [] }));
    else if (b.gen !== this.gen) {
      b.gen = this.gen;
      b.ids.length = 0;
    }
    b.ids.push(id);
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
        if (!b || b.gen !== this.gen) continue;
        for (let i = 0; i < b.ids.length; i++) fn(b.ids[i]!);
      }
  }

  /** Buckets currently holding this generation's ids, for tests and probes. */
  get liveBuckets(): number {
    let n = 0;
    for (const b of this.buckets.values()) if (b.gen === this.gen) n++;
    return n;
  }
}
