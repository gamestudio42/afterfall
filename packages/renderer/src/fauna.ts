import * as THREE from "three";
import { heightAt, type CityMap, type TerrainDef } from "@afterfall/world";
import { buildingSeat, outlineOf } from "./buildingBatch";

/**
 * The animals that live in the abandoned city: pigeons and crows on the roofs and in the
 * trees, stray dogs and cats in the streets, rats along the walls at night.
 *
 * They are scenery, not simulation: nothing here is saved, and nothing in the game's rules
 * reads them. They move by their own deterministic rules from a seed, and read the game
 * only through `FaunaWorld`: where the infected are, where a shot or a noise was, and where
 * a body can walk. A flock lifts off when a shot rings out near it or the dead come close;
 * a dog runs from the infected and barks at them. What they do that can be heard is queued
 * in `events` for the audio director.
 */

export interface FaunaWorld {
  /** Whether an infected stands within `r` metres of a point. */
  infectedNear(x: number, z: number, r: number): boolean;
  /** Whether a survivor stands within `r` metres of a point. */
  survivorNear(x: number, z: number, r: number): boolean;
  /** Shots and noises since the last frame. */
  noises: readonly { x: number; z: number }[];
  /** Whether a body can stand at a point (open ground, a street, a park). */
  walkable(x: number, z: number): boolean;
  /** A path from one point to another for a body on foot, or null. */
  path(x0: number, z0: number, x1: number, z1: number): { x: number; z: number }[] | null;
  /** 0 at night, 1 in full day. */
  daylight: number;
}

export type FaunaSound = "chirp" | "caw" | "flutter" | "bark" | "squeak";

export interface FaunaEvent {
  sound: FaunaSound;
  x: number;
  z: number;
}

/** A place a flock settles: a roof edge, from `a` to `b`, or a tree's crown (`a` = `b`). */
interface Perch {
  a: THREE.Vector3;
  b: THREE.Vector3;
  tree: boolean;
}

interface Flock {
  crows: boolean;
  size: number;
  start: number;
  perch: Perch;
  from: Perch;
  state: "perched" | "flying";
  t: number;
  duration: number;
  rest: number;
  nextCall: number;
  seed: number;
}

type Kind = "dog" | "cat" | "rat";

interface Animal {
  kind: Kind;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  path: { x: number; z: number }[];
  idle: number;
  gait: number;
  sit: boolean;
  fleeing: boolean;
  nextBark: number;
  warned: boolean;
  seed: number;
}

const BIRD_MAX = 220;
const ANIMAL_MAX = { dog: 10, cat: 8, rat: 16 } as const;
/** How far a shot or a noise reaches a flock, and how close the dead may come, in metres. */
const SCARE_NOISE = 45;
const SCARE_INFECTED = 14;
const BIRD_SPEED = 13;
/**
 * Drawn larger than life, as the people are: a pigeon of 35 cm is two pixels from the
 * game's camera, and a flock lifting off has to read from there.
 */
const BIRD_SCALE = 2.4;
const ANIMAL_SCALE: Record<Kind, number> = { dog: 1.3, cat: 1.4, rat: 1.8 };

/** A small, fast hash in [0, 1). */
function rand(a: number, b = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

export class Fauna {
  readonly group = new THREE.Group();
  readonly events: FaunaEvent[] = [];
  private readonly perches: Perch[] = [];
  private readonly flocks: Flock[] = [];
  private readonly animals: Animal[] = [];
  private readonly birds: THREE.InstancedMesh;
  private readonly meshes: Record<Kind, THREE.InstancedMesh>;
  private readonly time = { value: 0 };
  private clock = 0;
  private readonly terrain: TerrainDef | undefined;
  private spawned = false;
  private readonly width: number;
  private readonly height: number;
  private serial = 0;

  constructor(city: CityMap, seed = 1) {
    this.group.name = "fauna";
    this.terrain = city.terrain;
    this.width = city.width;
    this.height = city.height;
    // Roof edges: the longest wall of each ordinary building, at its parapet.
    for (const b of city.buildings) {
      if (b.landmark) continue;
      const poly = outlineOf(b);
      const seat = buildingSeat(b, city.terrain);
      const top = seat.base + seat.height + 0.55;
      let best = 0;
      let k = 0;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        const len = Math.hypot(q.x - p.x, q.y - p.y);
        if (len > best) {
          best = len;
          k = i;
        }
      }
      if (best < 6) continue;
      const p = poly[k];
      const q = poly[(k + 1) % poly.length];
      this.perches.push({ a: new THREE.Vector3(p.x, top, p.y), b: new THREE.Vector3(q.x, top, q.y), tree: false });
    }
    // Tree crowns in the parks.
    for (const park of city.parks)
      for (const t of park.trees) {
        const y = heightAt(city.terrain, t.x, t.y) + 6;
        this.perches.push({ a: new THREE.Vector3(t.x, y, t.y), b: new THREE.Vector3(t.x, y, t.y), tree: true });
      }

    // Flocks: about one for every 2,500 m² of map, between 4 and 14 of them.
    const flocks = this.perches.length ? Math.max(4, Math.min(14, Math.round((city.width * city.height) / 25000))) : 0;
    let start = 0;
    for (let f = 0; f < flocks && start < BIRD_MAX; f++) {
      // Half the flocks are crows: a dead city draws carrion birds.
      const crows = rand(seed, f * 7 + 1) < 0.5;
      const size = Math.min(
        BIRD_MAX - start,
        crows ? 4 + Math.floor(rand(seed, f * 7 + 2) * 5) : 8 + Math.floor(rand(seed, f * 7 + 3) * 12),
      );
      const perch = this.perches[Math.floor(rand(seed, f * 7 + 4) * this.perches.length)];
      this.flocks.push({
        crows,
        size,
        start,
        perch,
        from: perch,
        state: "perched",
        t: 0,
        duration: 1,
        rest: 10 + rand(seed, f) * 40,
        nextCall: rand(seed, f * 3) * 8,
        seed: seed * 131 + f,
      });
      start += size;
    }

    this.birds = new THREE.InstancedMesh(birdGeometry(), flapMaterial(this.time), Math.max(1, start));
    this.birds.count = start;
    this.birds.frustumCulled = false;
    this.birds.name = "fauna-birds";
    const flap = new Float32Array(Math.max(1, start) * 2);
    this.birds.geometry.setAttribute("aFlap", new THREE.InstancedBufferAttribute(flap, 2));
    this.flocks.forEach((f) => {
      for (let i = 0; i < f.size; i++)
        this.birds.setColorAt(f.start + i, new THREE.Color(f.crows ? 0x16161a : 0x6c6f78).multiplyScalar(0.85 + rand(f.seed, i) * 0.3));
    });
    this.group.add(this.birds);

    this.meshes = {
      dog: this.animalMesh("dog", dogGeometry(), ANIMAL_MAX.dog, [0x5a4632, 0x2a2622, 0x8a6a44, 0x7b7266], seed),
      cat: this.animalMesh("cat", catGeometry(), ANIMAL_MAX.cat, [0x3a3a3c, 0x9a6a3a, 0x18181a, 0x8c8478], seed + 1),
      rat: this.animalMesh("rat", ratGeometry(), ANIMAL_MAX.rat, [0x3c3834, 0x4a443c], seed + 2),
    };
    this.serial = seed;
  }

  private animalMesh(kind: Kind, geo: THREE.BufferGeometry, max: number, palette: number[], seed: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, gaitMaterial(), max);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = kind !== "rat";
    mesh.name = `fauna-${kind}s`;
    geo.setAttribute("aGait", new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2));
    for (let i = 0; i < max; i++) mesh.setColorAt(i, new THREE.Color(palette[Math.floor(rand(seed, i) * palette.length)]));
    this.group.add(mesh);
    return mesh;
  }

  /** Places the dogs, cats and rats on open ground, once the world can say where that is. */
  private spawn(world: FaunaWorld): void {
    this.spawned = true;
    const area = this.width * this.height;
    const counts: Record<Kind, number> = {
      dog: Math.min(ANIMAL_MAX.dog, Math.max(3, Math.round(area / 45000))),
      cat: Math.min(ANIMAL_MAX.cat, Math.max(3, Math.round(area / 50000))),
      rat: Math.min(ANIMAL_MAX.rat, Math.max(6, Math.round(area / 18000))),
    };
    for (const kind of ["dog", "cat", "rat"] as Kind[])
      for (let n = 0; n < counts[kind]; n++) {
        const at = this.openGround(world, n * 97 + kind.length * 13);
        if (!at) continue;
        this.animals.push({
          kind,
          x: at.x,
          z: at.z,
          yaw: rand(this.serial, n) * 6.28,
          speed: 0,
          path: [],
          idle: rand(this.serial, n + 50) * 4,
          gait: 0,
          sit: false,
          fleeing: false,
          nextBark: 5 + rand(n, 9) * 20,
          warned: false,
          seed: this.serial * 977 + n * 31 + kind.length,
        });
      }
  }

  private openGround(world: FaunaWorld, salt: number): { x: number; z: number } | null {
    for (let tries = 0; tries < 40; tries++) {
      const x = rand(this.serial + salt, tries) * this.width;
      const z = rand(this.serial + salt, tries + 100) * this.height;
      if (world.walkable(x, z)) return { x, z };
    }
    return null;
  }

  update(dt: number, world: FaunaWorld): void {
    this.clock += dt;
    this.time.value = this.clock;
    if (!this.spawned) this.spawn(world);
    this.updateFlocks(dt, world);
    this.updateAnimals(dt, world);
  }

  // ---------------------------------------------------------------------
  // Birds
  // ---------------------------------------------------------------------

  private updateFlocks(dt: number, world: FaunaWorld): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const flap = this.birds.geometry.getAttribute("aFlap") as THREE.InstancedBufferAttribute;
    const day = world.daylight > 0.3;
    for (const f of this.flocks) {
      const mid = perchMid(f.perch);
      if (f.state === "perched") {
        f.rest -= dt;
        const scared =
          world.noises.some((n) => Math.hypot(n.x - mid.x, n.z - mid.z) < SCARE_NOISE) || world.infectedNear(mid.x, mid.z, SCARE_INFECTED);
        // By day a flock moves on now and then; at night it roosts, unless it is scared off.
        if (scared || (day && f.rest <= 0)) this.takeOff(f, scared);
        else if (day && (f.nextCall -= dt) <= 0) {
          f.nextCall = (f.crows ? 10 : 8) + rand(f.seed, Math.floor(this.clock)) * 14;
          this.events.push({ sound: f.crows ? "caw" : "chirp", x: mid.x, z: mid.z });
        }
      } else {
        f.t += dt / f.duration;
        if (f.t >= 1) {
          f.state = "perched";
          f.from = f.perch;
          f.rest = 15 + rand(f.seed, Math.floor(this.clock * 3)) * 50;
        }
      }
      for (let i = 0; i < f.size; i++) {
        const k = f.start + i;
        const slot = this.slot(f, i, f.perch);
        let yaw: number;
        let amp: number;
        if (f.state === "perched") {
          // Pecking and shuffling: a little hop now and then.
          const hop = Math.max(0, Math.sin(this.clock * 3 + i * 1.7) - 0.92) * 3;
          p.copy(slot);
          p.y += hop * 0.15;
          yaw = rand(f.seed, i) * 6.28 + Math.sin(this.clock * 0.3 + i) * 0.6;
          amp = hop > 0 ? 0.4 : 0;
        } else {
          const from = this.slot(f, i, f.from);
          const t = f.t;
          const e = t * t * (3 - 2 * t);
          const fm = perchMid(f.from);
          const lift = Math.max(fm.y, mid.y) + 14 + rand(f.seed, 5) * 12;
          // A quadratic arc from the old perch over to the new, each bird on its own line.
          const ax = (fm.x + mid.x) / 2;
          const az = (fm.z + mid.z) / 2;
          const u = 1 - e;
          p.set(
            u * u * from.x + 2 * u * e * ax + e * e * slot.x,
            u * u * from.y + 2 * u * e * lift + e * e * slot.y,
            u * u * from.z + 2 * u * e * az + e * e * slot.z,
          );
          // Each bird weaves about the line.
          const w = this.clock * 2 + i;
          p.x += Math.sin(w * 1.3) * 1.5 * Math.sin(Math.PI * t);
          p.y += Math.sin(w * 1.9) * 1.0 * Math.sin(Math.PI * t);
          p.z += Math.cos(w * 1.1) * 1.5 * Math.sin(Math.PI * t);
          yaw = Math.atan2(-(slot.z - from.z), slot.x - from.x);
          amp = t < 0.15 || t > 0.85 ? 1.3 : 0.9;
        }
        q.setFromAxisAngle(UP, yaw);
        s.setScalar(BIRD_SCALE * (f.crows ? 1.35 : 1));
        m.compose(p, q, s);
        this.birds.setMatrixAt(k, m);
        flap.setXY(k, amp, i * 0.9);
      }
    }
    this.birds.instanceMatrix.needsUpdate = true;
    flap.needsUpdate = true;
  }

  private takeOff(f: Flock, scared: boolean): void {
    const mid = perchMid(f.perch);
    // Scared, a flock goes well away; otherwise to a perch nearby.
    const want = scared ? 90 : 40;
    let best = f.perch;
    let score = -Infinity;
    for (let n = 0; n < 12; n++) {
      const c = this.perches[Math.floor(rand(f.seed + n, Math.floor(this.clock * 10)) * this.perches.length)];
      const d = Math.hypot(perchMid(c).x - mid.x, perchMid(c).z - mid.z);
      const sc = -Math.abs(d - want) + (c.tree ? 10 : 0) * (f.crows ? -1 : 1);
      if (c !== f.perch && sc > score) {
        score = sc;
        best = c;
      }
    }
    if (best === f.perch) return;
    f.from = f.perch;
    f.perch = best;
    f.state = "flying";
    f.t = 0;
    const d = perchMid(best).distanceTo(mid);
    f.duration = Math.max(3, d / BIRD_SPEED);
    this.events.push({ sound: "flutter", x: mid.x, z: mid.z });
    if (scared && f.crows) this.events.push({ sound: "caw", x: mid.x, z: mid.z });
  }

  /** Where bird `i` of a flock sits on a perch. */
  private slot(f: Flock, i: number, perch: Perch): THREE.Vector3 {
    if (perch.tree) {
      const a = rand(f.seed, i + 30) * 6.28;
      const r = 1 + rand(f.seed, i + 60) * 2.2;
      return new THREE.Vector3(perch.a.x + Math.cos(a) * r, perch.a.y - rand(f.seed, i + 90) * 2.5, perch.a.z + Math.sin(a) * r);
    }
    const t = (i + 0.5 + (rand(f.seed, i) - 0.5) * 0.6) / f.size;
    return new THREE.Vector3().lerpVectors(perch.a, perch.b, 0.1 + t * 0.8);
  }

  // ---------------------------------------------------------------------
  // Dogs, cats and rats
  // ---------------------------------------------------------------------

  private updateAnimals(dt: number, world: FaunaWorld): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const counts: Record<Kind, number> = { dog: 0, cat: 0, rat: 0 };
    const night = world.daylight < 0.35;
    for (const a of this.animals) {
      this.think(a, dt, world, night);
      this.move(a, dt);
      const mesh = this.meshes[a.kind];
      const k = counts[a.kind]++;
      // Rats are out at night; by day they keep to their holes.
      const shown = a.kind !== "rat" || night;
      p.set(a.x, heightAt(this.terrain, a.x, a.z), a.z);
      q.setFromAxisAngle(UP, a.yaw);
      s.setScalar(shown ? ANIMAL_SCALE[a.kind] : 0);
      m.compose(p, q, s);
      mesh.setMatrixAt(k, m);
      const gait = mesh.geometry.getAttribute("aGait") as THREE.InstancedBufferAttribute;
      gait.setXY(k, a.gait, a.sit ? -1 : Math.min(1, a.speed / (a.kind === "rat" ? 2 : 3)));
    }
    for (const kind of ["dog", "cat", "rat"] as Kind[]) {
      const mesh = this.meshes[kind];
      mesh.count = counts[kind];
      mesh.instanceMatrix.needsUpdate = true;
      (mesh.geometry.getAttribute("aGait") as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
  }

  private think(a: Animal, dt: number, world: FaunaWorld, night: boolean): void {
    const fear = a.kind === "dog" ? 18 : a.kind === "cat" ? 12 : 6;
    const threat = world.infectedNear(a.x, a.z, fear) || (a.kind !== "dog" && world.survivorNear(a.x, a.z, a.kind === "cat" ? 5 : 3));
    if (a.kind === "dog") {
      a.nextBark -= dt;
      // A dog barks at the dead before they reach it, and now and then at dusk and night.
      const warn = world.infectedNear(a.x, a.z, 30);
      // The first sight of them sets it off at once.
      if (warn && !a.warned) a.nextBark = 0;
      a.warned = warn;
      if (a.nextBark <= 0 && (warn || (night && rand(a.seed, Math.floor(this.clock)) < 0.02))) {
        this.events.push({ sound: "bark", x: a.x, z: a.z });
        a.nextBark = warn ? 2.5 + rand(a.seed, 3) * 3 : 15 + rand(a.seed, 4) * 25;
      }
    }
    if (a.kind === "rat" && night && rand(a.seed, Math.floor(this.clock / 4)) < 0.01 && (a.nextBark -= dt) <= 0) {
      this.events.push({ sound: "squeak", x: a.x, z: a.z });
      a.nextBark = 8;
    }
    if (threat && !a.fleeing) {
      // Away from the threat: the open ground furthest from it within a short run.
      a.fleeing = true;
      a.sit = false;
      a.path = this.wanderTo(a, world, a.kind === "rat" ? 12 : 35, true) ?? [];
      return;
    }
    if (a.path.length) return;
    a.fleeing = false;
    a.idle -= dt;
    if (a.idle > 0) return;
    // Idle a while, then wander: dogs roam the streets, cats keep near, rats scurry short.
    const r = a.kind === "dog" ? 70 : a.kind === "cat" ? 25 : 10;
    a.sit = a.kind !== "rat" && rand(a.seed, Math.floor(this.clock)) < 0.35;
    if (a.sit) {
      a.idle = 6 + rand(a.seed, Math.floor(this.clock) + 1) * 14;
      return;
    }
    a.path = this.wanderTo(a, world, r, false) ?? [];
    a.idle = (a.kind === "rat" ? 0.5 : 2) + rand(a.seed, Math.floor(this.clock) + 2) * (a.kind === "cat" ? 10 : 5);
  }

  private wanderTo(a: Animal, world: FaunaWorld, r: number, flee: boolean): { x: number; z: number }[] | null {
    for (let tries = 0; tries < 6; tries++) {
      const ang = rand(a.seed, Math.floor(this.clock * 7) + tries) * Math.PI * 2;
      const d = r * (0.5 + rand(a.seed, tries + 200) * 0.5);
      const x = Math.max(2, Math.min(this.width - 2, a.x + Math.cos(ang) * d));
      const z = Math.max(2, Math.min(this.height - 2, a.z + Math.sin(ang) * d));
      if (flee && world.infectedNear(x, z, r * 0.6)) continue;
      if (!world.walkable(x, z)) continue;
      const path = world.path(a.x, a.z, x, z);
      if (path && path.length) return path;
    }
    return null;
  }

  private move(a: Animal, dt: number): void {
    const run = a.fleeing ? 1 : 0;
    const top = a.kind === "dog" ? 2.2 + run * 4 : a.kind === "cat" ? 1.6 + run * 4 : 1.8 + run * 2.5;
    const target = a.path[0];
    if (!target) {
      a.speed = Math.max(0, a.speed - dt * 6);
      return;
    }
    const dx = target.x - a.x;
    const dz = target.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4) {
      a.path.shift();
      return;
    }
    a.speed = Math.min(top, a.speed + dt * 8);
    const step = Math.min(d, a.speed * dt);
    a.x += (dx / d) * step;
    a.z += (dz / d) * step;
    const want = Math.atan2(-dz, dx);
    let turn = want - a.yaw;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    a.yaw += turn * Math.min(1, dt * 8);
    // The gait cycle advances with the distance covered, so the legs never skate.
    a.gait += (step / (a.kind === "rat" ? 0.12 : a.kind === "cat" ? 0.35 : 0.55)) * Math.PI;
  }

  /** How much bird life and water there is near a point, for the soundscape. */
  near(x: number, z: number, r = 80): { flocks: number } {
    let n = 0;
    for (const f of this.flocks) {
      const mid = perchMid(f.perch);
      if (f.state === "perched" && Math.hypot(mid.x - x, mid.z - z) < r) n++;
    }
    return { flocks: n };
  }

  /** Read and clear what was heard since the last call. */
  drain(): FaunaEvent[] {
    return this.events.splice(0);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}

const UP = new THREE.Vector3(0, 1, 0);

function perchMid(p: Perch): THREE.Vector3 {
  return new THREE.Vector3().lerpVectors(p.a, p.b, 0.5);
}

// -------------------------------------------------------------------------
// Geometry and materials
// -------------------------------------------------------------------------

/**
 * A bird about 35 cm long, its beak toward +x: a diamond body and two wings. The `wing`
 * attribute marks each vertex as body (0) or wing (1), and the flap material swings the
 * wings about the body's long axis.
 */
function birdGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const wing: number[] = [];
  const tri = (a: number[], b: number[], c: number[], w: number[]) => {
    pos.push(...a, ...b, ...c);
    wing.push(...w);
  };
  // Body: nose, tail, and two sides, top and bottom.
  const nose = [0.18, 0, 0];
  const tail = [-0.17, 0.01, 0];
  const l = [0, 0, 0.04];
  const r = [0, 0, -0.04];
  const top = [0, 0.04, 0];
  const bot = [0, -0.03, 0];
  for (const [a, b] of [
    [l, top],
    [top, r],
    [r, bot],
    [bot, l],
  ]) {
    tri(nose, a, b, [0, 0, 0]);
    tri(tail, b, a, [0, 0, 0]);
  }
  // Wings: a triangle each side, from the shoulder out to the tip.
  tri([0.06, 0, 0.03], [-0.08, 0, 0.03], [-0.02, 0, 0.3], [1, 1, 1]);
  tri([0.06, 0, -0.03], [-0.02, 0, -0.3], [-0.08, 0, -0.03], [1, 1, 1]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("wing", new THREE.Float32BufferAttribute(wing, 1));
  geo.computeVertexNormals();
  return geo;
}

/** Wings beat with the time uniform, by each bird's amplitude and phase (`aFlap`). */
function flapMaterial(time: { value: number }): THREE.Material {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFaunaTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uFaunaTime;
        attribute float wing;
        attribute vec2 aFlap;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        if (wing != 0.0) {
          if (aFlap.x > 0.0) {
            // Beating in flight, a little faster for a small bird.
            float beat = sin(uFaunaTime * 15.0 + aFlap.y) * 0.9 * aFlap.x;
            float span = abs(transformed.z);
            transformed.y += span * sin(beat);
            transformed.z = sign(transformed.z) * span * cos(beat);
          } else {
            // Folded along the back at rest.
            transformed.z *= 0.22;
            transformed.y += 0.025;
          }
        }`,
      );
  };
  return mat;
}

/** Boxes merged into one animal, legs marked with their phase in the gait. */
function animalGeometry(parts: { size: number[]; at: number[]; leg?: number }[]): THREE.BufferGeometry {
  const geos = parts.map((part) => {
    const g = new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]).toNonIndexed();
    g.translate(part.at[0], part.at[1], part.at[2]);
    const n = g.getAttribute("position").count;
    // x: whether it is a leg; y: its phase in the gait; z: the hip height it swings from.
    const limb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      limb[i * 3] = part.leg === undefined ? 0 : 1;
      limb[i * 3 + 1] = part.leg ?? 0;
      limb[i * 3 + 2] = part.at[1] + part.size[1] / 2;
    }
    g.setAttribute("limb", new THREE.BufferAttribute(limb, 3));
    g.deleteAttribute("uv");
    return g;
  });
  const pos: number[] = [];
  const nrm: number[] = [];
  const limb: number[] = [];
  for (const g of geos) {
    pos.push(...(g.getAttribute("position").array as Float32Array));
    nrm.push(...(g.getAttribute("normal").array as Float32Array));
    limb.push(...(g.getAttribute("limb").array as Float32Array));
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute("limb", new THREE.Float32BufferAttribute(limb, 3));
  return geo;
}

/** A medium stray, about 80 cm long and 50 at the shoulder, nose toward +x. */
function dogGeometry(): THREE.BufferGeometry {
  const P = Math.PI;
  return animalGeometry([
    { size: [0.62, 0.24, 0.22], at: [0, 0.5, 0] },
    { size: [0.2, 0.2, 0.18], at: [0.38, 0.62, 0] },
    { size: [0.12, 0.08, 0.1], at: [0.52, 0.58, 0] },
    { size: [0.05, 0.08, 0.04], at: [0.36, 0.74, 0.06] },
    { size: [0.05, 0.08, 0.04], at: [0.36, 0.74, -0.06] },
    { size: [0.24, 0.05, 0.05], at: [-0.38, 0.6, 0] },
    { size: [0.07, 0.4, 0.07], at: [0.24, 0.2, 0.08], leg: 0 },
    { size: [0.07, 0.4, 0.07], at: [0.24, 0.2, -0.08], leg: P },
    { size: [0.07, 0.4, 0.07], at: [-0.24, 0.2, 0.08], leg: P },
    { size: [0.07, 0.4, 0.07], at: [-0.24, 0.2, -0.08], leg: 0 },
  ]);
}

/** A cat, 45 cm long, its tail up. */
function catGeometry(): THREE.BufferGeometry {
  const P = Math.PI;
  return animalGeometry([
    { size: [0.36, 0.14, 0.12], at: [0, 0.27, 0] },
    { size: [0.12, 0.12, 0.11], at: [0.22, 0.34, 0] },
    { size: [0.03, 0.05, 0.03], at: [0.22, 0.42, 0.04] },
    { size: [0.03, 0.05, 0.03], at: [0.22, 0.42, -0.04] },
    { size: [0.03, 0.26, 0.03], at: [-0.2, 0.4, 0] },
    { size: [0.04, 0.2, 0.04], at: [0.13, 0.1, 0.04], leg: 0 },
    { size: [0.04, 0.2, 0.04], at: [0.13, 0.1, -0.04], leg: P },
    { size: [0.04, 0.2, 0.04], at: [-0.13, 0.1, 0.04], leg: P },
    { size: [0.04, 0.2, 0.04], at: [-0.13, 0.1, -0.04], leg: 0 },
  ]);
}

/** A rat, 20 cm and a tail. */
function ratGeometry(): THREE.BufferGeometry {
  return animalGeometry([
    { size: [0.16, 0.07, 0.07], at: [0, 0.05, 0] },
    { size: [0.06, 0.05, 0.05], at: [0.1, 0.05, 0] },
    { size: [0.16, 0.012, 0.012], at: [-0.15, 0.03, 0] },
  ]);
}

/**
 * Legs swing about their hips with each animal's gait phase and stride (`aGait`); the body
 * bobs with the stride. A stride below zero is an animal sitting: its hindquarters drop.
 */
function gaitMaterial(): THREE.Material {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec3 limb;
        attribute vec2 aGait;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float stride = max(aGait.y, 0.0);
        if (limb.x > 0.5) {
          float swing = sin(aGait.x + limb.y) * 0.55 * stride;
          float below = limb.z - transformed.y;
          transformed.x += sin(swing) * below;
          transformed.y += (1.0 - cos(swing)) * below;
        } else {
          transformed.y += abs(sin(aGait.x)) * 0.03 * stride;
        }
        if (aGait.y < 0.0 && transformed.x < 0.0) transformed.y -= min(-transformed.x, 0.3) * 0.6;`,
      );
  };
  return mat;
}
