import type { MoveInput } from './player';

/**
 * Game input for the fixed-camera 2.5D view: keyboard, the mobile D-Pad and
 * the jump touch button. There is no pointer lock and no mouse look — the camera
 * angle never changes, so `read()` only reports movement/action state.
 *
 * `playing` gates the whole game loop: false while the start/pause menu is
 * open, true once Play is clicked. main.ts toggles it via `start()` / `pause()`
 * and mirrors it into the overlay through `onPlayChange`.
 */
export class GameInput {
  /** True while gameplay runs; false while the start/pause menu is open. */
  playing = false;
  /** Fired whenever `playing` changes; main.ts uses it to show/hide the menu. */
  onPlayChange: ((playing: boolean) => void) | null = null;
  private keys = new Set<string>();

  // --- Touch button state ---
  private jumpButton = false;

  // --- Mobile D-Pad state (true while the matching button is held) ---
  private dpadUp = false;
  private dpadDown = false;
  private dpadLeft = false;
  private dpadRight = false;

  private readonly jumpEl = document.getElementById('jumpBtn');

  constructor() {
    // Keyboard events
    window.addEventListener('keydown', (e) => {
      if (!this.playing) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    this.jumpEl?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.jumpButton = true;
    });
    this.jumpEl?.addEventListener('pointerup', () => { this.jumpButton = false; });
    this.jumpEl?.addEventListener('pointercancel', () => { this.jumpButton = false; });
    this.jumpEl?.addEventListener('pointerleave', () => { this.jumpButton = false; });
  }

  /** Starts (or resumes) gameplay and hides the menu. */
  start() {
    this.playing = true;
    this.onPlayChange?.(true);
  }

  /** Pauses gameplay and brings the menu back (bound to Escape). */
  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.keys.clear(); // no stuck keys when the player resumes
    this.onPlayChange?.(false);
  }

  /**
   * Wires the four mobile D-Pad buttons. Each button sets its direction while
   * held and clears it on pointerup / pointercancel / pointerleave.
   * Called once from main.ts after construction.
   */
  bindDpad(elements: { up: HTMLElement; down: HTMLElement; left: HTMLElement; right: HTMLElement }) {
    const bind = (el: HTMLElement, set: (pressed: boolean) => void) => {
      const press = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation(); // keep other canvas handlers from also firing
        set(true);
      };
      const release = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        set(false);
      };
      el.addEventListener('pointerdown', press);
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('pointerleave', release);
    };

    bind(elements.up, (pressed) => { this.dpadUp = pressed; });
    bind(elements.down, (pressed) => { this.dpadDown = pressed; });
    bind(elements.left, (pressed) => { this.dpadLeft = pressed; });
    bind(elements.right, (pressed) => { this.dpadRight = pressed; });
  }

  read(): MoveInput {
    const k = (c: string) => this.keys.has(c);

    // Keyboard axes
    const keyboardMoveX = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    const keyboardMoveZ = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);

    // D-Pad axes: right = +moveX, up = +moveZ (forward)
    const dpadMoveX = (this.dpadRight ? 1 : 0) - (this.dpadLeft ? 1 : 0);
    const dpadMoveZ = (this.dpadUp ? 1 : 0) - (this.dpadDown ? 1 : 0);

    // Keyboard wins whenever a movement key is held; otherwise use the D-Pad.
    const moveX = keyboardMoveX !== 0 ? keyboardMoveX : dpadMoveX;
    const moveZ = keyboardMoveZ !== 0 ? keyboardMoveZ : dpadMoveZ;

    return {
      moveX,
      moveZ,
      jump: k('Space') || this.jumpButton,
      use: k('E'),
      run: k('ShiftLeft') || k('ShiftRight'),
    };
  }
}
