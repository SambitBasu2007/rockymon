import * as THREE from 'three';

// Vite asset glob so the PNGs also resolve to hashed URLs in production builds.
const bossAssetUrls = import.meta.glob('/assets/boss/**/*.png', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const IDLE_FILE = 'bossidle.png';
const BATTLE_FILE = 'bossbattle.png';

/**
 * Boss character rendered as a camera-facing billboard sprite.
 * It stands idle wherever it is placed and swaps to its battle pose when
 * `setBattleMode(true)` is called. Art lives in `assets/boss/` — the two PNGs
 * shipped today are placeholders meant to be replaced.
 */
export class Boss {
  private readonly sprite: THREE.Sprite;
  private readonly material: THREE.SpriteMaterial;
  private idleTexture: THREE.Texture | null = null;
  private battleTexture: THREE.Texture | null = null;
  private readonly pos = new THREE.Vector3();
  private isInBattle = false;

  /** Horizontal distance (world units) within which the player counts as
   *  touching the boss. main.ts raises this to suit the room's scale, where
   *  the player is 10 units tall. */
  interactionRadius = 3;

  /** Fired once per approach, on the frame the player first comes into range. */
  onPlayerTouch: (() => void) | null = null;

  /** Latches true after a touch so the callback can't re-fire every frame;
   *  cleared once the player walks back out of range. */
  private wasTouched = false;

  /** Visual height in world units; used to keep the feet on the floor. */
  private spriteHeight = 10;

  constructor(
    parent: THREE.Scene | THREE.Group,
    private readonly basePath: string = '/assets/boss/',
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
   * Loads the idle and battle textures.
   * A missing file is tolerated: the boss falls back to whichever texture did
   * load, and stays invisible if neither did (never a blank white quad).
   */
  async load(): Promise<void> {
    const loader = new THREE.TextureLoader();
    const cleanBase = this.basePath.endsWith('/') ? this.basePath : `${this.basePath}/`;

    const resolveUrl = (filename: string): string =>
      bossAssetUrls[`${cleanBase}${filename}`] ?? `${cleanBase}${filename}`;

    const loadTexture = (url: string): Promise<THREE.Texture> =>
      new Promise((resolve, reject) => {
        loader.load(
          url,
          (tex) => {
            tex.magFilter = THREE.NearestFilter;
            tex.minFilter = THREE.NearestFilter;
            tex.colorSpace = THREE.SRGBColorSpace;
            resolve(tex);
          },
          undefined,
          (err) => reject(err),
        );
      });

    const [idle, battle] = await Promise.all([
      loadTexture(resolveUrl(IDLE_FILE)).catch(() => null),
      loadTexture(resolveUrl(BATTLE_FILE)).catch(() => null),
    ]);

    this.idleTexture = idle;
    this.battleTexture = battle;
    this.isInBattle = false;

    const initial = idle ?? battle;
    if (initial) {
      this.material.map = initial;
      this.material.needsUpdate = true;
      this.sprite.visible = true;
    } else {
      // No art at all — keep the sprite out of the scene rather than showing
      // an untextured (solid white) quad.
      this.sprite.visible = false;
    }
  }

  /** Places the boss by its feet: the sprite is raised half its height so its
   *  bottom edge sits on the ground plane. */
  setPosition(pos: THREE.Vector3): void {
    this.pos.copy(pos);
    this.sprite.position.set(pos.x, pos.y + this.spriteHeight / 2, pos.z);
  }

  /** Sets the sprite dimensions in world units and re-anchors the feet. */
  setScale(width: number, height: number): void {
    this.spriteHeight = height;
    this.sprite.scale.set(width, height, 1);
    this.setPosition(this.pos);
  }

  /** Returns the boss feet position in world space. */
  getPosition(): THREE.Vector3 {
    return this.pos;
  }

  /** Returns the underlying Three.js sprite. */
  getObject(): THREE.Sprite {
    return this.sprite;
  }

  /**
   * Proximity test against the player's feet position. Only the horizontal
   * (XZ) distance is compared, so jumping or standing on a raised patch of
   * floor doesn't change the result.
   *
   * Detection only: nothing here starts a battle.
   *
   * @returns `true` **only** on the frame the touch is first detected; the
   *          latched `wasTouched` flag suppresses repeats until the player
   *          leaves `interactionRadius` and returns.
   */
  checkProximity(playerPos: THREE.Vector3): boolean {
    const dx = playerPos.x - this.pos.x;
    const dz = playerPos.z - this.pos.z;
    const distance = Math.hypot(dx, dz);

    if (distance <= this.interactionRadius) {
      if (!this.wasTouched) {
        this.wasTouched = true;
        this.onPlayerTouch?.();
        return true;
      }
      return false;
    }

    this.wasTouched = false;
    return false;
  }

  /** Switches between the idle and battle poses (no-op if that art is missing). */
  setBattleMode(battle: boolean): void {
    this.isInBattle = battle;
    const tex = (battle ? this.battleTexture : this.idleTexture)
      ?? this.idleTexture
      ?? this.battleTexture;
    if (tex) {
      this.material.map = tex;
      this.material.needsUpdate = true;
    }
  }
}
