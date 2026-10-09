import * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';

export interface MoveInput {
  moveX: number; // +1 = right
  moveZ: number; // +1 = forward
  jump: boolean;
  run: boolean;
  use: boolean; // "E" key / use button
}

/**
 * Pure movement + collision logic (no DOM), so it can be tested headlessly.
 * The player is a vertical capsule colliding with the triangles of the world (a BVH).
 * `pos` is the point at the FEET. Y is up, -Z is forward at yaw 0.
 */
export class Player {
  private static readonly sizeScale = 10 / 1.7;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  onGround = false;
  /**
   * Yaw (radians) used to rotate movement input into world space.
   * Set once by main.ts from the fixed 2.5D camera's view direction so that
   * W/S/A/D always move along the same world axes (screen up/down/left/right).
   * It never changes during gameplay.
   */
  fixedYaw = 0;
  collider: MeshBVH | null = null; // set by main whenever the world changes
  killY = -100;                    // fall below this and you respawn
  readonly radius = 0.3 * Player.sizeScale;
  readonly height = 10;
  walkSpeed = 4 * Player.sizeScale;
  runSpeed = 7 * Player.sizeScale;
  jumpSpeed = 12 * Math.sqrt(Player.sizeScale); // apex is ~3.6 world units at the 10-unit player scale
  gravity = 20 * Player.sizeScale;
  private readonly spawn = new THREE.Vector3();
  private readonly seg = new THREE.Line3();
  private readonly box = new THREE.Box3();
  private readonly tp = new THREE.Vector3();
  private readonly cp = new THREE.Vector3();
  private readonly push = new THREE.Vector3();

  teleport(p: THREE.Vector3) {
    this.pos.copy(p);
    this.spawn.copy(p);
    this.vel.set(0, 0, 0);
    this.onGround = false;
  }

  update(dt: number, input: MoveInput) {
    if (!this.collider) return;
    let left = Math.min(dt, 0.1);
    for (let i = 0; i < 400 && left > 1e-6; i++) {
      // Substeps prevent the enlarged capsule from skipping thin floors.
      const fast = Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y), Math.abs(this.vel.z), this.runSpeed);
      const h = Math.min(left, 1 / 60, 0.15 / fast);
      this.step(h, input);
      left -= h;
    }
  }

  private step(h: number, inp: MoveInput) {
    // Rotate the raw input axes by the fixed camera yaw so movement stays
    // world-aligned for the static 2.5D camera.
    const sin = Math.sin(this.fixedYaw), cos = Math.cos(this.fixedYaw);
    let dx = cos * inp.moveX - sin * inp.moveZ;
    let dz = -sin * inp.moveX - cos * inp.moveZ;
    const len = Math.hypot(dx, dz);
    if (len > 1) { dx /= len; dz /= len; }
    const speed = inp.run ? this.runSpeed : this.walkSpeed;
    const a = 1 - Math.exp(-(this.onGround ? 15 : 3) * h); // snappy on ground, floaty in air
    this.vel.x += (dx * speed - this.vel.x) * a;
    this.vel.z += (dz * speed - this.vel.z) * a;

    if (inp.jump && this.onGround) { this.vel.y = this.jumpSpeed; this.onGround = false; }
    this.vel.y = Math.max(this.vel.y - this.gravity * h, -60);

    this.pos.addScaledVector(this.vel, h);
    this.collide(h);
    if (this.pos.y < this.killY) this.teleport(this.spawn);
  }

  /** Push the capsule out of every world triangle it overlaps. */
  private collide(h: number) {
    const bvh = this.collider!;
    const r = this.radius, seg = this.seg, box = this.box;
    seg.start.set(this.pos.x, this.pos.y + r, this.pos.z);               // bottom sphere centre
    seg.end.set(this.pos.x, this.pos.y + this.height - r, this.pos.z);   // top sphere centre
    box.makeEmpty().expandByPoint(seg.start).expandByPoint(seg.end);
    box.min.addScalar(-r); box.max.addScalar(r);

    bvh.shapecast({
      intersectsBounds: (b) => b.intersectsBox(box),
      intersectsTriangle: (tri) => {
        const d = tri.closestPointToSegment(seg, this.tp, this.cp);
        if (d < r) {
          const dir = this.cp.sub(this.tp).normalize();
          seg.start.addScaledVector(dir, r - d);
          seg.end.addScaledVector(dir, r - d);
        }
        return false;
      },
    });

    this.push.set(seg.start.x - this.pos.x, seg.start.y - r - this.pos.y, seg.start.z - this.pos.z);
    const len = this.push.length();
    // pushed mostly upwards = standing on something (slopes up to ~60 degrees count as ground)
    this.onGround = this.push.y > Math.abs(h * this.vel.y * 0.25);
    if (len > 1e-5) {
      this.push.divideScalar(len);                         // unit direction of the push
      if (this.onGround) { if (this.vel.y < 0) this.vel.y = 0; }
      else { const d = this.vel.dot(this.push); if (d < 0) this.vel.addScaledVector(this.push, -d); } // slide along walls
      this.pos.addScaledVector(this.push, len - 1e-5);
    }
  }
}
