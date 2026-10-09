/**
 * Stub audio manager — the hook where sound effects live, so battle code never
 * has to change when real files are dropped in later.
 *
 * Today every `play()` is a no-op (nothing is loaded). When a sound file is
 * ready, `loadSound(effect, url)` is enough: the battle coordinator bits get
 * no edits at all.
 */

export enum SoundEffect {
  ATTACK_JUMP,
  ATTACK_IMPACT,
  BOSS_HIT,
  ROCKY_HIT,
  VICTORY,
  DEFEAT,
  TIMER_WARNING,
  COUNTER_PROMPT,
}

export class AudioManager {
  private readonly clips = new Map<SoundEffect, HTMLAudioElement>();
  private enabled = true;

  /** Register (and preload) a sound for a given effect. */
  loadSound(effect: SoundEffect, url: string): void {
    let el = this.clips.get(effect);
    if (!el) {
      el = new Audio();
      el.preload = 'auto';
      this.clips.set(effect, el);
    }
    el.src = url;
    el.load();
  }

  /**
   * Play a sound effect. No-op if not loaded or if audio is disabled.
   * Fire-and-forget: never await this from a hot path.
   */
  play(effect: SoundEffect): void {
    if (!this.enabled) return;
    const el = this.clips.get(effect);
    if (!el?.src) return;
    try {
      el.currentTime = 0;
      void el.play().catch(() => {});
    } catch {
      /* no-op */
    }
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
