import * as THREE from "three";

/**
 * Orbiting RTS camera: looks at a ground target from a fixed pitch, with
 * yaw rotation and zoom. Movement is smoothed towards target values.
 */
export class RtsCamera {
  readonly camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3();
  yaw = Math.PI * 0.25;
  pitch = 0.92;
  distance = 170;
  private goalTarget = new THREE.Vector3();
  private goalYaw = this.yaw;
  private goalPitch = this.pitch;
  private goalDistance = this.distance;
  bounds = { minX: 0, maxX: 400, minZ: 0, maxZ: 400 };
  minDistance = 22;
  maxDistance = 320;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.5, 2000);
  }

  setBounds(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.bounds = { minX, maxX, minZ, maxZ };
  }

  jumpTo(x: number, z: number): void {
    this.goalTarget.set(x, 0, z);
    this.target.copy(this.goalTarget);
  }

  focus(x: number, z: number): void {
    this.goalTarget.set(x, 0, z);
  }

  /** Pans in screen-aligned directions (right, forward), in meters scaled by zoom. */
  pan(right: number, forward: number): void {
    const k = this.goalDistance / 120;
    const sin = Math.sin(this.goalYaw);
    const cos = Math.cos(this.goalYaw);
    this.goalTarget.x += (right * cos - forward * sin) * k;
    this.goalTarget.z += (-right * sin - forward * cos) * k;
    this.clampTarget();
  }

  rotate(dYaw: number, dPitch = 0): void {
    this.goalYaw += dYaw;
    this.goalPitch = Math.min(1.35, Math.max(0.45, this.goalPitch + dPitch));
  }

  zoom(factor: number): void {
    this.goalDistance = Math.min(this.maxDistance, Math.max(this.minDistance, this.goalDistance * factor));
  }

  private clampTarget(): void {
    const b = this.bounds;
    this.goalTarget.x = Math.min(b.maxX, Math.max(b.minX, this.goalTarget.x));
    this.goalTarget.z = Math.min(b.maxZ, Math.max(b.minZ, this.goalTarget.z));
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 10);
    this.target.lerp(this.goalTarget, k);
    this.yaw += (this.goalYaw - this.yaw) * k;
    this.pitch += (this.goalPitch - this.pitch) * k;
    this.distance += (this.goalDistance - this.distance) * k;
    const horiz = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * horiz,
      Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * horiz,
    );
    this.camera.lookAt(this.target);
  }
}
