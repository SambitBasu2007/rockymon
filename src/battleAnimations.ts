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

/** One live particle — an impact star, or a charge mote from the power-up. */
interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  /** Seconds of life remaining. */
  life: number;
  /** Seconds of life it spawned with — drives the shrink ramp. */
  maxLife: number;
  /** Scale it spawned at. */
  startScale: number;
}

/** One standalone timed effect (guard shield, charge-up) driven by `update`. */
interface TimedEffect {
  /** Only one effect per tag runs at a time; a new one replaces the old. */
  tag: string;
  /** Advances by dt; returns false once the effect has run its course. */
  step: (dt: number) => boolean;
  /** Removes whatever the effect added to the scene. Idempotent. */
  dispose: () => void;
  /** Settles the owning `AnimationResult` promise. */
  resolve: () => void;
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

// ---------------------------------------------------------------------------
// Counter flash — the guard shield and Rocky's charge-up
// ---------------------------------------------------------------------------

/** Seconds the shield is on screen: snap in, hold, fade. */
const SHIELD_DURATION = 1.6;

/** Shield diameter in world units — the fighters are ~10 units tall. */
const SHIELD_SIZE = 14;

/** How far toward the threat the shield floats, in world units. Small, so the
 *  disc sits over Rocky's sprite, with just enough clearance to read as being
 *  held out in front of him. */
const SHIELD_OFFSET = 2;

/** Lift off the defender's centre so the shield covers its body. */
const SHIELD_LIFT = 0;

/** Charge motes per second while the power-up runs. */
const POWERUP_EMIT_RATE = 24;

/** Seconds each charge mote lives. */
const POWERUP_LIFE = 0.9;

/** Charge mote scale in world units. */
const POWERUP_SCALE = 1.6;

/** Upward drift of the charge motes, world units per second. */
const POWERUP_RISE = 3.5;

/** Radius of the ring the motes spawn in, around the fighter's feet. */
const POWERUP_SPREAD = 4.5;

/** Gold, so the buff reads distinctly against the blue shield. */
const POWERUP_COLOR = 0xffd84d;

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

/**
 * Draws a translucent blue energy shield on a 64x64 canvas: a soft glowing
 * disc with a slim rim and a fine hex facet grid — hairline strokes so the
 * pattern reads as a hard-light/futuristic barrier rather than chunky pixel
 * rings. Nearest-filtered to match the sprite art.
 */
export function generateShieldTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = size / 2;
    const r = c - 3;

    // Body: bright core falling off to a soft edge, kept partly transparent.
    const body = ctx.createRadialGradient(c, c, r * 0.15, c, c, r);
    body.addColorStop(0, 'rgba(200, 235, 255, 0.45)');
    body.addColorStop(0.55, 'rgba(70, 160, 255, 0.38)');
    body.addColorStop(1, 'rgba(30, 90, 220, 0.30)');

    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();

    // Rim: the hard edge that makes it read as a barrier — one slim pass.
    ctx.strokeStyle = 'rgba(150, 220, 255, 0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c, c, r - 1, 0, Math.PI * 2);
    ctx.stroke();

    // A hairline ring inset from the rim.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c, c, r * 0.68, 0, Math.PI * 2);
    ctx.stroke();

    // Six hairline spokes for a hex/facet grid.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      ctx.beginPath();
      ctx.moveTo(c - Math.cos(angle) * (r - 5), c - Math.sin(angle) * (r - 5));
      ctx.lineTo(c + Math.cos(angle) * (r - 5), c + Math.sin(angle) * (r - 5));
      ctx.stroke();
    }
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
  private shieldTex: THREE.Texture | null = null;
  private tween: AttackTween | null = null;
  private effects: TimedEffect[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  /** Star texture, created on first use and shared by every particle. */
  private getStarTexture(): THREE.Texture {
    if (!this.starTex) this.starTex = generateStarTexture();
    return this.starTex;
  }

  /** Shield texture, created on first use and shared across counters. */
  private getShieldTexture(): THREE.Texture {
    if (!this.shieldTex) this.shieldTex = generateShieldTexture();
    return this.shieldTex;
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

      this.particles.push({
        sprite,
        vel,
        life: PARTICLE_LIFE,
        maxLife: PARTICLE_LIFE,
        startScale: PARTICLE_SCALE,
      });
      this.scene.add(sprite);
    }
  }

  /**
   * Plays the counter's guard shield: a big translucent blue disc that snaps
   * into place in front of `defender`, holds, then fades.
   *
   * The shield floats `SHIELD_OFFSET` units toward whatever is coming, so it
   * sits over the defender's own sprite — held out in front of him, between
   * him and the threat — rather than drifting off into the gap.
   */
  playShieldAnimation(defender: THREE.Sprite, threat: THREE.Sprite): AnimationResult {
    const material = new THREE.SpriteMaterial({
      map: this.getShieldTexture(),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity: 0,
    });
    const shield = new THREE.Sprite(material);

    // Direction from the defender to whatever is attacking it.
    const dir = threat.position.clone().sub(defender.position);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();

    shield.position
      .copy(defender.position)
      .addScaledVector(dir, SHIELD_OFFSET);
    shield.position.y = defender.position.y + SHIELD_LIFT;
    shield.scale.set(SHIELD_SIZE, SHIELD_SIZE, 1);
    // The disc sits a hair beyond Rocky (between him and the boss), so force it
    // to draw over him: no depth test, and the top render order in the scene.
    shield.renderOrder = 5;
    this.scene.add(shield);

    return this.runEffect('shield', SHIELD_DURATION, (elapsed) => {
      const k = clamp01(elapsed / SHIELD_DURATION);

      // Snap in over the first 15%, hold steady, fade over the last 30%.
      let alpha: number;
      if (k < 0.15) {
        alpha = 0.85 * easeOut(k / 0.15);
      } else if (k < 0.7) {
        alpha = 0.85;
      } else {
        alpha = 0.85 * (1 - easeIn((k - 0.7) / 0.3));
      }

      material.opacity = alpha;
    }, () => {
      this.scene.remove(shield);
      material.dispose();
    });
  }

  /**
   * Plays Rocky's charge-up: gold motes rising from a ring at his feet for
   * `duration` seconds. Purely presentational — no stat changes here.
   *
   * The motes are ordinary particles with their own lifetime, so there is
   * nothing to tear down when the effect ends.
   */
  playPowerUp(target: THREE.Sprite, duration: number): AnimationResult {
    let accumulator = 0;

    return this.runEffect(
      'powerup',
      duration,
      (elapsed, dt) => {
        accumulator += dt * POWERUP_EMIT_RATE;
        while (accumulator >= 1) {
          accumulator -= 1;
          this.spawnChargeMote(target);
        }
        // Motes keep drifting after the emitter stops, so the finish isn't abrupt.
        void elapsed;
      },
      () => {
        /* nothing to remove — motes are self-expiring particles */
      },
    );
  }

  /** One gold mote drifting up from around the fighter's feet. */
  private spawnChargeMote(target: THREE.Sprite): void {
    const material = new THREE.SpriteMaterial({
      map: this.getStarTexture(),
      color: POWERUP_COLOR,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);

    // Ring around the feet, biased toward the camera (+Z) so it reads outward.
    const angle = Math.random() * Math.PI * 2;
    const radius = POWERUP_SPREAD * (0.4 + Math.random() * 0.6);
    sprite.position.set(
      target.position.x + Math.cos(angle) * radius,
      target.position.y - 2 + Math.random() * 2,
      target.position.z + Math.sin(angle) * radius * 0.6 + 1,
    );
    sprite.scale.set(POWERUP_SCALE, POWERUP_SCALE, 1);

    const vel = new THREE.Vector3(
      Math.cos(angle) * 0.6,
      POWERUP_RISE * (0.7 + Math.random() * 0.6),
      Math.sin(angle) * 0.3 + 1.2,
    );

    this.particles.push({
      sprite,
      vel,
      life: POWERUP_LIFE,
      maxLife: POWERUP_LIFE,
      startScale: POWERUP_SCALE,
    });
    this.scene.add(sprite);
  }

  /**
   * Registers a standalone timed effect and returns its handle. Only one
   * effect per tag runs at a time — a second call replaces the first, which
   * keeps an out-of-order counter from stacking shields.
   */
  private runEffect(
    tag: string,
    duration: number,
    step: (elapsed: number, dt: number) => void,
    dispose: () => void,
  ): AnimationResult {
    const prior = this.effects.find((e) => e.tag === tag);
    if (prior) {
      this.effects.splice(this.effects.indexOf(prior), 1);
      prior.dispose();
      prior.resolve();
    }

    let resolveEffect: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      resolveEffect = resolve;
    });

    let elapsed = 0;
    let disposed = false;

    const effect: TimedEffect = {
      tag,
      step: (dt) => {
        elapsed += dt;
        step(elapsed, dt);
        return elapsed < duration;
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        dispose();
      },
      resolve: resolveEffect,
    };

    this.effects.push(effect);

    return {
      promise,
      cancel: () => {
        const index = this.effects.indexOf(effect);
        if (index !== -1) this.effects.splice(index, 1);
        effect.dispose();
        effect.resolve();
      },
    };
  }

  /**
   * The single animation driver — call once per frame from the game loop.
   * Advances the attack tween, every effect and every particle.
   */
  update(dt: number): void {
    this.updateTween(dt);
    this.updateEffects(dt);
    this.updateParticles(dt);
  }

  private updateEffects(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i];
      if (effect.step(dt)) continue;

      effect.dispose();
      effect.resolve();
      this.effects.splice(i, 1);
    }
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
      const k = particle.life / particle.maxLife;
      const scale = particle.startScale * k;
      particle.sprite.scale.set(scale, scale, 1);
    }
  }

  /** Cancels the running attack (restoring its sprite), any live effect and
   *  clears all particles. Safe to call repeatedly. */
  cancelAll(): void {
    const tween = this.tween;
    if (tween) {
      tween.attacker.position.copy(tween.origin);
      this.tween = null;
      tween.resolve();
    }

    for (const effect of this.effects) {
      effect.dispose();
      effect.resolve();
    }
    this.effects = [];

    for (const particle of this.particles) {
      this.scene.remove(particle.sprite);
      particle.sprite.material.dispose();
    }
    this.particles = [];
  }
}
