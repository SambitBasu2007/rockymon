import * as THREE from 'three';
import { Level } from './level';
import { Player, type MoveInput } from './player';
import { GameInput } from './input';
import { SpriteCharacter, type Direction } from './sprite';
import { Boss } from './boss';
import { BattleCoordinator } from './battleCoordinator';
import {
  BATTLE_CAMERA_FOV,
  BATTLE_CAMERA_PITCH_DEG,
  BATTLE_CAMERA_POSITION,
  BATTLE_CAMERA_YAW_DEG,
} from './battle';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Room618 is the only playable world.
const modelUrls = import.meta.glob('/assets/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const roomUrl = modelUrls['/assets/room618.glb'];

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x20242a);
const OVERWORLD_FOV = 75;
const camera = new THREE.PerspectiveCamera(OVERWORLD_FOV, window.innerWidth / window.innerHeight, 0.05, 500);
scene.add(new THREE.HemisphereLight(0xffffff, 0x555566, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(4, 8, 5);
scene.add(sun);

const level = new Level();
scene.add(level.root);
const player = new Player();
const input = new GameInput();
// Mobile D-Pad (bottom-left). Buttons only report while held; keyboard still wins.
input.bindDpad({
  up: $<HTMLButtonElement>('dpad-up'),
  down: $<HTMLButtonElement>('dpad-down'),
  left: $<HTMLButtonElement>('dpad-left'),
  right: $<HTMLButtonElement>('dpad-right'),
});
let rockySprite: SpriteCharacter | null = null;
let boss: Boss | null = null;
let battleCoordinator: BattleCoordinator | null = null;

// Boss stands idle in a corner of the room. Y is the floor height at that spot,
// so the vector is used directly as the feet position.
const bossSpawn = new THREE.Vector3(-4.649, -0.531, -29.386);

// ---------- menu ----------
const overlay = $('overlay'), msg = $('msg'), playBtn = $<HTMLButtonElement>('play');

const fullscreenButton = $<HTMLButtonElement>('fullscreenBtn');
const fullscreenIcon = fullscreenButton.querySelector('path');
function updateFullscreenButton() {
  const fullscreen = document.fullscreenElement !== null;
  fullscreenButton.setAttribute('aria-label', fullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
  fullscreenButton.title = fullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
  fullscreenIcon?.setAttribute('d', fullscreen
    ? 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5'
    : 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5');
}
fullscreenButton.onclick = () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => {});
};
document.addEventListener('fullscreenchange', updateFullscreenButton);
updateFullscreenButton();

playBtn.onclick = () => input.start();
input.onPlayChange = (playing) => { overlay.style.display = playing ? 'none' : 'grid'; };

let ready = false;

// Reused per-frame temporaries so the hot loop allocates nothing.
const followOffset = new THREE.Vector3();
const camForward = new THREE.Vector3();

/**
 * Map a movement snapshot to the sprite's screen-relative facing direction.
 * W/forward = 'up', S/back = 'down', A = 'left', D = 'right'.
 * Diagonals pick the dominant axis (ties favour the vertical/forward axis).
 * Returns null when the player is standing still.
 */
function directionFromInput(input: MoveInput): Direction | null {
  const ax = Math.abs(input.moveX);
  const az = Math.abs(input.moveZ);
  if (ax === 0 && az === 0) return null;
  if (az >= ax) return input.moveZ > 0 ? 'up' : 'down';
  return input.moveX < 0 ? 'left' : 'right';
}

/** Position the camera at a fixed 2.5D angled-overhead view, framed on Rocky.
 *  Called after the level loads and again on respawn via placePlayer().
 *  The camera's angle never changes; followCamera() only translates the rig so
 *  Rocky stays centred as he moves. */
function setupCamera() {
  // Focus point is the Rocky character sprite, so Rocky is the center of the zoom
  const focus = new THREE.Vector3();
  if (rockySprite) {
    focus.copy(rockySprite.pos);
  } else {
    focus.copy(level.spawn);
  }
  focus.y = 0; // look at floor level

  // Position camera at a 3 o'clock perspective (along +X axis looking towards -X).
  // 15% more zoomed in (1.25 * 1.15 = 1.4375x total zoom), preserving the downward viewing angle.
  const zoomFactor = 1.25 * 1.15; // 1.4375x zoom (+15% more zoomed in)
  const dist = Math.max(30, (level.size * 0.55) / zoomFactor);
  camera.position.set(focus.x + dist * 0.85, dist, focus.z);
  camera.lookAt(focus);
  camera.far = Math.max(500, level.size * 3);
  camera.updateProjectionMatrix();

  // Remember the fixed offset from the focus point so followCamera() can
  // translate the rig without ever changing its angle.
  followOffset.set(camera.position.x - focus.x, camera.position.y, camera.position.z - focus.z);

  // Lock movement input to the camera's fixed yaw so W/S/A/D always map to
  // screen up/down/left/right (world-aligned, fixed camera).
  camera.getWorldDirection(camForward);
  player.fixedYaw = Math.atan2(-camForward.x, -camForward.z);
}

/** Translate the fixed-angle camera rig so Rocky stays centred. Runs every
 *  frame; only the position changes, never the rotation. */
function followCamera() {
  camera.position.set(
    player.pos.x + followOffset.x,
    followOffset.y,
    player.pos.z + followOffset.z,
  );
}

/**
 * Pokémon-style framing: a literal position plus a literal yaw/pitch look
 * angle, so the shot can be tuned by editing numbers in `battle.ts` rather
 * than chasing a moving look-at target.
 */
function switchToBattleCamera() {
  playBattleFlash();
  document.body.classList.add('battle-active');
  camera.fov = BATTLE_CAMERA_FOV;
  camera.position.copy(BATTLE_CAMERA_POSITION);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(
    THREE.MathUtils.degToRad(BATTLE_CAMERA_PITCH_DEG),
    THREE.MathUtils.degToRad(BATTLE_CAMERA_YAW_DEG),
    0,
  );
  camera.updateProjectionMatrix();
}

function switchToNormalCamera() {
  playBattleFlash();
  document.body.classList.remove('battle-active');
  camera.fov = OVERWORLD_FOV;
  setupCamera();
}

/** White-screen wipe covering the camera cut in and out of battle. */
function playBattleFlash() {
  const el = $('battle-transition');
  el.classList.remove('active');
  void el.offsetWidth;
  el.classList.add('active');
  window.setTimeout(() => el.classList.remove('active'), 700);
}

function placePlayer() {
  player.collider = level.collider;
  player.killY = level.killY;
  player.teleport(level.spawn);
  if (rockySprite) {
    rockySprite.setPosition(level.spawn);
  }
  setupCamera();
}

async function loadRoom() {
  ready = false; playBtn.disabled = true; msg.textContent = 'Loading…';
  try {
    if (!roomUrl) throw new Error('room618.glb is missing from the assets directory.');
    await level.load(roomUrl);
    placePlayer();
    rockySprite = new SpriteCharacter(scene, '/assets/rocky/');
    await rockySprite.load();
    rockySprite.setScale(10, 10);
    rockySprite.setPosition(level.spawn);

    boss = new Boss(scene);
    await boss.load();
    boss.setScale(15, 15); // 1.5x Rocky's 10-unit height
    boss.setPosition(bossSpawn);
    // The default 3 units is smaller than Rocky himself (10 units tall) in this
    // room, so widen the trigger to roughly the boss's half-width: close enough
    // to look like contact without needing pixel-perfect positioning.
    boss.interactionRadius = 12;
    // Battle: the coordinator stages the fighters, shows the overlay and runs
    // the whole turn loop (see battleCoordinator.ts).
    battleCoordinator = new BattleCoordinator(scene, rockySprite, boss);
    battleCoordinator.setOnBattleStart(() => switchToBattleCamera());
    battleCoordinator.setOnBattleEnd(() => switchToNormalCamera());
    boss.onPlayerTouch = () => {
      if (!battleCoordinator || battleCoordinator.isBattleActive()) return;
      if (!boss?.getObject().parent) return; // already defeated and removed
      battleCoordinator.startBattle();
    };

    setupCamera();
    msg.textContent = level.notice;
  } catch (e) {
    msg.textContent = `Could not load room618.glb: ${String(e)}`;
    return;
  }
  ready = true; playBtn.disabled = false;
}

window.addEventListener('keydown', (e) => {
  if (!input.playing || !ready) return;
  if (e.code === 'KeyR') placePlayer();
  if (e.code === 'Escape') input.pause(); // back to the menu
});

void loadRoom();

// FUTURE: guide arrow, puzzle checks, curtain animation etc. register here and run every frame.
const systems: Array<(dt: number) => void> = [];

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (ready && input.playing) { // paused while the menu is open
    const moveInput = input.read(); // read the input snapshot exactly once per frame

    if (battleCoordinator?.isBattleActive()) {
      // The battle owns the frame: physics, the sprite sync, the walk cycle and
      // the boss trigger are all frozen until the fight ends.
      battleCoordinator.update(dt);
    } else {
      player.update(dt, moveInput);

      if (rockySprite) {
        // Sync the billboard to the physics body, then play the matching animation.
        // The sync is skipped during a battle, so the staging survives (above).
        rockySprite.setPosition(player.pos);
        const direction = directionFromInput(moveInput);
        if (direction) {
          rockySprite.setDirection(direction);
          rockySprite.setWalking(true);
        } else {
          rockySprite.setWalking(false);
        }
        rockySprite.update(dt); // advance the walk cycle timer
      }

      // Proximity detection: touching the boss starts the battle (once per approach).
      // checkProximity() can synchronously trigger startBattle(), which cuts the
      // camera to BATTLE_CAMERA_POSITION. Re-check the flag before following:
      // an unconditional followCamera() would overwrite that cut on this same
      // frame, leaving the overworld position with the battle rotation.
      boss?.checkProximity(player.pos);
      if (!battleCoordinator?.isBattleActive()) {
        followCamera();
      }
    }
  }
  for (const s of systems) s(dt);
  renderer.render(scene, camera);
});
