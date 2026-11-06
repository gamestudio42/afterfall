import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { VfxSystem, type FxEvent } from "../src/vfx";

/** Cena e camera de verdade (Three roda sem WebGL); so o render precisa de GL. */
function system() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 30, 30);
  camera.lookAt(0, 0, 0);
  return { scene, camera, vfx: new VfxSystem(scene) };
}

function fx(seq: number, type: string, x = 0, y = 0): FxEvent {
  return { seq, type, x, y, tx: x, ty: y };
}

describe("efeitos visuais", () => {
  it("nao cria particula para evento que nao tem efeito", () => {
    const { vfx } = system();
    vfx.emit([fx(1, "unknown")]);
    expect(vfx.active).toBe(0);
  });

  it("cria as particulas de cada tipo e conta as instancias", () => {
    const { vfx } = system();
    vfx.emit([fx(1, "hit")]);
    expect(vfx.active).toBeGreaterThan(0);
    expect(vfx.active).toBe(vfx.mesh.count === 0 ? vfx.active : vfx.mesh.count);
    const afterHit = vfx.active;
    vfx.emit([fx(2, "death")]);
    expect(vfx.active).toBeGreaterThan(afterHit);
  });

  it("ignora eventos repetidos (mesmo seq)", () => {
    const { vfx } = system();
    vfx.emit([fx(1, "hit"), fx(1, "hit")]);
    const once = vfx.active;
    vfx.emit([fx(1, "hit")]);
    expect(vfx.active).toBe(once);
  });

  it("integra, preenche as matrizes e apaga no fim da vida", () => {
    const { vfx, camera } = system();
    vfx.emit([fx(1, "build")]);
    const total = vfx.active;
    vfx.update(0.016, camera);
    expect(vfx.mesh.count).toBe(total);
    // O atributo foi reescrito (version avanca a cada needsUpdate).
    expect(vfx.mesh.instanceMatrix.version).toBeGreaterThan(0);

    // Um passo maior que a vida maxima zera tudo.
    vfx.update(2, camera);
    expect(vfx.active).toBe(0);
    expect(vfx.mesh.count).toBe(0);
  });

  it("respeita o teto de particulas", () => {
    const { vfx } = system();
    const many = Array.from({ length: 400 }, (_, i) => fx(i + 1, "death"));
    vfx.emit(many);
    expect(vfx.active).toBeLessThanOrEqual(720);
  });

  describe("flipbook do estouro", () => {
    it("constroi um quadro por celula do atlas e um pool escondido", () => {
      const { scene } = system();
      const vfx = new VfxSystem(scene, undefined, new THREE.Texture());
      expect(vfx.pool.length).toBeGreaterThan(0);
      expect(vfx.pool.every((m) => m.visible === false)).toBe(true);
      // Each frame texture owns a sixth by a fifth of the sheet.
      const first = (vfx.pool[0].material as THREE.MeshBasicMaterial).map as THREE.Texture;
      expect(first.repeat.x).toBeCloseTo(1 / 6, 5);
      expect(first.repeat.y).toBeCloseTo(1 / 5, 5);
      expect(first.offset.x).toBeCloseTo(0, 5);
      expect(first.offset.y).toBeCloseTo(1 - 1 / 5, 5);
    });

    it("mostra um estouro por evento e o apaga quando a vida acaba", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene, undefined, new THREE.Texture());
      vfx.emit([fx(1, "death", 0, 0)]);
      expect(vfx.pool.filter((m) => m.visible).length).toBe(0);

      vfx.update(0.016, camera);
      expect(vfx.pool.filter((m) => m.visible).length).toBe(1);

      // Pinned to the start of its life, the frame is the first cell.
      vfx.debugPin(0);
      vfx.update(0.016, camera);
      const mat = vfx.pool[0].material as THREE.MeshBasicMaterial;
      expect(mat.map!.offset.x).toBeCloseTo(0, 5);

      // Pinned near the end, it has moved on to a later cell.
      vfx.debugPin(0.9);
      vfx.update(0.016, camera);
      expect(mat.map!.offset.x).toBeGreaterThan(0);

      // Unpinned and run past its life, it disappears.
      vfx.debugPin(null);
      for (let i = 0; i < 200; i++) vfx.update(0.05, camera);
      expect(vfx.pool.filter((m) => m.visible).length).toBe(0);
    });

    it("nao ganha estouro repetido do mesmo evento", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene, undefined, new THREE.Texture());
      vfx.emit([fx(7, "death", 0, 0), fx(7, "death", 0, 0)]);
      vfx.update(0.016, camera);
      expect(vfx.pool.filter((m) => m.visible).length).toBe(1);
    });
  });

  describe("muzzle flash", () => {
    function shot(seq: number, x: number, y: number, tx: number, ty: number): FxEvent {
      return { seq, type: "shot", x, y, tx, ty };
    }

    it("slices the strip into four frames, a quarter of the sheet each", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene, undefined, new THREE.Texture());
      vfx.setMuzzleAtlas(new THREE.Texture());
      vfx.emit([shot(1, 0, 0, 10, 0)]);
      vfx.debugPin(0);
      vfx.update(0.016, camera);
      const map = (vfx.pool[0].material as THREE.MeshBasicMaterial).map!;
      expect(map.repeat.x).toBeCloseTo(1 / 4, 5);
      expect(map.repeat.y).toBeCloseTo(1, 5);
      vfx.debugPin(0.9);
      vfx.update(0.016, camera);
      expect((vfx.pool[0].material as THREE.MeshBasicMaterial).map!.offset.x).toBeCloseTo(3 / 4, 5);
    });

    it("sits at the barrel, a step toward the target, and holds its size", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene);
      vfx.setMuzzleAtlas(new THREE.Texture());
      vfx.emit([shot(1, 2, 3, 2, 13)]);
      vfx.debugPin(0);
      vfx.update(0.016, camera);
      const mesh = vfx.pool[0];
      expect(mesh.visible).toBe(true);
      expect(mesh.position.x).toBeCloseTo(2, 5);
      expect(mesh.position.z).toBeCloseTo(3.9, 5);
      const start = mesh.scale.x;
      vfx.debugPin(0.9);
      vfx.update(0.016, camera);
      expect(mesh.scale.x).toBeCloseTo(start, 5);
    });

    it("is over in about a tenth of a second", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene);
      vfx.setMuzzleAtlas(new THREE.Texture());
      vfx.emit([shot(1, 0, 0, 5, 0)]);
      vfx.update(0.05, camera);
      expect(vfx.pool.filter((m) => m.visible).length).toBe(1);
      vfx.update(0.1, camera);
      expect(vfx.pool.filter((m) => m.visible).length).toBe(0);
    });

    it("falls back to the spark burst while the strip has not arrived", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene, undefined, new THREE.Texture());
      vfx.emit([shot(1, 0, 0, 5, 0)]);
      vfx.debugPin(0);
      vfx.update(0.016, camera);
      const map = (vfx.pool[0].material as THREE.MeshBasicMaterial).map!;
      expect(map.repeat.x).toBeCloseTo(1 / 6, 5);
    });

    it("keeps other events on the spark sheet", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene, undefined, new THREE.Texture());
      vfx.setMuzzleAtlas(new THREE.Texture());
      vfx.emit([fx(1, "hit")]);
      vfx.debugPin(0);
      vfx.update(0.016, camera);
      expect((vfx.pool[0].material as THREE.MeshBasicMaterial).map!.repeat.x).toBeCloseTo(1 / 6, 5);
    });
  });

  describe("infected strike", () => {
    function strike(seq: number, x: number, y: number, tx: number, ty: number): FxEvent {
      return { seq, type: "melee", x, y, tx, ty };
    }

    it("plays the seven-frame strip additively", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene, undefined, new THREE.Texture());
      vfx.setMeleeAtlas(new THREE.Texture());
      expect(vfx.meleeReady).toBe(true);
      vfx.emit([strike(1, 0, 0, 1, 0)]);
      vfx.debugPin(0);
      vfx.update(0.016, camera);
      const mat = vfx.pool[0].material as THREE.MeshBasicMaterial;
      expect(mat.map!.repeat.x).toBeCloseTo(1 / 7, 5);
      expect(mat.map!.repeat.y).toBeCloseTo(1, 5);
      expect(mat.blending).toBe(THREE.AdditiveBlending);
      vfx.debugPin(0.95);
      vfx.update(0.016, camera);
      expect((vfx.pool[0].material as THREE.MeshBasicMaterial).map!.offset.x).toBeCloseTo(6 / 7, 5);
    });

    it("sits on the victim, pulled back toward the attacker", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene);
      vfx.setMeleeAtlas(new THREE.Texture());
      vfx.emit([strike(1, 0, 0, 4, 0)]);
      vfx.debugPin(0);
      vfx.update(0.016, camera);
      expect(vfx.pool[0].position.x).toBeCloseTo(3.5, 5);
      expect(vfx.pool[0].position.z).toBeCloseTo(0, 5);
    });

    it("never lands behind an attacker standing closer than the pull", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene);
      vfx.setMeleeAtlas(new THREE.Texture());
      vfx.emit([strike(1, 0, 0, 0.2, 0)]);
      vfx.debugPin(0);
      vfx.update(0.016, camera);
      expect(vfx.pool[0].position.x).toBeCloseTo(0, 5);
    });

    it("mirrors every other strike", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene);
      vfx.setMeleeAtlas(new THREE.Texture());
      vfx.emit([strike(1, 0, 0, 2, 0), strike(2, 5, 0, 7, 0)]);
      vfx.debugPin(0);
      vfx.update(0.016, camera);
      expect(Math.sign(vfx.pool[0].scale.x)).not.toBe(Math.sign(vfx.pool[1].scale.x));
      expect(vfx.pool[0].scale.y).toBeGreaterThan(0);
      expect(vfx.pool[1].scale.y).toBeGreaterThan(0);
    });

    it("is over in about a quarter of a second", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene);
      vfx.setMeleeAtlas(new THREE.Texture());
      vfx.emit([strike(1, 0, 0, 2, 0)]);
      vfx.update(0.2, camera);
      expect(vfx.pool.filter((m) => m.visible).length).toBe(1);
      vfx.update(0.06, camera);
      expect(vfx.pool.filter((m) => m.visible).length).toBe(0);
    });

    it("replaces the physics particles once the strip has loaded", () => {
      const { scene } = system();
      const vfx = new VfxSystem(scene);
      vfx.emit([strike(1, 0, 0, 2, 0)]);
      expect(vfx.active).toBeGreaterThan(0);
      const loaded = new VfxSystem(scene);
      loaded.setMeleeAtlas(new THREE.Texture());
      loaded.emit([strike(1, 0, 0, 2, 0)]);
      expect(loaded.active).toBe(0);
    });

    it("falls back to the spark burst while the strip has not arrived", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene, undefined, new THREE.Texture());
      vfx.emit([strike(1, 0, 0, 2, 0)]);
      vfx.debugPin(0);
      vfx.update(0.016, camera);
      expect((vfx.pool[0].material as THREE.MeshBasicMaterial).map!.repeat.x).toBeCloseTo(1 / 6, 5);
    });
  });

  describe("noise ring", () => {
    function noise(seq: number, x: number, y: number, r: number): FxEvent {
      return { seq, type: "noise", x, y, r };
    }
    const visible = (vfx: VfxSystem) => vfx.pool.filter((m) => m.visible);

    it("lies flat on the ground and spans the noise radius", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene);
      vfx.setNoiseAtlas(new THREE.Texture());
      expect(vfx.noiseReady).toBe(true);
      vfx.emit([noise(1, 3, 4, 45)]);
      vfx.debugPin(0);
      vfx.update(0.016, camera);
      const mesh = vfx.pool[0];
      const mat = mesh.material as THREE.MeshBasicMaterial;
      expect(mat.map!.repeat.x).toBeCloseTo(1 / 4, 5);
      expect(mat.map!.repeat.y).toBeCloseTo(1 / 2, 5);
      expect(mat.blending).toBe(THREE.AdditiveBlending);
      expect(mesh.position.x).toBeCloseTo(3, 5);
      expect(mesh.position.z).toBeCloseTo(4, 5);
      // The quad's normal points up, whatever the camera does.
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
      expect(normal.y).toBeCloseTo(1, 5);
      // The last frame's ring fills 496 of 512 px, so the quad is a little wider than the radius.
      expect(mesh.scale.x * (496 / 512)).toBeCloseTo(90, 5);
    });

    it("draws nothing, and spawns no particles, without its sheet", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene, undefined, new THREE.Texture());
      vfx.emit([noise(1, 0, 0, 45)]);
      vfx.update(0.016, camera);
      expect(visible(vfx).length).toBe(0);
      expect(vfx.active).toBe(0);
    });

    it("drops a ring while another spreads from nearby", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene);
      vfx.setNoiseAtlas(new THREE.Texture());
      vfx.emit([noise(1, 0, 0, 45), noise(2, 4, 0, 45), noise(3, 30, 0, 45)]);
      vfx.update(0.016, camera);
      expect(visible(vfx).length).toBe(2);
    });

    it("keeps at most three alive", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene);
      vfx.setNoiseAtlas(new THREE.Texture());
      vfx.emit([0, 1, 2, 3, 4].map((i) => noise(i + 1, i * 50, 0, 45)));
      vfx.update(0.016, camera);
      expect(visible(vfx).length).toBe(3);
    });

    it("ignores a noise without a radius", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene);
      vfx.setNoiseAtlas(new THREE.Texture());
      vfx.emit([{ seq: 1, type: "noise", x: 0, y: 0 }]);
      vfx.update(0.016, camera);
      expect(visible(vfx).length).toBe(0);
    });

    it("is gone after a second", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene);
      vfx.setNoiseAtlas(new THREE.Texture());
      vfx.emit([noise(1, 0, 0, 70)]);
      vfx.update(0.9, camera);
      expect(visible(vfx).length).toBe(1);
      vfx.update(0.15, camera);
      expect(visible(vfx).length).toBe(0);
    });
  });

  describe("death cloud", () => {
    function mat(vfx: VfxSystem, i = 0): THREE.MeshBasicMaterial {
      return vfx.pool[i].material as THREE.MeshBasicMaterial;
    }

    it("plays the 4 by 2 sheet with normal blending", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene, undefined, new THREE.Texture());
      vfx.setDeathAtlas(new THREE.Texture());
      vfx.emit([fx(1, "death", 3, 4)]);
      vfx.debugPin(0);
      vfx.update(0.016, camera);
      expect(mat(vfx).map!.repeat.x).toBeCloseTo(1 / 4, 5);
      expect(mat(vfx).map!.repeat.y).toBeCloseTo(1 / 2, 5);
      expect(mat(vfx).blending).toBe(THREE.NormalBlending);
      expect(mat(vfx).opacity).toBe(1);
      expect(vfx.pool[0].position.x).toBeCloseTo(3, 5);
      expect(vfx.pool[0].position.z).toBeCloseTo(4, 5);
    });

    it("replaces the red additive particles, which buried the smoke", () => {
      const { scene } = system();
      const vfx = new VfxSystem(scene);
      vfx.setDeathAtlas(new THREE.Texture());
      vfx.emit([fx(1, "death")]);
      expect(vfx.active).toBe(0);
      vfx.emit([fx(2, "hit")]);
      expect(vfx.active).toBeGreaterThan(0);
    });

    it("fades by opacity at the end of its life", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene);
      vfx.setDeathAtlas(new THREE.Texture());
      vfx.emit([fx(1, "death")]);
      vfx.debugPin(0.95);
      vfx.update(0.016, camera);
      expect(mat(vfx).opacity).toBeGreaterThan(0);
      expect(mat(vfx).opacity).toBeLessThan(0.3);
    });

    it("gives the slot back to additive blending for the next spark", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene, undefined, new THREE.Texture());
      vfx.setDeathAtlas(new THREE.Texture());
      vfx.emit([fx(1, "death")]);
      vfx.update(0.016, camera);
      expect(mat(vfx).blending).toBe(THREE.NormalBlending);
      for (let i = 0; i < 40; i++) vfx.update(0.05, camera);
      vfx.emit([fx(2, "hit")]);
      vfx.update(0.016, camera);
      expect(mat(vfx).blending).toBe(THREE.AdditiveBlending);
      expect(mat(vfx).opacity).toBe(1);
    });

    it("falls back to the spark burst while the sheet has not arrived", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene, undefined, new THREE.Texture());
      expect(vfx.deathReady).toBe(false);
      vfx.emit([fx(1, "death")]);
      vfx.debugPin(0);
      vfx.update(0.016, camera);
      expect(mat(vfx).map!.repeat.x).toBeCloseTo(1 / 6, 5);
      expect(mat(vfx).blending).toBe(THREE.AdditiveBlending);
    });
  });

  describe("construction dust", () => {
    function visible(vfx: VfxSystem) {
      return vfx.pool.filter((m) => m.visible);
    }

    it("plays the 4 by 3 sheet, blending normally", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene, undefined, new THREE.Texture());
      vfx.setDustAtlas(new THREE.Texture());
      expect(vfx.dustReady).toBe(true);
      vfx.emit([fx(1, "build", 5, 6)]);
      vfx.debugPin(0);
      vfx.update(0.016, camera);
      const mat = vfx.pool[0].material as THREE.MeshBasicMaterial;
      expect(mat.map!.repeat.x).toBeCloseTo(1 / 4, 5);
      expect(mat.map!.repeat.y).toBeCloseTo(1 / 3, 5);
      expect(mat.blending).toBe(THREE.NormalBlending);
      expect(vfx.pool[0].position.x).toBeCloseTo(5, 5);
      expect(vfx.pool[0].position.y).toBeCloseTo(1.6, 5);
    });

    it("replaces the particles of a work tick", () => {
      const { scene } = system();
      const vfx = new VfxSystem(scene);
      vfx.setDustAtlas(new THREE.Texture());
      vfx.emit([fx(1, "build")]);
      expect(vfx.active).toBe(0);
    });

    it("keeps at most six clouds, so a busy site leaves slots for shots and deaths", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene);
      vfx.setDustAtlas(new THREE.Texture());
      vfx.setDeathAtlas(new THREE.Texture());
      vfx.emit(Array.from({ length: 20 }, (_, i) => fx(i + 1, "build", i, 0)));
      vfx.update(0.016, camera);
      expect(visible(vfx).length).toBe(6);
      vfx.emit([fx(100, "death")]);
      vfx.update(0.016, camera);
      expect(visible(vfx).length).toBe(7);
    });

    it("frees its slots when the dust settles", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene);
      vfx.setDustAtlas(new THREE.Texture());
      vfx.emit(Array.from({ length: 6 }, (_, i) => fx(i + 1, "build")));
      vfx.update(0.016, camera);
      for (let i = 0; i < 20; i++) vfx.update(0.05, camera);
      expect(visible(vfx).length).toBe(0);
      vfx.emit([fx(50, "build")]);
      vfx.update(0.016, camera);
      expect(visible(vfx).length).toBe(1);
    });

    it("falls back to the spark burst while the sheet has not arrived", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene, undefined, new THREE.Texture());
      vfx.emit([fx(1, "build")]);
      expect(vfx.active).toBeGreaterThan(0);
      vfx.debugPin(0);
      vfx.update(0.016, camera);
      expect((vfx.pool[0].material as THREE.MeshBasicMaterial).map!.repeat.x).toBeCloseTo(1 / 6, 5);
    });
  });

  describe("structure collapse", () => {
    function visible(vfx: VfxSystem) {
      return vfx.pool.filter((m) => m.visible);
    }

    it("plays the 5 by 2 rubble sheet, blending normally, standing high", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene, undefined, new THREE.Texture());
      vfx.setCollapseAtlas(new THREE.Texture());
      expect(vfx.collapseReady).toBe(true);
      vfx.emit([fx(1, "collapse", 7, 8)]);
      vfx.debugPin(0);
      vfx.update(0.016, camera);
      const mat = vfx.pool[0].material as THREE.MeshBasicMaterial;
      expect(mat.map!.repeat.x).toBeCloseTo(1 / 5, 5);
      expect(mat.map!.repeat.y).toBeCloseTo(1 / 2, 5);
      expect(mat.blending).toBe(THREE.NormalBlending);
      expect(vfx.pool[0].position.x).toBeCloseTo(7, 5);
      expect(vfx.pool[0].position.y).toBeCloseTo(2.4, 5);
      expect(vfx.pool[0].position.z).toBeCloseTo(8, 5);
    });

    it("replaces the particles once the sheet has loaded", () => {
      const { scene } = system();
      const vfx = new VfxSystem(scene);
      vfx.setCollapseAtlas(new THREE.Texture());
      vfx.emit([fx(1, "collapse")]);
      expect(vfx.active).toBe(0);
    });

    it("keeps at most four, so a breach leaves slots for the fight", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene);
      vfx.setCollapseAtlas(new THREE.Texture());
      vfx.emit(Array.from({ length: 8 }, (_, i) => fx(i + 1, "collapse", i * 3, 0)));
      vfx.update(0.016, camera);
      expect(visible(vfx).length).toBe(4);
    });

    it("falls back to the spark and grey particles while the sheet has not arrived", () => {
      const { scene, camera } = system();
      const vfx = new VfxSystem(scene, undefined, new THREE.Texture());
      vfx.emit([fx(1, "collapse")]);
      expect(vfx.active).toBeGreaterThan(0);
      vfx.debugPin(0);
      vfx.update(0.016, camera);
      expect((vfx.pool[0].material as THREE.MeshBasicMaterial).map!.repeat.x).toBeCloseTo(1 / 6, 5);
    });
  });
});
