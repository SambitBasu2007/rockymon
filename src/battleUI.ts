/**
 * Battle UI controller — the bridge between the battle DOM (`#battle-ui` in
 * `index.html`) and the battle logic (`battleState.ts`).
 *
 * The controller owns the widgets: HP bars, the ATTACK / COUNTER! buttons, the
 * countdown and the warning banner. It holds no game state — the battle
 * controller pushes values in (`updateHP`, `updateTimer`, …) and receives
 * presses out (`setOnAttack`, `setOnCounter`).
 *
 * A future `ActionGate` that needs UI (a puzzle panel, for example) manages
 * its own DOM and only reports `'proceed'` / `'cancel'` back through the gate
 * interface. Nothing here knows a puzzle could exist.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** HP bar colours, by remaining health. Applied via the `--hp-color` custom
 *  property that `index.html` bakes into the segmented pixel gradient, so the
 *  JS never has to know how the bar is drawn. */
const HP_COLOR_HIGH = '#58d854'; // > 50, green
const HP_COLOR_MID = '#f8b800'; // 25-50, amber
const HP_COLOR_LOW = '#f83800'; // < 25, retro red

/** The timer starts pulsing at this many seconds or fewer. */
const TIMER_WARNING_SECONDS = 10;

/** Default warning banner copy, matching `index.html`. */
const WARNING_TEXT = 'The monster is about to attack! Counter quickly!';

/** ID of the victory/defeat text node created on demand inside `#battle-ui`. */
const OUTCOME_ID = 'battle-outcome';

const OUTCOME_STYLE =
  'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);' +
  'font-size:56px;font-weight:bold;text-align:center;letter-spacing:.06em;' +
  'text-shadow:3px 3px 6px rgba(0,0,0,.85);pointer-events:none;';

/** Looks up a required element; a missing one is a wiring bug, not a soft fail. */
function requireElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`BattleUIController: missing #${id} in the DOM`);
  }
  return element as T;
}

// ---------------------------------------------------------------------------
// BattleUIController
// ---------------------------------------------------------------------------

export class BattleUIController {
  private readonly root: HTMLElement;
  private readonly bossHpFill: HTMLElement;
  private readonly rockyHpFill: HTMLElement;
  private readonly attackBtn: HTMLButtonElement;
  private readonly counterBtn: HTMLButtonElement;
  private readonly timerEl: HTMLElement;
  private readonly warningEl: HTMLElement;

  private onAttack: (() => void) | null = null;
  private onCounter: (() => void) | null = null;

  /** Throws if any battle element is missing — the overlay must exist first. */
  constructor() {
    this.root = requireElement('battle-ui');
    this.bossHpFill = requireElement('boss-hp-fill');
    this.rockyHpFill = requireElement('rocky-hp-fill');
    this.attackBtn = requireElement<HTMLButtonElement>('attack-btn');
    this.counterBtn = requireElement<HTMLButtonElement>('counter-btn');
    this.timerEl = requireElement('battle-timer');
    this.warningEl = requireElement('battle-warning');

    const bindPress = (btn: HTMLButtonElement, fire: () => void) => {
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        fire();
      });
    };
    bindPress(this.attackBtn, () => this.onAttack?.());
    bindPress(this.counterBtn, () => this.onCounter?.());
  }

  // -------------------------------------------------------------------------
  // Outgoing events
  // -------------------------------------------------------------------------

  /** Called when ATTACK is pressed. */
  setOnAttack(cb: () => void): void {
    this.onAttack = cb;
  }

  /** Called when COUNTER! is pressed. */
  setOnCounter(cb: () => void): void {
    this.onCounter = cb;
  }

  // -------------------------------------------------------------------------
  // Visibility
  // -------------------------------------------------------------------------

  show(): void {
    this.root.style.display = 'block';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  // -------------------------------------------------------------------------
  // HP
  // -------------------------------------------------------------------------

  /**
   * Sets both bars, coloured by remaining health:
   * green above 50, orange/yellow from 25-50, red below 25.
   */
  updateHP(bossHP: number, rockyHP: number): void {
    this.setBar(this.bossHpFill, bossHP);
    this.setBar(this.rockyHpFill, rockyHP);
  }

  private setBar(fill: HTMLElement, hp: number): void {
    const clamped = Math.max(0, Math.min(100, hp));
    fill.style.width = `${clamped}%`;

    // Sets the custom property only — `index.html` bakes it into the segmented
    // pixel gradient, so writing style.background here would flatten the gauge.
    const color =
      clamped > 50 ? HP_COLOR_HIGH : clamped >= 25 ? HP_COLOR_MID : HP_COLOR_LOW;
    fill.style.setProperty('--hp-color', color);
  }

  // -------------------------------------------------------------------------
  // Buttons
  // -------------------------------------------------------------------------

  /** Player's turn: ATTACK available, COUNTER! put away. */
  showAttackButton(): void {
    this.attackBtn.style.display = 'block';
    this.counterBtn.style.display = 'none';
  }

  /** Boss's wind-up is over: the counter window is open, warning cleared. */
  showCounterButton(): void {
    this.counterBtn.style.display = 'block';
    this.attackBtn.style.display = 'none';
    this.hideWarning();
  }

  /** Puts both action buttons away while a counter sequence plays out. */
  hideActions(): void {
    this.attackBtn.style.display = 'none';
    this.counterBtn.style.display = 'none';
  }

  // -------------------------------------------------------------------------
  // Warning banner
  // -------------------------------------------------------------------------

  showWarning(text: string = WARNING_TEXT): void {
    this.warningEl.textContent = text;
    this.warningEl.style.display = 'block';
  }

  hideWarning(): void {
    this.warningEl.style.display = 'none';
  }

  // -------------------------------------------------------------------------
  // Timer
  // -------------------------------------------------------------------------

  /** Shows the countdown; it pulses once `seconds` is 10 or fewer. */
  updateTimer(seconds: number): void {
    const whole = Math.max(0, Math.ceil(seconds));
    this.timerEl.textContent = String(whole);
    this.timerEl.style.display = 'block';
    // Reuses the `warningPulse` keyframes already defined in index.html.
    this.timerEl.style.animation =
      whole <= TIMER_WARNING_SECONDS ? 'warningPulse .5s ease-in-out infinite' : '';
  }

  hideTimer(): void {
    this.timerEl.style.display = 'none';
  }

  // -------------------------------------------------------------------------
  // Outcomes
  // -------------------------------------------------------------------------

  /** Hides every battle widget and shows a big centred "YOU WIN!". */
  showVictory(): void {
    this.showOutcome('YOU WIN!', '#ffd400');
  }

  /** Hides every battle widget and shows a big centred "GAME OVER". */
  showDefeat(): void {
    this.showOutcome('GAME OVER', '#ff4444');
  }

  private showOutcome(text: string, color: string): void {
    // The HP cards stay put so the final health is still visible; the
    // interactive widgets and the countdown go away.
    this.attackBtn.style.display = 'none';
    this.counterBtn.style.display = 'none';
    this.hideTimer();
    this.hideWarning();

    const el = this.getOutcomeElement();
    el.textContent = text;
    el.style.color = color;
    el.style.display = 'block';
  }

  /** Creates the outcome div on first use, reuses it afterwards. */
  private getOutcomeElement(): HTMLElement {
    const existing = document.getElementById(OUTCOME_ID);
    if (existing) return existing;

    const el = document.createElement('div');
    el.id = OUTCOME_ID;
    el.style.cssText = OUTCOME_STYLE;
    this.root.appendChild(el);
    return el;
  }

  // -------------------------------------------------------------------------
  // Reset
  // -------------------------------------------------------------------------

  /** Back to a clean pre-battle overlay: full bars, ATTACK ready, no chrome. */
  reset(): void {
    this.updateHP(100, 100);
    this.showAttackButton();
    this.hideTimer();
    this.hideWarning();
    document.getElementById(OUTCOME_ID)?.remove();
  }
}
