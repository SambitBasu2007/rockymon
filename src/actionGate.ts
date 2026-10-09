/**
 * Action gates — the pluggable hook between "the player pressed ATTACK" and
 * "the attack actually fires".
 *
 * Today the battle layer uses `InstantGate`: the press resolves immediately.
 * A future puzzle module only has to implement `ActionGate`; it is injected
 * into a `GateRouter` at runtime and the battle flow needs no changes at all.
 *
 * Nothing here implements a puzzle — this file is interface + default + router.
 */

export interface ActionGate {
  /**
   * Called when the player presses ATTACK or COUNTER.
   * Resolves to:
   *   'proceed' — the action executes immediately.
   *   'cancel'  — the action is aborted (e.g. the player failed a puzzle).
   * When a gate needs player input (future puzzle), it should show its own UI,
   * and only resolve after the player completes or fails it.
   */
  requestAction(): Promise<'proceed' | 'cancel'>;
}

/**
 * The default gate: the press resolves on the spot, so a button press fires the
 * action immediately. This is what ships today — no puzzle, no delay.
 */
export class InstantGate implements ActionGate {
  requestAction(): Promise<'proceed' | 'cancel'> {
    return Promise.resolve('proceed');
  }
}

/**
 * Chains several gates into one. Every gate must return `'proceed'` for the
 * action to fire; the first `'cancel'` short-circuits the rest.
 *
 * An empty router resolves `'proceed'` for every press, which makes it
 * equivalent to `InstantGate` — the intended starting state.
 */
export class GateRouter implements ActionGate {
  private gates: ActionGate[];

  constructor(gates: ActionGate[] = []) {
    this.gates = [...gates];
  }

  async requestAction(): Promise<'proceed' | 'cancel'> {
    for (const gate of this.gates) {
      const result = await gate.requestAction();
      if (result === 'cancel') return 'cancel';
    }
    return 'proceed';
  }

  /**
   * Appends a gate at runtime — this is how a future puzzle module plugs in
   * (`gateRouter.addGate(new PuzzleGate(...))`), with no battle-flow edits.
   * Gates run in insertion order.
   */
  addGate(gate: ActionGate): void {
    this.gates.push(gate);
  }
}
