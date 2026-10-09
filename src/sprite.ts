import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Direction = 'down' | 'up' | 'left' | 'right';

export interface SpriteFrame {
  texture: THREE.Texture;
  direction: Direction;
}

// ---------------------------------------------------------------------------
// File-name tables per direction
// ---------------------------------------------------------------------------

/** Idle PNG filename for each direction. Note: left uses rockyleftidle1.png */
const IDLE_FILE: Record<Direction, string> = {
  down: 'rockydownidle.png',
  up: 'rockyupidle.png',
  left: 'rockyleftidle1.png',
  right: 'rockyrightidle.png',
};

/** Walk frame filenames (1-3) for each direction */
const WALK_FILES: Record<Direction, [string, string, string]> = {
  down: ['rockydownwalk1.png', 'rockydownwalk2.png', 'rockydownwalk3.png'],
  up: ['rockyupwalk1.png', 'rockyupwalk2.png', 'rockyupwalk3.png'],
  left: ['rockyleftwalk1.png', 'rockyleftwalk2.png', 'rockyleftwalk3.png'],
  right: ['rockyrightwalk1.png', 'rockyrightwalk2.png', 'rockyrightwalk3.png'],
};

const DIRECTIONS: Direction[] = ['down', 'up', 'left', 'right'];

/**
 * Battle pose, shown for the whole fight and never during free movement.
 *
 * Unlike the walk/idle frames this file lives at the rocky root rather than in
 * a per-direction subfolder, it has no white export border (0 px on all four
 * edges, so it skips `EDGE_CROP_PX`), and it is not square — 2400x1792, an
 * aspect of ~1.34 against the square 490x490 walk frames. `setBattleMode()`
 * re-fits the sprite to that aspect so the pose is not stretched.
 */
const BATTLE_FILE = 'rockybattle.png';

/**
 * Pixels trimmed from every edge of each frame.
 *
 * Several exported PNGs carry an opaque white border that renders as white lines
 * along the sprite's edges — most visibly while the down/walk cycle plays.
 * Measured border widths (full-width 100% white strips):
 *
 *   rockydownwalk1.png  top 6, bottom 2, left 4, right 4
 *   rockydownwalk2.png  top 3
 *   rockydownwalk3.png  bottom 1
 *   up/left/right walk frames + rightidle, rightwalk1  ~1
 *   rockydownidle.png   clean
 *
 * 7 px = the worst band (6) + 1 px of margin so an anti-aliased blend row can't
 * survive. Every one of those bands sits on an edge where the artwork starts at
 * least 40 px in, so trimming is safe; the one frame with art near a border
 * (`rockydownwalk3.png`, whose right arm starts ~5 px in) loses ~2 px, which is
 * sub-pixel once the 490 px frame is drawn 10 world units tall.
 *
 * The trim is symmetric, so frames stay centred relative to one another, and it
 * goes through the texture matrix (offset/repeat) — no image copies, no
 * per-frame cost.
 */
const EDGE_CROP_PX = 7;

// Vite asset glob to support both dev server and production builds
const spriteAssetUrls = import.meta.glob('/assets/rocky/**/*.png', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// ---------------------------------------------------------------------------
// SpriteCharacter
// ---------------------------------------------------------------------------

/**
 * Billboarded 2D character sprite rendered in the 3D world.
 * The sprite faces the camera (Three.js Sprite billboarding) and displays
 * directional 4-way walk and idle cycles.
 */
export class SpriteCharacter {
  private readonly sprite: THREE.Sprite;
  private readonly material: THREE.SpriteMaterial;

  private readonly frames: Map<Direction, THREE.Texture[]> = new Map();
  private readonly idleFrames: Map<Direction, THREE.Texture> = new Map();

  private currentDirection: Direction = 'down';
  private walkFrameIndex: number = 0;
  private walkTimer: number = 0;
  readonly walkFrameDuration: number = 0.15;
  private isWalking: boolean = false;

  /** Battle pose, or null if that art failed to load (battle then no-ops). */
  private battleTexture: THREE.Texture | null = null;
  private isInBattle: boolean = false;

  /** World position of the sprite (feet position, same as player.pos) */
  readonly pos: THREE.Vector3 = new THREE.Vector3();

  private spriteHeight: number = 10;

  /**
   * Non-battle scale in world units, kept current by setScale() so
   * setBattleMode(false) can restore it after re-fitting for the battle pose.
   */
  private readonly normalScale = new THREE.Vector2(10, 10);

  constructor(
    parent: THREE.Scene | THREE.Group,
    private readonly basePath: string = '/assets/rocky/',
  ) {
    this.material = new THREE.SpriteMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    this.sprite = new THREE.Sprite(this.material);
    parent.add(this.sprite);
  }

  /**
   * Loads all sprite textures from the asset directory.
   */
  async load(): Promise<void> {
    const loader = new THREE.TextureLoader();
    const cleanBase = this.basePath.endsWith('/') ? this.basePath : `${this.basePath}/`;

    const resolveUrl = (dir: Direction, filename: string): string => {
      const globKey = `${cleanBase}${dir}/${filename}`;
      if (spriteAssetUrls[globKey]) {
        return spriteAssetUrls[globKey];
      }
      return `${cleanBase}${dir}/${filename}`;
    };

    /** The battle pose sits at the rocky root, not in a direction folder. */
    const resolveBattleUrl = (): string => {
      const globKey = `${cleanBase}${BATTLE_FILE}`;
      return spriteAssetUrls[globKey] ?? `${cleanBase}${BATTLE_FILE}`;
    };

    const loadTexture = (url: string, trimEdges = true): Promise<THREE.Texture> =>
      new Promise((resolve, reject) => {
        loader.load(
          url,
          (tex) => {
            tex.magFilter = THREE.NearestFilter;
            tex.minFilter = THREE.NearestFilter;
            tex.colorSpace = THREE.SRGBColorSpace;

            // Trim the edge fringe by sampling slightly inside the image.
            const img = tex.image as { width?: number; height?: number } | undefined;
            const w = img?.width ?? 0, h = img?.height ?? 0;
            if (trimEdges && w > 0 && h > 0) {
              const cx = Math.min(0.05, EDGE_CROP_PX / w);
              const cy = Math.min(0.05, EDGE_CROP_PX / h);
              tex.repeat.set(1 - 2 * cx, 1 - 2 * cy);
              tex.offset.set(cx, cy);
            }

            resolve(tex);
          },
          undefined,
          (err) => reject(err),
        );
      });

    await Promise.all([
      ...DIRECTIONS.map(async (dir) => {
        const idleTex = await loadTexture(resolveUrl(dir, IDLE_FILE[dir]));
        this.idleFrames.set(dir, idleTex);

        const walkTexs = await Promise.all(
          WALK_FILES[dir].map((filename) => loadTexture(resolveUrl(dir, filename))),
        );
        this.frames.set(dir, walkTexs);
      }),
      // Tolerated: if the art is missing, battle mode degrades to a no-op and
      // the walk/idle frames stay on screen rather than a blank quad.
      loadTexture(resolveBattleUrl(), false)
        .then((tex) => { this.battleTexture = tex; })
        .catch(() => { /* battle pose unavailable */ }),
    ]);

    // Initial texture display
    const initialIdle = this.idleFrames.get(this.currentDirection);
    if (initialIdle) {
      this.material.map = initialIdle;
      this.material.needsUpdate = true;
    }
  }

  /**
   * Updates current facing direction and updates active texture.
   */
  setDirection(direction: Direction): void {
    this.currentDirection = direction;
    if (this.isInBattle) return; // the battle pose ignores facing
    const tex = this.isWalking
      ? this.frames.get(direction)?.[this.walkFrameIndex]
      : this.idleFrames.get(direction);
    if (tex) {
      this.material.map = tex;
      this.material.needsUpdate = true;
    }
  }

  /**
   * Sets whether the character is currently walking.
   * Resetting from walking to idle resets the walk frame index to 0.
   */
  setWalking(walking: boolean): void {
    if (this.isWalking === walking) return;
    this.isWalking = walking;
    if (!walking) {
      this.walkFrameIndex = 0;
      this.walkTimer = 0;
      if (this.isInBattle) return;
      const idle = this.idleFrames.get(this.currentDirection);
      if (idle) {
        this.material.map = idle;
        this.material.needsUpdate = true;
      }
    }
  }

  /**
   * Accumulates animation timer and cycles through walk frames if walking.
   */
  update(dt: number): void {
    if (this.isInBattle) return; // hold the battle pose for the whole fight
    if (this.isWalking) {
      this.walkTimer += dt;
      if (this.walkTimer >= this.walkFrameDuration) {
        this.walkTimer %= this.walkFrameDuration;
        this.walkFrameIndex = (this.walkFrameIndex + 1) % 3;
        const walkTex = this.frames.get(this.currentDirection)?.[this.walkFrameIndex];
        if (walkTex) {
          this.material.map = walkTex;
          this.material.needsUpdate = true;
        }
      }
    } else {
      const idleTex = this.idleFrames.get(this.currentDirection);
      if (idleTex && this.material.map !== idleTex) {
        this.material.map = idleTex;
        this.material.needsUpdate = true;
      }
    }
  }

  /**
   * Copies pos to internal vector and centers sprite above ground (feet anchor).
   */
  setPosition(pos: THREE.Vector3): void {
    this.pos.copy(pos);
    this.sprite.position.set(pos.x, pos.y + this.spriteHeight / 2, pos.z);
  }

  /**
   * Returns the Three.js Sprite object.
   */
  getObject(): THREE.Sprite {
    return this.sprite;
  }

  /**
   * Sets sprite dimensions in world units.
   */
  setScale(width: number, height: number): void {
    this.spriteHeight = height;
    this.normalScale.set(width, height);
    this.sprite.scale.set(width, height, 1);
    this.setPosition(this.pos);
  }

  /**
   * Holds `rockybattle.png` for the whole fight, or restores the normal
   * walk/idle frames when the battle ends.
   *
   * The pose is 2400x1792 against the square walk frames, so it is drawn at its
   * own aspect: height is kept and the width follows the art, which stops the
   * sprite being stretched by the square 10x10 rig. Exiting battle re-fits the
   * square scale back and re-shows the frame for the current direction, so the
   * movement sprites come back untouched.
   *
   * No-op if the art failed to load, leaving the walk/idle frames on screen.
   */
  setBattleMode(battle: boolean): void {
    if (battle && !this.battleTexture) return;
    this.isInBattle = battle;

    if (battle) {
      this.material.map = this.battleTexture;
      this.material.needsUpdate = true;
      this.fitToTexture(this.battleTexture);
      return;
    }

    // Leaving battle: back to the square overworld scale, then the current frame.
    this.spriteHeight = this.normalScale.y;
    this.sprite.scale.set(this.normalScale.x, this.normalScale.y, 1);
    this.setPosition(this.pos);
    const tex = this.isWalking
      ? this.frames.get(this.currentDirection)?.[this.walkFrameIndex]
      : this.idleFrames.get(this.currentDirection);
    if (tex) {
      this.material.map = tex;
      this.material.needsUpdate = true;
    }
  }

  /** Draws the sprite at the texture's true aspect, holding its height. */
  private fitToTexture(tex: THREE.Texture | null): void {
    const img = tex?.image as { width?: number; height?: number } | undefined;
    const w = img?.width ?? 0, h = img?.height ?? 0;
    const height = this.normalScale.y;
    const width = w > 0 && h > 0 ? height * (w / h) : this.normalScale.x;
    this.spriteHeight = height;
    this.sprite.scale.set(width, height, 1);
    this.setPosition(this.pos);
  }
}
