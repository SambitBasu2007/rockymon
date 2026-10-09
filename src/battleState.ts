/**
 * Battle state machine — the turn loop shared by Rocky and the boss.
 *
 * The press itself is filtered by an `ActionGate` (see `actionGate.ts`), and
 * the gate that ships today (`InstantGate`) resolves on the spot. A future
 * puzzle gate can keep its own UI up while its promise is pending — the
 * phases below stay unchanged.
 *
 * Flow:
 *   PLAYER_TURN → (attack pressed, gate passes) → PLAYER_ANIMATING → BOSS_TURN
 *   BOSS_TURN → (counter pressed in time, gate passes) → COUNTER_ANIMATING → PLAYER_TURN
 *   BOSS_TURN → (timeout or gate cancels) → BOSS_ANIMATING → PLAYER_TURN
 *
 * When either HP hits 0 the machine ends in VICTORY or DEFEAT instead.
 *
 * This file is pure state — it touches no DOM and no Three.js object. `main.ts`
 * (or a future battle controller) subscribes with `onPhaseChange`, mirrors the
 * HP/timer values into the battle UI, and plays the animations.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum BattlePhase {
  IDLE = 'IDLE',
  PLAYER_TURN = 'PLAYER_TURN', // Waiting for player to press ATTACK
  PLAYER_ANIMATING = 'PLAYER_ANIMATING', // Rocky's attack animation playing
  BOSS_TURN = 'BOSS_TURN', // Warning shown, counter button available, 45s timer running
  COUNTER_ANIMATING = 'COUNTER_ANIMATING', // Successful counter: Rocky attacks
  BOSS_ANIMATING = 'BOSS_ANIMATING', // Failed counter: Boss attacks Rocky
  VICTORY = 'VICTORY',
  DEFEAT = 'DEFEAT',
}

export interface BattleState {
  phase: BattlePhase;
  bossHP: number; // 0-100
  rockyHP: number; // 0-100
  timerRemaining: number; // seconds
  timerActive: boolean;
  damageBoostActive: boolean; // +25% after taking a hit
  turnCount: number;
}

/** HP every fighter starts — and returns to — a fresh battle with. */
const MAX_HP = 100;

/** Seconds left on the counter timer when `onTimerWarning` fires. */
const WARNING_AT_SECONDS = 10;

/** Extra damage a player attack gains after Rocky has been hit. */
const DAMAGE_BOOST_BONUS = 25;

// ---------------------------------------------------------------------------
// BattleStateMachine
// ---------------------------------------------------------------------------

export class BattleStateMachine {
  private state: BattleState;
  private listeners: Map<BattlePhase, (() => void)[]> = new Map();
  private timerInterval: number | null = null;

  /** Fired once, on the tick the counter timer reaches 10 seconds. */
  onTimerWarning: (() => void) | null = null;

  constructor() {
    this.state = this.freshState();
  }

  /** Full-HP state, still IDLE — `startBattle()` is what begins the loop. */
  private freshState(): BattleState {
    return {
      phase: BattlePhase.IDLE,
      bossHP: MAX_HP,
      rockyHP: MAX_HP,
      timerRemaining: 0,
      timerActive: false,
      damageBoostActive: false,
      turnCount: 0,
    };
  }

  /** Rewinds to full HP and hands the first turn to the player. */
  startBattle(): void {
    this.stopTimer(); // a restart must not leave the old interval ticking
    this.state = this.freshState();
    this.transitionTo(BattlePhase.PLAYER_TURN);
  }

  /** Snapshot copy — callers can't reach in and mutate the live state. */
  getState(): BattleState {
    return { ...this.state };
  }

  getPhase(): BattlePhase {
    return this.state.phase;
  }

  /** Subscribes to entering `phase`; several listeners per phase are allowed. */
  onPhaseChange(phase: BattlePhase, callback: () => void): void {
    const list = this.listeners.get(phase);
    if (list) {
      list.push(callback);
    } else {
      this.listeners.set(phase, [callback]);
    }
  }

  /**
   * Advances to `phase` from outside the machine — the battle coordinator's
   * entry point into the turn loop (`BattleStateMachine` still owns every
   * transition; the coordinator only asks for one).
   */
  advanceTo(phase: BattlePhase): void {
    this.transitionTo(phase);
  }

  /** Sets the phase and notifies that phase's listeners (in registration order). */
  private transitionTo(phase: BattlePhase): void {
    this.state.phase = phase;
    for (const callback of this.listeners.get(phase) ?? []) callback();
  }

  // -------------------------------------------------------------------------
  // Counter timer
  // -------------------------------------------------------------------------

  /**
   * Starts (or restarts) the countdown. `onTimerWarning` fires once when
   * `WARNING_AT_SECONDS` remain; at zero `onTimerExpire()` runs.
   */
  startTimer(duration: number): void {
    this.stopTimer();
    this.state.timerRemaining = duration;
    this.state.timerActive = true;

    let warned = false;
    this.timerInterval = setInterval(() => {
      this.state.timerRemaining = Math.max(0, this.state.timerRemaining - 1);

      if (!warned && this.state.timerRemaining <= WARNING_AT_SECONDS) {
        warned = true;
        this.onTimerWarning?.();
      }

      if (this.state.timerRemaining <= 0) this.onTimerExpire();
    }, 1000);
  }

  stopTimer(): void {
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.state.timerActive = false;
  }

  /**
   * Ran out of time. Only meaningful during BOSS_TURN, where it counts as a
   * failed counter, so the boss lands its hit; any other phase just stops.
   */
  private onTimerExpire(): void {
    this.stopTimer();
    if (this.state.phase === BattlePhase.BOSS_TURN) {
      this.transitionTo(BattlePhase.BOSS_ANIMATING);
    }
  }

  getTimerRemaining(): number {
    return this.state.timerRemaining;
  }

  // -------------------------------------------------------------------------
  // Damage
  // -------------------------------------------------------------------------

  /**
   * Rocky's attack lands. Boss HP is clamped at 0 and the fight ends in
   * VICTORY the moment it empties.
   *
   * @param baseDamage damage before the boost, in HP points
   */
  dealDamageToBoss(baseDamage: number): void {
    const dealt = baseDamage + (this.state.damageBoostActive ? DAMAGE_BOOST_BONUS : 0);
    this.state.bossHP = Math.max(0, this.state.bossHP - dealt);

    // The boost is spent on this hit whether or not it was active.
    this.state.damageBoostActive = false;
    this.state.turnCount += 1;

    if (this.state.bossHP <= 0) this.transitionTo(BattlePhase.VICTORY);
  }

  /**
   * The boss's attack lands. Rocky HP is clamped at 0 and the fight ends in
   * DEFEAT the moment it empties.
   */
  dealDamageToRocky(damage: number): void {
    this.state.rockyHP = Math.max(0, this.state.rockyHP - damage);
    this.state.damageBoostActive = true;

    if (this.state.rockyHP <= 0) {
      this.transitionTo(BattlePhase.DEFEAT);
    }
  }

  /** Whether Rocky's next attack carries the bonus. */
  isDamageBoostActive(): boolean {
    return this.state.damageBoostActive;
  }

  // -------------------------------------------------------------------------
  // Reset
  // -------------------------------------------------------------------------

  /** Back to IDLE at full HP, no timer, no boost. */
  reset(): void {
    this.stopTimer();
    this.state = this.freshState();
  }
}
