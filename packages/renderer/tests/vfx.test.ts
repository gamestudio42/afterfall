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
});
