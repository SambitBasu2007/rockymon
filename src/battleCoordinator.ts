import { Vector3 } from 'three';
import type { Scene, Sprite } from 'three';
import { BattleStateMachine, BattlePhase } from './battleState';
import { BattleUIController } from './battleUI';
import { BattleAnimationManager } from './battleAnimations';
import { GateRouter, InstantGate } from './actionGate';
import type { SpriteCharacter } from './sprite';
import type { Boss } from './boss';
import { BATTLE_POSITIONS } from './battle';
import { AudioManager, SoundEffect } from './audio';

/**
 * Battle coordinator — the orchestrator that ties everything together:
 * `BattleStateMachine` (whose turn it is), `BattleUIController` (the DOM),
 * `BattleAnimationManager` (the jump-thrust + stars), the `ActionGate` router
 * (which may one day ask a puzzle before an action fires) and the two sprites.
 *
 * It owns the *sequence*, nothing else. Damage numbers live here because they
 * are battle rules; the state machine only applies what it is handed.
 *
 * Wiring:
 *   press ATTACK  ──▶ gate ──▶ Rocky's animation ──▶ 25 damage ──▶ BOSS_TURN
 *   press COUNTER!──▶ gate ──▶ proceed: guard counter (see below) ──▶ PLAYER_TURN
 *                        └──▶ cancel / timeout: Boss hits for 45 ──▶ PLAYER_TURN
 *
 * A *successful* counter is a distinct three-beat sequence, not a plain attack:
 *   1. the boss's swing and the blue guard shield start on the same frame —
 *      the swing is animation only, the blow never lands
 *   2. Rocky charges for two seconds
 *   3. Rocky's normal strike finishes it off
 * The phases are unchanged — the whole sequence runs inside COUNTER_ANIMATING.
 */

const PLAYER_ATTACK_DAMAGE = 25;
const COUNTER_DAMAGE = 25;
const BOSS_ATTACK_DAMAGE = 45;

/** Seconds Rocky spends charging between the shield flash and his strike. */
const COUNTER_CHARGE_SECONDS = 2;

const COUNTER_TIMER_SECONDS = 45;
const WARNING_DELAY_MS = 2000;
const OUTCOME_DELAY_MS = 3000;

export class BattleCoordinator {
  private readonly stateMachine = new BattleStateMachine();
  private readonly ui: BattleUIController;
  private readonly animManager: BattleAnimationManager;
  private readonly audio: AudioManager;
  private readonly gateRouter = new GateRouter([new InstantGate()]);

  private readonly rocky: SpriteCharacter;
  private readonly boss: Boss;
  private readonly rockySpriteObj: Sprite;
  private readonly bossSpriteObj: Sprite;

  private isActive = false;
  private busy = false;

  private readonly originalRockyPos = new Vector3();
  private readonly originalBossPos = new Vector3();

  private timeouts: number[] = [];

  private onBattleStart: (() => void) | null = null;
  private onBattleEnd: (() => void) | null = null;

  constructor(scene: Scene, rocky: SpriteCharacter, boss: Boss) {
    this.rocky = rocky;
    this.boss = boss;
    this.rockySpriteObj = rocky.getObject();
    this.bossSpriteObj = boss.getObject();

    this.ui = new BattleUIController();
    this.animManager = new BattleAnimationManager(scene);
    this.audio = new AudioManager();

    this.ui.setOnAttack(() => { void this.handleAttackPress(); });
    this.ui.setOnCounter(() => { void this.handleCounterPress(); });

    this.registerPhaseListeners();

    this.stateMachine.onTimerWarning = () => {
      this.audio.play(SoundEffect.TIMER_WARNING);
    };
  }

  setOnBattleStart(cb: () => void): void {
    this.onBattleStart = cb;
  }

  setOnBattleEnd(cb: () => void): void {
    this.onBattleEnd = cb;
  }

  /** Stages both fighters, shows the overlay and gives the player the first turn. */
  startBattle(): void {
    if (this.isActive) return;

    this.isActive = true;
    this.onBattleStart?.();

    this.originalRockyPos.copy(this.rocky.pos);
    this.originalBossPos.copy(this.boss.getPosition());

    this.rocky.setWalking(false);
    this.rocky.setDirection('up');
    this.rocky.setPosition(BATTLE_POSITIONS.rocky);
    // Rocky holds his battle pose for the whole fight; the render loop's walk
    // cycle and direction sync are frozen while isActive, so nothing can stomp it.
    this.rocky.setBattleMode(true);
    this.boss.setPosition(BATTLE_POSITIONS.boss);
    this.boss.setBattleMode(true);

    this.ui.show();
    this.ui.reset();
    this.syncHP();
    this.stateMachine.startBattle();
  }

  /**
   * Tears the battle down. A win removes the boss from the scene for good; a
   * loss puts both fighters back where the fight started and returns the boss
   * to its idle pose.
   */
  endBattle(victory: boolean): void {
    this.clearTimeouts();
    this.ui.hide();
    this.animManager.cancelAll();
    this.stateMachine.stopTimer();

    if (victory) {
      this.boss.getObject().removeFromParent();
    } else {
      this.rocky.setPosition(this.originalRockyPos);
      this.boss.setPosition(this.originalBossPos);
      this.boss.setBattleMode(false);
    }

    // Rocky is never removed from the scene, so his pose has to be restored on
    // both outcomes — the movement sprites come back for free afterwards, since
    // setBattleMode(false) re-shows the frame for the current direction and the
    // render loop resumes the walk/idle cycle.
    this.rocky.setBattleMode(false);

    this.isActive = false;
    this.busy = false;
    this.onBattleEnd?.();
  }

  isBattleActive(): boolean {
    return this.isActive;
  }

  update(dt: number): void {
    this.animManager.update(dt);

    if (this.stateMachine.getState().timerActive) {
      this.ui.updateTimer(this.stateMachine.getTimerRemaining());
    }
  }

  private registerPhaseListeners(): void {
    this.stateMachine.onPhaseChange(BattlePhase.PLAYER_TURN, () => {
      this.ui.showAttackButton();
      this.ui.hideWarning();
      this.ui.hideTimer();
    });

    this.stateMachine.onPhaseChange(BattlePhase.BOSS_TURN, () => {
      this.ui.showWarning();
      this.later(() => {
        this.ui.showCounterButton();
        this.audio.play(SoundEffect.COUNTER_PROMPT);
        this.stateMachine.startTimer(COUNTER_TIMER_SECONDS);
      }, WARNING_DELAY_MS);
    });

    this.stateMachine.onPhaseChange(BattlePhase.BOSS_ANIMATING, () => {
      this.runBossAttack();
    });

    this.stateMachine.onPhaseChange(BattlePhase.VICTORY, () => {
      this.ui.showVictory();
      this.audio.play(SoundEffect.VICTORY);
      this.later(() => this.endBattle(true), OUTCOME_DELAY_MS);
    });

    this.stateMachine.onPhaseChange(BattlePhase.DEFEAT, () => {
      this.ui.showDefeat();
      this.audio.play(SoundEffect.DEFEAT);
      this.later(() => this.endBattle(false), OUTCOME_DELAY_MS);
    });
  }

  private async handleAttackPress(): Promise<void> {
    if (!this.isActive || this.busy) return;
    if (this.stateMachine.getPhase() !== BattlePhase.PLAYER_TURN) return;

    this.busy = true;
    try {
      const verdict = await this.gateRouter.requestAction();
      if (verdict === 'cancel') return;

      this.stateMachine.advanceTo(BattlePhase.PLAYER_ANIMATING);
      await this.playAttack(this.rockySpriteObj, this.bossSpriteObj, () =>
        this.stateMachine.dealDamageToBoss(PLAYER_ATTACK_DAMAGE),
      );

      if (this.stateMachine.getPhase() !== BattlePhase.VICTORY) {
        this.stateMachine.advanceTo(BattlePhase.BOSS_TURN);
      }
    } finally {
      this.busy = false;
    }
  }

  private async handleCounterPress(): Promise<void> {
    if (!this.isActive || this.busy) return;
    if (this.stateMachine.getPhase() !== BattlePhase.BOSS_TURN) return;

    this.busy = true;
    let handoff = false;
    try {
      this.stateMachine.stopTimer();
      this.ui.hideTimer();

      const verdict = await this.gateRouter.requestAction();

      if (verdict === 'proceed') {
        this.stateMachine.advanceTo(BattlePhase.COUNTER_ANIMATING);
        // The counter button is done for this exchange either way.
        this.ui.hideActions();

        await this.runGuardCounter();

        const phase = this.stateMachine.getPhase();
        if (phase !== BattlePhase.VICTORY && phase !== BattlePhase.DEFEAT) {
          this.stateMachine.advanceTo(BattlePhase.PLAYER_TURN);
        }
      } else {
        handoff = true;
        this.busy = false;
        this.stateMachine.advanceTo(BattlePhase.BOSS_ANIMATING);
      }
    } finally {
      if (!handoff) this.busy = false;
    }
  }

  /**
   * The counter a successful COUNTER! press plays:
   *   1. the boss's swing and the guard shield fire together — the swing is
   *      a show of force only, Rocky takes no damage from it
   *   2. Rocky charges for two seconds
   *   3. Rocky's normal strike finishes the exchange
   *
   * Every beat bails out if the fight ends first — `endBattle()` cancels
   * whatever is in flight, which resolves the pending promise rather than
   * leaving an `await` hanging.
   */
  private async runGuardCounter(): Promise<void> {
    // 1. Start the swing first: launching an attack calls `cancelAll()`, which
    //    would wipe out a shield spawned before it. The shield then goes up on
    //    the very same frame, so the two read as one move — blow and block.
    const swing = this.playAttack(
      this.bossSpriteObj,
      this.rockySpriteObj,
      // Blocked clean: the swing is pure animation, no HP is exchanged.
      () => {},
    );
    const guard = this.animManager.playShieldAnimation(this.rockySpriteObj, this.bossSpriteObj);
    await Promise.all([swing, guard.promise]);
    if (!this.canCounterContinue()) return;

    // 2. Rocky charges.
    await this.animManager.playPowerUp(this.rockySpriteObj, COUNTER_CHARGE_SECONDS).promise;
    if (!this.canCounterContinue()) return;

    // 3. The strike — byte-for-byte the ATTACK button's animation.
    await this.playAttack(this.rockySpriteObj, this.bossSpriteObj, () =>
      this.stateMachine.dealDamageToBoss(COUNTER_DAMAGE),
    );
  }

  /** True while the battle is still live and nobody has won it yet. */
  private canCounterContinue(): boolean {
    if (!this.isActive) return false;
    const phase = this.stateMachine.getPhase();
    return phase !== BattlePhase.VICTORY && phase !== BattlePhase.DEFEAT;
  }

  private runBossAttack(): void {
    if (!this.isActive || this.busy) return;

    this.busy = true;
    void (async () => {
      try {
        this.stateMachine.stopTimer();
        this.ui.hideTimer();
        await this.playAttack(this.bossSpriteObj, this.rockySpriteObj, () =>
          this.stateMachine.dealDamageToRocky(BOSS_ATTACK_DAMAGE),
        );

        if (this.stateMachine.getPhase() !== BattlePhase.DEFEAT) {
          this.stateMachine.advanceTo(BattlePhase.PLAYER_TURN);
        }
      } finally {
        this.busy = false;
      }
    })();
  }

  /**
   * Plays one strike and applies `applyDamage` on impact (then refreshes the HP
   * bars). Resolves when the attacker is back at its mark.
   */
  private async playAttack(
    attacker: Sprite,
    target: Sprite,
    applyDamage: () => void,
  ): Promise<void> {
    this.audio.play(SoundEffect.ATTACK_JUMP);
    const rockyIsAttacker = attacker === this.rockySpriteObj;
    const { promise } = this.animManager.playAttackAnimation(attacker, target, () => {
      this.audio.play(SoundEffect.ATTACK_IMPACT);
      applyDamage();
      this.audio.play(rockyIsAttacker ? SoundEffect.BOSS_HIT : SoundEffect.ROCKY_HIT);
      this.syncHP();
    });

    await promise;
  }

  private syncHP(): void {
    const state = this.stateMachine.getState();
    this.ui.updateHP(state.bossHP, state.rockyHP);
  }

  private later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timeouts = this.timeouts.filter((t) => t !== id);
      fn();
    }, ms);
    this.timeouts.push(id);
  }

  private clearTimeouts(): void {
    for (const id of this.timeouts) clearTimeout(id);
    this.timeouts = [];
  }
}
