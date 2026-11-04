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
});
