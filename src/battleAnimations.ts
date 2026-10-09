import * as THREE from 'three';

/**
 * Battle animations — the retro "Pokémon-style" attack: the attacker jumps,
 * thrusts at the target, stars pop where the hit lands, and it settles back.
 *
 * Everything is driven by a single `update(dt)` call per frame. There are no
 * `setTimeout` chains anywhere: the tween advances on elapsed time and each
 * phase is read from that elapsed value, so a paused tab, a slow frame or a
 * dropped frame all stay consistent (and `cancel()` is instant).
 *
 * This module is presentation only. It moves sprites and spawns particles — it
 * never decides damage; the caller passes an `onImpact` callback that fires
 * exactly once, at the end of the thrust.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnimationResult {
  /** Resolves when the attacker is back at its origin (or on cancel). */
  promise: Promise<void>;
  /** Aborts immediately and restores the attacker's original position. */
  cancel: () => void;
}

/** One live star particle. */
interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
}

/** The in-flight attack tween, advanced by `update(dt)`. */
interface AttackTween {
  attacker: THREE.Sprite;
  target: THREE.Sprite;
  origin: THREE.Vector3;
  elapsed: number;
  impacted: boolean;
  /** Called once at the end of the thrust. */
  onImpact: () => void;
  /** Settles the result's `promise`. */
  resolve: () => void;
}

// ---------------------------------------------------------------------------
// Timing (seconds) — phases are read from elapsed time, never chained timers
// ---------------------------------------------------------------------------

const JUMP_END = 0.4;
const THRUST_END = 0.7;
const TOTAL = 1.2;

/** Peak jump height in world units (the fighters are ~10 units tall). */
const JUMP_HEIGHT = 3;

/** How far along the line to the target the thrust stops, 0-1. */
const THRUST_REACH = 0.6;

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

const PARTICLE_COUNT_MIN = 6;
const PARTICLE_COUNT_MAX = 8;
const PARTICLE_LIFE = 0.4; // seconds
const PARTICLE_SCALE = 1.5;
const PARTICLE_SPEED = 7;

/**
 * Draws a 4-pointed star (✦) on a 32x32 canvas and wraps it as a texture.
 * Nearest-filtered so it keeps its crisp pixel look when scaled up, matching
 * the sprite art. Built on demand — the canvas only exists if stars are used.
 */
export function generateStarTexture(): THREE.Texture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = size / 2;
    const outer = 15;
    const inner = 5;

    // White core fading to yellow at the tips.
    const grad = ctx.createRadialGradient(c, c, 1, c, c, outer);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#ffe066');

    ctx.fillStyle = grad;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      // Alternate between the 4 long points and the concave notches between them.
      const radius = i % 2 === 0 ? outer : inner;
      const angle = (Math.PI / 4) * i - Math.PI / 2;
      const x = c + Math.cos(angle) * radius;
      const y = c + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Easings
// ---------------------------------------------------------------------------

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeIn = (t: number): number => t * t;
const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

// ---------------------------------------------------------------------------
// BattleAnimationManager
// ---------------------------------------------------------------------------

export class BattleAnimationManager {
  private particles: Particle[] = [];
  private starTex: THREE.Texture | null = null;
  private tween: AttackTween | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  /** Star texture, created on first use and shared by every particle. */
  private getStarTexture(): THREE.Texture {
    if (!this.starTex) this.starTex = generateStarTexture();
    return this.starTex;
  }

  /**
   * Plays the attack: jump (0 → 0.4 s), thrust toward the target (0.4 → 0.7 s),
   * return to the origin (0.7 → 1.2 s).
   *
   * `onImpact` fires exactly once, at the end of the thrust, just before the
   * stars appear — that is the caller's hook to apply damage and play a sound.
   *
   * Only one attack runs at a time; starting another cancels the first (its
   * promise resolves, so no `await` is ever left hanging).
   */
  playAttackAnimation(
    attacker: THREE.Sprite,
    target: THREE.Sprite,
    onImpact: () => void,
  ): AnimationResult {
    this.cancelAll();

    const origin = attacker.position.clone();
    let resolveTween: () => void = () => {};

    const promise = new Promise<void>((resolve) => {
      resolveTween = resolve;
    });

    this.tween = {
      attacker,
      target,
      origin,
      elapsed: 0,
      impacted: false,
      onImpact,
      resolve: resolveTween,
    };

    return {
      promise,
      cancel: () => {
        const tween = this.tween;
        if (!tween || tween.attacker !== attacker) return;
        tween.attacker.position.copy(tween.origin);
        this.tween = null;
        tween.resolve();
      },
    };
  }

  /** Spawns a burst of shrinking stars at `pos`. */
  spawnImpactParticles(pos: THREE.Vector3): void {
    const tex = this.getStarTexture();
    const count =
      PARTICLE_COUNT_MIN + Math.floor(Math.random() * (PARTICLE_COUNT_MAX - PARTICLE_COUNT_MIN + 1));

    for (let i = 0; i < count; i++) {
      const material = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(pos);
      sprite.scale.set(PARTICLE_SCALE, PARTICLE_SCALE, 1);

      // Random direction on a sphere, nudged toward the camera (+Z) so the
      // burst reads as coming out of the screen rather than in a flat plane.
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const vel = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi) * 0.5 + 0.6,
      )
        .normalize()
        .multiplyScalar(PARTICLE_SPEED * (0.5 + Math.random() * 0.5));

      this.particles.push({ sprite, vel, life: PARTICLE_LIFE });
      this.scene.add(sprite);
    }
  }

  /**
   * The single animation driver — call once per frame from the game loop.
   * Advances the attack tween and every star particle.
   */
  update(dt: number): void {
    this.updateTween(dt);
    this.updateParticles(dt);
  }

  private updateTween(dt: number): void {
    const tween = this.tween;
    if (!tween) return;

    tween.elapsed += dt;
    const { attacker, target, origin } = tween;
    const t = tween.elapsed;

    // Midpoint of the two fighters — where the stars burst from.
    const midpoint = origin.clone().lerp(target.position, THRUST_REACH / 2);

    if (t < JUMP_END) {
      // JUMP: rise straight up, decelerating.
      const p = easeOut(clamp01(t / JUMP_END));
      attacker.position.set(origin.x, origin.y + JUMP_HEIGHT * p, origin.z);
    } else if (t < THRUST_END) {
      // THRUST: horizontal lunge ~60% of the way to the target, accelerating.
      const p = easeIn(clamp01((t - JUMP_END) / (THRUST_END - JUMP_END)));
      const dest = origin.clone().lerp(target.position, THRUST_REACH);
      attacker.position.set(
        origin.x + (dest.x - origin.x) * p,
        origin.y + JUMP_HEIGHT * (1 - p), // arcs down as it lunges
        origin.z + (dest.z - origin.z) * p,
      );
    } else {
      // RETURN: settle back to the origin.
      const p = easeInOut(clamp01((t - THRUST_END) / (TOTAL - THRUST_END)));
      const dest = origin.clone().lerp(target.position, THRUST_REACH);
      attacker.position.set(
        dest.x + (origin.x - dest.x) * p,
        origin.y,
        dest.z + (origin.z - dest.z) * p,
      );
    }

    // Impact fires on the frame that crosses the end of the thrust — once.
    if (!tween.impacted && t >= THRUST_END) {
      tween.impacted = true;
      tween.onImpact();
      this.spawnImpactParticles(midpoint);
    }

    if (t >= TOTAL) {
      attacker.position.copy(origin);
      this.tween = null;
      tween.resolve();
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.life -= dt;

      if (particle.life <= 0) {
        this.scene.remove(particle.sprite);
        particle.sprite.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }

      // Drift, and shrink away as the life runs out.
      particle.sprite.position.addScaledVector(particle.vel, dt);
      const k = particle.life / PARTICLE_LIFE;
      particle.sprite.scale.set(PARTICLE_SCALE * k, PARTICLE_SCALE * k, 1);
    }
  }

  /** Cancels the running attack (restoring its sprite) and clears all stars. */
  cancelAll(): void {
    const tween = this.tween;
    if (tween) {
      tween.attacker.position.copy(tween.origin);
      this.tween = null;
      tween.resolve();
    }

    for (const particle of this.particles) {
      this.scene.remove(particle.sprite);
      particle.sprite.material.dispose();
    }
    this.particles = [];
  }
}
