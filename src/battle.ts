import * as THREE from 'three';

/**
 * Battle layout contract — the battle marks (where the fighters stand) and the
 * camera framing, both consumed by `switchToBattleCamera()` in `main.ts`.
 * Staging, overlay, animations and the turn loop live in `BattleCoordinator`.
 *
 * Where each fighter stands while a battle is on screen.
 * Y is the floor height at that spot, so these are feet positions.
 */
export const BATTLE_POSITIONS = {
  rocky: new THREE.Vector3(-4.328, -0.531, 21.705),
  boss: new THREE.Vector3(-4.649, -0.531, -29.386),
} as const;

/**
 * Pokémon-style battle camera, typed in as a literal position plus a literal
 * look angle (no look-at target to fiddle with).
 *
 * Position sits behind Rocky and off to his right (+X), high enough (Y = 13,
 * well above the 21-unit ceiling line's midpoint) to read a 3/4 rear shot
 * rather than a flat side-on view. It is a raised version of the behind-Rocky
 * reference point (9.9, -0.531, 30.917).
 *
 * The angles are a Y-then-X Euler rotation (order 'YXZ', degrees):
 *   YAW   swings the lens left toward the boss, which is what separates the
 *         two fighters horizontally — Rocky lands lower-left, boss upper-right.
 *   PITCH tilts the lens down; because the camera sits between the two sprite
 *         centres (Rocky's is lower than the boss's), a shallow downward tilt
 *         is what stacks them vertically.
 * Both fighters stay fully in frame at 16:9 and 4:3.
 */
export const BATTLE_CAMERA_POSITION = new THREE.Vector3(10, 11, 40);

/** Camera yaw, in degrees. Positive swings the lens toward -X (the boss's side). */
export const BATTLE_CAMERA_YAW_DEG = 23;

/** Camera pitch, in degrees. Negative tilts the lens downward. */
export const BATTLE_CAMERA_PITCH_DEG = -10;

/** Tighter than the overworld 75° FOV so both fighters fill the frame. */
export const BATTLE_CAMERA_FOV = 40;
