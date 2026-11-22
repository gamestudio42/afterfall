/**
 * The skeleton `tools/blender/characters.py` exports, and the per-instance pose blend.
 *
 * A pose is a rotation per bone and a position for the root. A blend of poses is a
 * weighted sum of each bone's rotations, normalised (with every rotation turned to the
 * same hemisphere first), and the bones are then hung off one another by forward
 * kinematics. Unlike a blend of vertex positions, which runs every vertex along a
 * straight line and so shortens a limb that turns between two keys, this keeps each
 * bone's length whatever the blend (decision 69).
 */
export interface RigData {
  bones: string[];
  parents: number[];
  rest: number[][];
  walkKeys: number;
  runKeys: number;
  poses: Record<string, { root: number[]; q: number[] }>;
}

/** Floats per bone in a skinning row: three rows of a 3×4 matrix. */
export const BONE_FLOATS = 12;

export class CharacterRig {
  readonly bones: number;
  private readonly parents: Int32Array;
  private readonly rest: Float32Array;
  /** Rotations of every pose, in `order`, then the standing pose: 4 floats per bone. */
  private readonly rotations: Float32Array[];
  private readonly roots: Float32Array[];
  private readonly q: Float32Array;
  private readonly origin: Float32Array;
  private readonly matrix: Float32Array;

  /** `order` is the pose layout the motion's weights use; "stand" is the remainder. */
  constructor(data: RigData, order: readonly string[]) {
    this.bones = data.bones.length;
    this.parents = Int32Array.from(data.parents);
    this.parents.forEach((parent, i) => {
      if (parent >= i) throw new Error(`Rig bone ${data.bones[i]} comes before its parent`);
    });
    this.rest = Float32Array.from(data.rest.flat());
    this.rotations = [];
    this.roots = [];
    for (const name of [...order, "stand"]) {
      const pose = data.poses[name];
      if (!pose || pose.q.length !== this.bones * 4) throw new Error(`Rig has no pose ${name}`);
      this.rotations.push(Float32Array.from(pose.q));
      this.roots.push(Float32Array.from(pose.root));
    }
    this.q = new Float32Array(this.bones * 4);
    this.origin = new Float32Array(this.bones * 3);
    this.matrix = new Float32Array(this.bones * 9);
  }

  /**
   * Writes each bone's skinning matrix, which takes a vertex from the rest stance to the
   * pose, as three rows of (rotation | translation) into `out` from `offset`.
   * `weights` follow `order`; whatever they leave short of one is the standing pose.
   */
  skin(weights: ArrayLike<number>, out: Float32Array, offset: number): void {
    const n = this.bones;
    const stand = this.rotations.length - 1;
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    const rest = Math.max(0, 1 - total);
    const q = this.q;
    q.fill(0);
    let rx = 0;
    let ry = 0;
    let rz = 0;
    const add = (pose: number, w: number) => {
      const rot = this.rotations[pose];
      const ref = this.rotations[stand];
      for (let b = 0; b < n; b++) {
        const k = b * 4;
        // q and -q are the same rotation: sum them on one side, or they cancel.
        const dot = rot[k] * ref[k] + rot[k + 1] * ref[k + 1] + rot[k + 2] * ref[k + 2] + rot[k + 3] * ref[k + 3];
        const s = dot < 0 ? -w : w;
        q[k] += rot[k] * s;
        q[k + 1] += rot[k + 1] * s;
        q[k + 2] += rot[k + 2] * s;
        q[k + 3] += rot[k + 3] * s;
      }
      const root = this.roots[pose];
      rx += root[0] * w;
      ry += root[1] * w;
      rz += root[2] * w;
    };
    if (rest > 0) add(stand, rest);
    for (let i = 0; i < weights.length; i++) if (weights[i] > 0) add(i, weights[i]);
    const scale = rest > 0 || total <= 1 ? 1 : 1 / total;
    rx *= scale;
    ry *= scale;
    rz *= scale;
    const m = this.matrix;
    const o = this.origin;
    const r = this.rest;
    for (let b = 0; b < n; b++) {
      const k = b * 4;
      const len = Math.hypot(q[k], q[k + 1], q[k + 2], q[k + 3]) || 1;
      const x = q[k] / len;
      const y = q[k + 1] / len;
      const z = q[k + 2] / len;
      const w = q[k + 3] / len;
      const j = b * 9;
      m[j] = 1 - 2 * (y * y + z * z);
      m[j + 1] = 2 * (x * y - z * w);
      m[j + 2] = 2 * (x * z + y * w);
      m[j + 3] = 2 * (x * y + z * w);
      m[j + 4] = 1 - 2 * (x * x + z * z);
      m[j + 5] = 2 * (y * z - x * w);
      m[j + 6] = 2 * (x * z - y * w);
      m[j + 7] = 2 * (y * z + x * w);
      m[j + 8] = 1 - 2 * (x * x + y * y);
      const p = this.parents[b];
      if (p < 0) {
        o[0] = rx;
        o[1] = ry;
        o[2] = rz;
      } else {
        // Hung off the parent: the rest offset between the two joints, turned by the parent.
        const pj = p * 9;
        const dx = r[b * 3] - r[p * 3];
        const dy = r[b * 3 + 1] - r[p * 3 + 1];
        const dz = r[b * 3 + 2] - r[p * 3 + 2];
        o[b * 3] = o[p * 3] + m[pj] * dx + m[pj + 1] * dy + m[pj + 2] * dz;
        o[b * 3 + 1] = o[p * 3 + 1] + m[pj + 3] * dx + m[pj + 4] * dy + m[pj + 5] * dz;
        o[b * 3 + 2] = o[p * 3 + 2] + m[pj + 6] * dx + m[pj + 7] * dy + m[pj + 8] * dz;
      }
      // v' = o + R (v - rest) = R v + (o - R rest).
      const bx = r[b * 3];
      const by = r[b * 3 + 1];
      const bz = r[b * 3 + 2];
      const at = offset + b * BONE_FLOATS;
      for (let row = 0; row < 3; row++) {
        const a = m[j + row * 3];
        const c = m[j + row * 3 + 1];
        const d = m[j + row * 3 + 2];
        out[at + row * 4] = a;
        out[at + row * 4 + 1] = c;
        out[at + row * 4 + 2] = d;
        out[at + row * 4 + 3] = o[b * 3 + row] - (a * bx + c * by + d * bz);
      }
    }
  }
}
