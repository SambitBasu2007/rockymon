# Petrova Crisis

A browser-based **2.5D fixed-camera room explorer / game prototype** built with
[Three.js](https://threejs.org/) and TypeScript, bundled by
[Vite](https://vitejs.dev/).  
The player character — a billboarded 2D sprite named **Rocky** — walks, runs, and jumps inside a
single hand-crafted room (`room618.glb`), colliding with every triangle of the world via a BVH
(Bounding Volume Hierarchy) tree, and meets a boss lurking in the corner. Tagline: *"solve code to
defeat the boss"*.
Works on both desktop (keyboard) and mobile (D-Pad + touch buttons).

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Repository Layout](#repository-layout)
3. [How It Works — High Level](#how-it-works--high-level)
4. [2.5D Architecture](#25d-architecture)
5. [Controls](#controls)
6. [Battle System](#battle-system)
7. [Source Files (src/)](#source-files-src)
   - [main.ts](#maints)
   - [level.ts](#levelts)
   - [player.ts](#playerts)
   - [input.ts](#inputts)
   - [sprite.ts](#spritets)
   - [boss.ts](#bossts)
   - [battle.ts](#battlets)
   - [actionGate.ts](#actiongatets)
   - [battleState.ts](#battlestatets)
   - [battleAnimations.ts](#battleanimationsts)
   - [battleUI.ts](#battleuits)
   - [battleCoordinator.ts](#battlecoordinatorts)
   - [audio.ts](#audiots)
8. [HTML Entry Point (index.html)](#html-entry-point-indexhtml)
9. [Assets](#assets)
10. [Build Configuration](#build-configuration)
11. [TypeScript Configuration](#typescript-configuration)
12. [Dependencies](#dependencies)
13. [Development Setup](#development-setup)
14. [GLB Model Conventions](#glb-model-conventions)
15. [Known Architecture Notes & Future Work](#known-architecture-notes--future-work)

---

## Project Overview

| Property | Value |
|---|---|
| Package name | `petrova-crisis` |
| Version | `1.0.0` |
| Module type | ES Modules (`"type": "module"`) |
| Language | TypeScript 5.6, target ES2022 |
| Bundler | Vite 5.4 |
| 3D engine | Three.js r170 |
| Collision | three-mesh-bvh 0.9.15 |
| World | `assets/room618.glb` (~14.4 MB) |

The title shown in the browser tab and the start menu is **Petrova Crisis**.  
The tagline is *"solve code to defeat the boss"* — the puzzle / boss logic is
planned but not yet implemented (see [Future Work](#known-architecture-notes--future-work)).

---

## Repository Layout

```
petrova-crisis/
├── index.html            ← Single HTML page; all UI & inline CSS live here
├── package.json          ← npm metadata, scripts, dependencies
├── tsconfig.json         ← TypeScript compiler options
├── vite.config.ts        ← Vite build config (base path only)
├── README.md             ← This file
│
├── src/                  ← All TypeScript source
│   ├── main.ts           ← Entry point: renderer, scene, game loop, UI wiring
│   ├── level.ts          ← GLB loading, BVH collision build, spawn detection
│   ├── player.ts         ← Capsule physics, gravity, jump, wall sliding
│   ├── input.ts          ← Keyboard + mobile D-Pad + touch buttons (GameInput)
│   ├── sprite.ts         ← 2D billboarded sprite character with 4-way animations
│   ├── boss.ts           ← Boss billboard sprite with idle / battle poses
│   ├── battle.ts         ← Battle marks + battle-camera framing constants
│   ├── actionGate.ts     ← Pluggable action gates (ActionGate/InstantGate/GateRouter)
│   ├── battleState.ts    ← Battle turn loop: BattlePhase/BattleState/BattleStateMachine
│   ├── battleAnimations.ts ← Jump-thrust attack tween + star particles
│   ├── battleUI.ts       ← Battle DOM controller (HP bars, buttons, timer, outcomes)
│   ├── battleCoordinator.ts ← Orchestrator: state machine + UI + animations + gate + audio
│   └── audio.ts          ← Stub AudioManager + SoundEffect enum (no files ship yet)
│
├── assets/
│   ├── room618.glb       ← The only playable room (14.4 MB binary GLTF)
│   ├── rocky/            ← Sprite sheets for a character named "Rocky"
│       ├── down/         ← 1 idle + 3 walk frames facing down
│       ├── up/           ← 1 idle + 3 walk frames facing up
│       ├── left/         ← 1 idle + 3 walk frames facing left
│       └── right/        ← 1 idle + 3 walk frames facing right
│   └── boss/             ← Placeholder boss sprites (idle + battle)
│
└── dist/                 ← Vite production build output (generated, not committed)
    ├── index.html
    └── assets/           ← Hashed JS/CSS/GLB chunks
```

---

## How It Works — High Level

```
index.html
  └─ <script type="module" src="./src/main.ts">
        │
        ├── Creates THREE.WebGLRenderer → appended to <body>
        ├── Creates THREE.Scene + lights (hemisphere + directional)
        ├── Creates THREE.PerspectiveCamera (FOV 75°, near 0.05, far 500)
        │
        ├── Level.load(room618.glb)
        │     └── GLTFLoader → buildCollider() → MeshBVH
        │
        ├── Player (capsule physics, owns pos/vel)
        ├── GameInput (keyboard, mobile D-Pad, touch buttons)
        ├── SpriteCharacter "Rocky" (2D billboard, 4-way idle/walk animations)
        ├── Boss (idle/battle billboard, parked in a corner of the room)
        ├── BattleCoordinator (battle staging, UI, turn loop, animations)
        │
        └── renderer.setAnimationLoop()
              ├── input.read()                → ONE MoveInput snapshot per frame
              ├── player.update(dt, moveInput) → physics + BVH collision (rotated by Player.fixedYaw)
              ├── rockySprite.setPosition(player.pos)  (skipped while a battle is staged)
              ├── directionFromInput(moveInput) → 'up' | 'down' | 'left' | 'right' | null
              ├── rockySprite.setDirection / setWalking / update(dt) → animation
              ├── boss.checkProximity(player.pos) → fires onPlayerTouch once per approach
              ├── followCamera()               → overworld only; skipped while a battle is active
              └── renderer.render(scene, camera)
```

The camera is **fixed in angle** in a 2.5D angled overhead perspective (classic RPG / Pokemon-style).
Zoom, position and orientation are computed by `setupCamera()` when the level loads (and again on
respawn); from then on the camera **never rotates** and `followCamera()` only translates it so Rocky
stays at the centre of the frame. Movement is world-aligned via `Player.fixedYaw`, so `W` always
moves Rocky "up the screen" (world −X with the current camera) — see [2.5D Architecture](#25d-architecture).

---

## 2.5D Architecture

The game is a 2.5D room explorer: a 3D world, flat sprites, one fixed viewpoint.

- **Camera** — a single `THREE.PerspectiveCamera` at a fixed angled-overhead perspective
  (a "3 o'clock" view from the +X axis). Its **angle never changes**: there is no mouse
  look, no rotation and no zoom during play. `setupCamera()` computes the view once per
  respawn; each frame `followCamera()` only *translates* the rig so Rocky stays centred.
- **Player character** — Rocky is a 2D billboarded sprite (`THREE.Sprite`, always facing
  the camera) with 4-directional idle/walk animations driven by the movement input (see
  [Sprite direction mapping](#sprite-direction-mapping)). The physics body underneath is a
  capsule that collides with the room's real triangles via a BVH.
- **World-axis movement** — input axes are rotated once by `Player.fixedYaw` (derived from
  the fixed camera yaw in `setupCamera()`), so the controls stay screen-relative while the
  physics stays world-aligned. With the current camera (looking along −X): `W` → −X (up the
  screen), `S` → +X (down), `A` → +Z (screen left), `D` → −Z (screen right).
- **Boss** — a separate billboard sprite with idle and battle poses (`Boss.setBattleMode()`),
  parked in a corner of the room. It has no AI; it only reacts to `checkProximity()`.
- **Battle camera** — when a fight starts, `switchToBattleCamera()` in `main.ts`
  parks the lens behind Rocky, off to his right (+X) and above head height
  (`BATTLE_CAMERA_POSITION` plus the `BATTLE_CAMERA_YAW_DEG` /
  `BATTLE_CAMERA_PITCH_DEG` look angle in `battle.ts`), yawed left toward the
  boss so Rocky fills the lower-left and the boss sits in the upper-right.
  `followCamera()` is skipped until `switchToNormalCamera()` restores the
  overworld rig. A white flash (`#battle-transition`) covers the cut.
- **Battle positions** — predefined constants (`BATTLE_POSITIONS` in `battle.ts`).
  When a battle starts, `BattleCoordinator` stages the two sprites on those marks
  and runs the fight (overlay, animations, turn loop) — see
  [`battleCoordinator.ts`](#battlecoordinatorts).

---

## Controls

### Desktop (Keyboard)

| Input | Action |
|---|---|
| `W` / `Arrow Up` | Move up the screen (world −X) |
| `S` / `Arrow Down` | Move down the screen (world +X) |
| `A` / `Arrow Left` | Move left on screen (world +Z) |
| `D` / `Arrow Right` | Move right on screen (world −Z) |
| `Space` | Jump |
| `Shift` (left or right) | Run (higher speed) |
| `E` | Use / interact (wired up, no effect yet) |
| `R` | Respawn at the current spawn point |
| `Esc` | Pause → opens the menu |
| Click **Play** | Starts / resumes the game |

> Arrow keys have `e.preventDefault()` called to stop the page from scrolling.

#### Sprite direction mapping

Rocky's billboard animation is picked from the raw movement axes (screen-relative):

| Input | Sprite animation |
|---|---|
| `W` / `Arrow Up` (or D-Pad ▲) | **up** |
| `S` / `Arrow Down` (or D-Pad ▼) | **down** |
| `A` / `Arrow Left` (or D-Pad ◀) | **left** |
| `D` / `Arrow Right` (or D-Pad ▶) | **right** |
| Diagonal input | the dominant axis wins; ties favour the vertical (up/down) axis |
| No movement | idle frame of the last direction (`setWalking(false)`) |

The direction is decided by `directionFromInput()` from the unrotated input snapshot, so it is
always screen-relative: forward = the sprite's `up` animation, backward = `down`, etc.

### Mobile (Touch)

| Control | Location | Action |
|---|---|---|
| D-Pad (▲ ▼ ◀ ▶) | Bottom-left cross | Hold a direction to move |
| **Jump** button (⤓) | Bottom-right | Jump |
| Fullscreen button | Top-right corner | Toggle browser fullscreen |

- The D-Pad and touch buttons are always wired, but CSS hides them on desktop — no JS mode switch.
- The D-Pad and jump button are **hidden on desktop** (`@media (min-width: 768px) and (pointer: fine)`).
- There is no use/interact touch button — `#useBtn` was removed (the `E` key is the only way to `use`).
- Keyboard input takes priority over the D-Pad when both are active simultaneously.
- Buttons only register while held; sliding a finger off a D-Pad button releases it.
- During a battle the D-Pad and jump button are hidden (`body.battle-active`) and
  `#battle-ui` (`z-index: 200`) sits above them (`z-index: 100`) with
  `pointer-events: auto` and `touch-action: none`, so overworld controls cannot fire.

### Battle (overlay)

| Control | Location | Action |
|---|---|---|
| **ATTACK** | Bottom-centre | Rocky's turn — fires immediately through `InstantGate` |
| **COUNTER!** | Bottom-centre (after the warning) | Interrupts the boss during the 45 s window |
| Boss HP card | Top-left | Opponent health |
| Rocky HP card | Bottom-right | Player health |
| Timer | Screen centre | Counter window countdown |

On viewports `max-width: 767px` the cards shrink, the timer is **42 px**, and
action buttons keep a **44 px** minimum touch target (`touch-action: manipulation`).
Every battle button handler calls `preventDefault()`.

---

## Battle System

Walking into the boss starts a fight. The overworld freezes, a white flash covers
the camera cut, Rocky and the boss snap to their battle marks, and the overlay
takes over.

```
overworld walk
    │  touch boss (interactionRadius)
    ▼
flash transition ──▶ battle camera (behind Rocky, boss upper-right)
    │
    ▼
PLAYER_TURN ── ATTACK ──▶ jump / thrust / stars ──▶ boss −25 HP
    │
    ▼
BOSS_TURN ── warning (2 s) ──▶ COUNTER! + 45 s timer
    │
    ├── COUNTER! in time ──▶ Rocky hits again (−25 HP) ──▶ PLAYER_TURN
    └── timer expires     ──▶ boss hits Rocky (−45 HP) ──▶ PLAYER_TURN
                              (hidden +25 damage boost on Rocky's next hit)
    │
    ▼
boss HP 0 → VICTORY (3 s) ──▶ flash ──▶ overworld, boss gone
Rocky HP 0 → DEFEAT  (3 s) ──▶ flash ──▶ overworld, both restored
```

### Damage, timer, boost

| Event | Amount |
|---|---|
| Rocky attack / successful counter | **25** boss HP |
| Rocky attack after being hit (boost) | **50** boss HP (25 base + 25 hidden boost) |
| Boss attack (missed counter / timeout) | **45** Rocky HP |
| Counter window | **45 s**, warning cue at **10 s** |
| Warning lead-in before COUNTER! | **2 s** |
| Victory / defeat screen | **3 s** |

A clean four-hit run wins without taking damage. Missing the counter and then
attacking spends the boost (50 damage). Two missed counters will defeat Rocky.

### Gate architecture

Every ATTACK / COUNTER! press awaits `gateRouter.requestAction()` before anything
moves. Today the router holds one `InstantGate`, so the press fires immediately.
A future puzzle module only implements `ActionGate` and is injected at runtime —
the state machine, UI, animations and coordinator stay unchanged:

```ts
class PuzzleGate implements ActionGate {
  async requestAction(): Promise<'proceed' | 'cancel'> {
    // show puzzle UI, await the player's result, return the outcome
  }
}

gateRouter.addGate(new PuzzleGate());
```

`'proceed'` runs the action. `'cancel'` on ATTACK leaves the turn with the
player; `'cancel'` on COUNTER! is treated as a missed counter (the boss hits).

---

## Source Files (`src/`)

---

### `main.ts`

**Entry point.** Bootstraps the entire application.

#### Top-level constants & objects

| Name | Type | Purpose |
|---|---|---|
| `$` | generic helper `(id) => HTMLElement` | Shorthand for `document.getElementById` with a type cast |
| `modelUrls` | `Record<string, string>` | Result of `import.meta.glob('/assets/*.glb', …)` — eagerly collects all `.glb` URLs in `assets/` at build time |
| `roomUrl` | `string` | URL of `/assets/room618.glb`, extracted from `modelUrls` |
| `renderer` | `THREE.WebGLRenderer` | Antialias enabled, pixel ratio capped at 2, fills the viewport |
| `scene` | `THREE.Scene` | Background colour `#20242a` |
| `camera` | `THREE.PerspectiveCamera` | FOV 75°, near 0.05, far 500 (far is updated after level load) |
| `level` | `Level` | Owns the GLB scene graph and BVH collider |
| `player` | `Player` | Owns position, velocity, capsule physics |
| `input` | `GameInput` | Owns keyboard state, D-Pad + touch-button state, and the `playing` flag |
| `rockySprite` | `SpriteCharacter \| null` | 2D billboarded sprite instance for the player character |
| `boss` | `Boss \| null` | Boss billboard sprite, parked in a corner of the room |
| `battleCoordinator` | `BattleCoordinator \| null` | Owns the whole battle, created once both sprites exist |
| `bossSpawn` | `THREE.Vector3` | `(-4.649, -0.531, -29.386)` — where the boss idles |
| `systems` | `Array<(dt: number) => void>` | Empty plug-in array for future per-frame subsystems |
| `clock` | `THREE.Clock` | Measures frame delta time |
| `followOffset` | `THREE.Vector3` | Reused per-frame temporary: fixed focus→camera offset applied by `followCamera()` |
| `camForward` | `THREE.Vector3` | Reused per-frame temporary: camera view direction used to derive `player.fixedYaw` |

#### Lights

- **`THREE.HemisphereLight`** — sky colour `0xffffff`, ground colour `0x555566`, intensity `1.6`.
- **`THREE.DirectionalLight`** (`sun`) — colour `0xffffff`, intensity `1.5`, position `(4, 8, 5)`.

#### Functions

##### `updateFullscreenButton()`
Updates the `aria-label`, `title`, and SVG `d` attribute of the fullscreen
button to reflect the current fullscreen state.
- Checks `document.fullscreenElement !== null`.
- Expand icon path: `M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5`
- Collapse icon path: `M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5`
- Called once at startup and again on every `fullscreenchange` event.

##### `directionFromInput(input: MoveInput): Direction | null`
Maps one movement snapshot to the sprite's screen-relative facing direction (see
[Sprite direction mapping](#sprite-direction-mapping)). It reads the raw input axes, so it is
independent of the camera's world orientation:
- `ax = |moveX|`, `az = |moveZ|`; both zero → returns `null` (standing still).
- `az >= ax` → `moveZ > 0 ? 'up' : 'down'` (ties favour the vertical/forward axis).
- otherwise → `moveX < 0 ? 'left' : 'right'`.

##### `setupCamera()` *(new — 2.5D mode)*
Positions the camera once at a fixed angled-overhead (2.5D) view centered on the Rocky sprite. Called by `placePlayer()`
and `loadRoom()`:
1. Derives the focal point directly from the Rocky sprite position (`rockySprite.pos` or `level.spawn` at floor level).
2. Computes `dist = max(30, (level.size × 0.55) / (1.25 × 1.15))` — applying an additional 15% zoom-in (total 1.4375× magnification).
3. Sets `camera.position` to `(focus.x + dist × 0.85, dist, focus.z)` — 3 o'clock perspective
   (positioned along the +X axis looking across the room towards the left/-X at roughly 35–45° downward angle).
4. Calls `camera.lookAt(focus)` to aim directly at Rocky, keeping the character at the center of the zoom.
5. Sets `camera.far = max(500, level.size × 3)` and calls `camera.updateProjectionMatrix()`.
6. Stores the fixed focus→camera offset in `followOffset`, so `followCamera()` can translate the rig
   through the world without ever changing its angle.
7. Reads `camera.getWorldDirection(camForward)` and sets `player.fixedYaw = atan2(-fwd.x, -fwd.z)` —
   locking movement input to the camera's yaw so `W`/`S`/`A`/`D` always map to screen up/down/left/right.

> The first-person per-frame camera rotation (`camera.position.set(player.pos…)` /
> `camera.rotation.set(input.pitch, input.yaw, …)`) has been **removed** and replaced
> by this single setup call plus the translation-only `followCamera()`.

##### `followCamera()`
Runs every frame inside the game loop, **after** the player and sprite have been updated:
- Sets `camera.position` to `(player.pos.x + followOffset.x, followOffset.y, player.pos.z + followOffset.z)`.
- Never touches `camera.rotation` / `lookAt`, so the view angle stays fixed, movement stays
  world-aligned and the animation mapping stays screen-relative.
- Writes into the preallocated `followOffset` / `camForward` vectors — the hot loop allocates nothing.

##### `loadRoom()` *(async)*
Called once at startup. Loads `room618.glb`:
1. Sets UI to loading state: disables Play button, sets message to `'Loading…'`.
2. Checks that `roomUrl` exists; throws if the GLB is missing.
3. Calls `level.load(roomUrl)`.
4. On success:
   - Calls `placePlayer()`.
   - Instantiates `rockySprite = new SpriteCharacter(scene, '/assets/rocky/')`.
   - Calls `await rockySprite.load()`.
   - Sets sprite scale to `(10, 10)` (matching player height) and sets initial position to `level.spawn`.
   - Creates the boss at `bossSpawn`, loads it, scales it `(15, 15)`, and raises
     `interactionRadius` to `12` for this room's scale.
   - Creates `battleCoordinator = new BattleCoordinator(scene, rockySprite, boss)` and wires
     its `onBattleStart` / `onBattleEnd` hooks to `switchToBattleCamera()` / `switchToNormalCamera()`.
   - Wires `boss.onPlayerTouch = () => battleCoordinator.startBattle()` — touching the boss
     starts a real fight (guarded so it can't re-fire mid-battle or after the boss is beaten).
   - Sets `msg.textContent` to `level.notice`.
   - Enables the Play button and marks `ready = true`.
5. On failure: sets the error message. Does **not** set `ready = true`.

##### Animation loop (`renderer.setAnimationLoop`)
Runs every frame:
1. `dt = Math.min(clock.getDelta(), 0.1)` — capped to 100 ms.
2. If `ready && input.playing` (the menu pauses everything below):
   1. `const moveInput = input.read()` — the input snapshot is read **exactly once** per frame and reused.
   2. If a battle is active (`battleCoordinator?.isBattleActive()`): `battleCoordinator.update(dt)`
      **and nothing else** — the overworld is frozen for the duration of the fight. The steps
      below are the `else` branch.
   3. `player.update(dt, moveInput)` — physics + BVH collision (input rotated by `player.fixedYaw`).
   4. If `rockySprite` exists:
      - `rockySprite.setPosition(player.pos)` — sync the billboard to the physics body.
      - `directionFromInput(moveInput)` — if non-null: `rockySprite.setDirection(dir)` then
        `rockySprite.setWalking(true)`; if null: `rockySprite.setWalking(false)` (idle frame).
      - `rockySprite.update(dt)` — advance the walk-cycle timer / frame index.
   5. `boss?.checkProximity(player.pos)` — proximity detection; fires `onPlayerTouch` once
      per approach, which starts the battle (see [Proximity detection](#proximity-detection)).
   6. `followCamera()` — translate the fixed-angle rig so Rocky stays centred.
3. Iterates `systems` array (currently empty).
4. Calls `renderer.render(scene, camera)`.

#### Event listeners in main.ts

| Event | Condition | Effect |
|---|---|---|
| `keydown` on `window` | `input.playing && ready && code === 'KeyR'` | Calls `placePlayer()` (respawn) |
| `keydown` on `window` | `input.playing && ready && code === 'Escape'` | Calls `input.pause()` (back to the menu) |
| `resize` on `window` | always | Updates renderer size and camera aspect ratio |
| `fullscreenchange` on `document` | always | Calls `updateFullscreenButton()` |
| `onclick` on `fullscreenBtn` | always | Toggles `document.exitFullscreen()` / `requestFullscreen()` |
| `onclick` on `playBtn` | always | Calls `input.start()` — starts or resumes the game |
| `onPlayChange` callback | set by input | Shows/hides the `#overlay` element |

---

### `level.ts`

Manages loading, collision building, and world state.

#### Free function: `disposeObject(o: THREE.Object3D)`

Recursively traverses an Object3D and disposes every geometry, texture, and
material it finds. Called whenever a previously-loaded world is replaced, to
prevent GPU memory leaks.

- Uses `o.traverse(c => …)`.
- Casts each node to `THREE.Mesh` to access `.geometry` and `.material`.
- Handles both single-material and multi-material arrays.
- Iterates `Object.values(mat)` to find any `THREE.Texture` instances and calls `.dispose()` on them.

#### Free function: `buildCollider(meshes: THREE.Mesh[])`

**Returns** `{ bvh: MeshBVH; box: THREE.Box3; tris: number } | null`

Merges all provided meshes into one flat triangle soup in world space and
builds a `MeshBVH` over it. This is the core of collision detection.

Steps:
1. Filter to meshes that have a `position` buffer attribute.
2. Counts triangles per mesh respecting indexed and non-indexed geometry.
3. Allocates a single `Float32Array` of size `totalTriangles * 3 * 3` (x,y,z per vertex, 3 vertices per tri).
4. For every mesh, reads each vertex through `v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)` — **bakes world transforms in**.
5. Creates a `THREE.BufferGeometry` from the flat array, computes its bounding box.
6. Returns `{ bvh: new MeshBVH(geo), box, tris }`.
7. Returns `null` if no usable geometry found.

#### Class: `Level`

| Field | Type | Default | Description |
|---|---|---|---|
| `root` | `THREE.Group` | new | Added to the Three.js scene; the world sits inside this |
| `collider` | `MeshBVH \| null` | `null` | The BVH tree used by Player for collision |
| `spawn` | `THREE.Vector3` | `(0,0,0)` | Player spawn position (feet) |
| `spawnYaw` | `number` | `0` | Camera yaw (radians) at spawn |
| `notice` | `string` | `''` | Status message shown in the UI after load |
| `killY` | `number` | `-100` | Y below which the player respawns |
| `size` | `number` | `100` | Diagonal length of the world bounding box; used for `camera.far` |
| `world` (private) | `THREE.Group` | new | Direct child of `root`; swapped out on each load |
| `token` (private) | `number` | `0` | Cancellation token; incremented on each `load()` call to discard stale results |

##### `constructor()`
Adds `this.world` as a child of `this.root`.

##### `async load(url: string): Promise<boolean>`
1. Increments `this.token` and snapshots it locally.
2. Loads the GLB with `new GLTFLoader().loadAsync(url)`.
3. If a newer `load()` was called while awaiting (token mismatch), disposes the stale content and returns `false`.
4. Otherwise calls `this.setWorld(content.scene)` and returns `true`.

##### `setWorld(content: THREE.Object3D)`
1. Removes and disposes all current children of `this.world`.
2. Resets `this.world.scale` to 1.
3. Adds the new content as a child.
4. Calls `this.rebuild()`.

##### `rebuild()`
Called after the world content changes (e.g., doors open, curtains move).
Rebuilds the BVH collider and detects special nodes:

1. Calls `this.world.updateMatrixWorld(true)` to bake transforms.
2. Traverses the world looking for:
   - Any object named exactly `SPAWN_POINT` → stored as `spawnNode`.
   - Any object whose name **starts with** `COL_` → all mesh descendants are collected into `cols`; the COL object is set `visible = false` (invisible collision proxy).
3. If `COL_*` meshes were found, uses only those for collision (**simplified mode**).
   Otherwise uses **all** visible meshes whose `userData.noCollide` is falsy (**automatic mode**).
4. Calls `buildCollider(meshes)`.
5. If no geometry: sets `notice`, resets spawn to `(0, 1, 0)`, returns early.
6. Sets `this.size`, `this.killY = built.box.min.y - 30`.
7. **Spawn point resolution:**
   - If `SPAWN_POINT` exists: uses `getWorldPosition()` and extracts yaw from the node's world quaternion via `Euler.setFromQuaternion(…, 'YXZ').y`.
   - If not: fires a downward ray from the center of the bounding box (`THREE.DoubleSide`) to find the floor. Falls back to the top of the bounding box if the ray misses. Adds 0.02 units to avoid Z-fighting with the floor.

---

### `player.ts`

Pure physics module — **no DOM access**. Can be tested headlessly.

#### Interface: `MoveInput`

```ts
interface MoveInput {
  moveX: number;  // -1 = left, +1 = right
  moveZ: number;  // -1 = backward, +1 = forward
  jump: boolean;
  run: boolean;
  use: boolean;   // 'E' key or use button (reserved for future interaction)
}
```

#### Class: `Player`

The player is modelled as a **vertical capsule** (two sphere endpoints connected by a line segment).
`pos` is the **feet position** (bottom of the capsule). Y is up, -Z is forward at yaw 0.

##### Static constants

| Name | Value | Purpose |
|---|---|---|
| `sizeScale` | `10 / 1.7 ≈ 5.882` | Scales all dimensions so 1 art-unit ≈ 1.7 m |

##### Instance fields

| Field | Type | Default | Description |
|---|---|---|---|
| `pos` | `THREE.Vector3` | `(0,0,0)` | Feet position in world space |
| `vel` | `THREE.Vector3` | `(0,0,0)` | Current velocity (units/s) |
| `onGround` | `boolean` | `false` | Whether the player is standing on solid geometry |
| `fixedYaw` | `number` | `0` | Fixed yaw (radians) used to rotate movement input into world space. Set by `main.ts` from the 2.5D camera (see `setupCamera()`) and never changed during gameplay |
| `collider` | `MeshBVH \| null` | `null` | Set externally by `main.ts`; null = no collision |
| `killY` | `number` | `-100` | Falling below this Y triggers `teleport(spawn)` |
| `radius` | `number` | `0.3 × sizeScale ≈ 1.765` | Capsule sphere radius |
| `height` | `number` | `10` | Full height of the capsule |
| `walkSpeed` | `number` | `4 × sizeScale ≈ 23.5 u/s` | Movement speed while walking |
| `runSpeed` | `number` | `7 × sizeScale ≈ 41.2 u/s` | Movement speed while running |
| `jumpSpeed` | `number` | `12 × √sizeScale ≈ 29.1 u/s` | Initial vertical velocity on jump |
| `gravity` | `number` | `20 × sizeScale ≈ 117.6 u/s²` | Downward acceleration |
| `spawn` (private) | `THREE.Vector3` | copied on `teleport()` | Remembered spawn for respawn |
| `seg` (private) | `THREE.Line3` | reused | Capsule segment (bottom → top sphere centres) |
| `box` (private) | `THREE.Box3` | reused | AABB around the capsule for BVH broad phase |
| `tp`, `cp` (private) | `THREE.Vector3` | reused | Closest-point temporaries for BVH query |
| `push` (private) | `THREE.Vector3` | reused | Accumulated push vector from collision |

##### `teleport(p: THREE.Vector3)`
- Copies `p` into `pos` and `spawn`.
- Zeroes `vel`.
- Sets `onGround = false`.

##### `update(dt: number, input: MoveInput)`
Outer physics loop. If `collider` is null, returns immediately.
Splits `dt` (capped to 100 ms) into **adaptive substeps**:
- `fast` = max component of velocity or `runSpeed` — whichever is larger.
- Substep size `h = min(left, 1/60, 0.15 / fast)` — smaller when moving fast to prevent tunnelling.
- Runs up to **400 substeps** per frame (safety cap).
- Calls `step(h, input)` each substep.

##### `step(h: number, inp: MoveInput)` *(private)*
One physics substep:

1. **Rotate input to world space** by `this.fixedYaw` (not `inp.yaw`), keeping movement
   world-aligned for the fixed 2.5D camera:
   `dx = cos(fixedYaw) * moveX - sin(fixedYaw) * moveZ`
   `dz = -sin(fixedYaw) * moveX - cos(fixedYaw) * moveZ`
   Normalises if `len > 1` (diagonal cap).
   With the current camera (`fixedYaw ≈ +π/2`, viewing along -X): `W` → `-X` (up the screen),
   `S` → `+X` (down the screen), `A` → `+Z` (screen left), `D` → `-Z` (screen right).

2. **Horizontal velocity (exponential smoothing):**
   `a = 1 - exp(-(onGround ? 15 : 3) * h)` — snappy on ground, floaty in air.
   `vel.x += (dx * speed - vel.x) * a`
   `vel.z += (dz * speed - vel.z) * a`

3. **Jump:** if `inp.jump && onGround` → `vel.y = jumpSpeed`, `onGround = false`.

4. **Gravity:** `vel.y = max(vel.y - gravity * h, -60)` — terminal velocity -60 u/s.

5. **Integrate:** `pos += vel * h`.

6. **Collide:** calls `collide(h)` to push the capsule out of geometry.

7. **Kill plane:** if `pos.y < killY` → `teleport(spawn)`.

##### `collide(h: number)` *(private)*
BVH capsule collision — called every substep:

1. Builds the capsule segment:
   `seg.start = (pos.x, pos.y + radius, pos.z)` — bottom sphere centre
   `seg.end   = (pos.x, pos.y + height - radius, pos.z)` — top sphere centre

2. Builds the AABB: expands by `radius` in all directions.

3. Calls `bvh.shapecast`:
   - `intersectsBounds(b)` → returns `b.intersectsBox(box)` for broad-phase culling.
   - `intersectsTriangle(tri)` → calls `tri.closestPointToSegment(seg, tp, cp)`.
     If distance `d < radius`, pushes both seg endpoints by `(radius - d)` along the `cp → tp` direction.

4. Computes the total push vector from segment start back to `pos + r`.

5. **Ground detection:** `onGround = push.y > |h * vel.y * 0.25|`
   (slopes up to ~60° count as ground).

6. Resolves velocity:
   - On ground: if falling (`vel.y < 0`), zero out `vel.y`.
   - On wall: removes the velocity component pointing into the wall (`vel -= (vel·push) * push`), allowing sliding.

7. Applies the push to `pos`.

---

### `input.ts`

Game input manager for the fixed-camera 2.5D view: keyboard, the mobile D-Pad
and the touch buttons. There is **no pointer lock and no mouse look** — the
camera angle never changes, so `read()` only reports movement/action state.

#### Class: `GameInput`

##### Public fields

| Field | Type | Default | Description |
|---|---|---|---|
| `playing` | `boolean` | `false` | True while gameplay runs; false while the start/pause menu is open. Gates the whole game loop |
| `onPlayChange` | `((playing: boolean) => void) \| null` | `null` | Callback fired whenever `playing` changes; main.ts uses it to show/hide the menu overlay |

##### Private fields

| Field | Description |
|---|---|
| `keys` | `Set<string>` — currently held keyboard codes |
| `dpadUp` | `boolean` — true while the D-Pad ▲ button is held |
| `dpadDown` | `boolean` — true while the D-Pad ▼ button is held |
| `dpadLeft` | `boolean` — true while the D-Pad ◀ button is held |
| `dpadRight` | `boolean` — true while the D-Pad ▶ button is held |
| `jumpButton` | `boolean` — true while the jump touch-button is pressed |
| `jumpEl` | Reference to `#jumpBtn` DOM element |

##### `constructor()`
Wires up all event listeners:

- **`keydown`** (window): adds `e.code` to `keys` while `playing`; prevents default for Space and Arrow keys so the page doesn't scroll.
- **`keyup`** (window): removes `e.code` from `keys`.
- **`blur`** (window): clears all keys (prevents stuck keys when the window loses focus).
- Jump button (`#jumpBtn`): `pointerdown` sets `jumpButton = true`; `pointerup/cancel/pointerleave` sets it `false`. Calls `e.preventDefault()` and `e.stopPropagation()`.
- There is no use/interact touch button: `#useBtn` was removed, so `use` comes from the **E** key alone.
- D-Pad buttons are **not** wired here — they are bound separately by `bindDpad()` (called from `main.ts`).

##### `start()`
Sets `playing = true` and fires `onPlayChange(true)`. Called when the Play
button is clicked — starts the game or resumes it after a pause.

##### `pause()`
Sets `playing = false`, clears held keys (so nothing is stuck down on resume)
and fires `onPlayChange(false)`. Bound to `Esc` in `main.ts`.

##### `bindDpad(elements)` *(public)*
Wires the four mobile D-Pad buttons — `{ up, down, left, right }` → `HTMLElement`.
Called once from `main.ts` right after the input is constructed.
All four buttons share one `bind()` helper that registers four listeners:

| Event | Effect |
|---|---|
| `pointerdown` | sets that direction's boolean to `true` |
| `pointerup` / `pointercancel` / `pointerleave` | sets it back to `false` |

Every handler calls `e.preventDefault()` and `e.stopPropagation()`. No pointer
capture is taken, so sliding a finger off a button releases it immediately.

##### `read(): MoveInput`
Called every frame by `main.ts`. Builds and returns a `MoveInput` snapshot:

1. **Keyboard axes:**
   - `keyboardMoveX = (D || Right ? 1 : 0) - (A || Left ? 1 : 0)`
   - `keyboardMoveZ = (W || Up ? 1 : 0) - (S || Down ? 1 : 0)`

2. **D-Pad axes:**
   - `dpadMoveX = (dpadRight ? 1 : 0) - (dpadLeft ? 1 : 0)` — right = positive `moveX`.
   - `dpadMoveZ = (dpadUp ? 1 : 0) - (dpadDown ? 1 : 0)` — up = positive `moveZ` (forward).

3. **Priority merge:** keyboard wins if any movement key is held; otherwise the D-Pad.

4. Returns:
   ```ts
   { moveX, moveZ, jump: Space || jumpButton,
     use: E, run: ShiftLeft || ShiftRight }
   ```

---

### `sprite.ts`

**2D billboarded sprite system for 3D world.** Renders the Rocky character as a camera-facing sprite with 4-way directional animations (down, up, left, right) for idle and walk cycles.

#### Types & Interfaces

##### `Direction`
```ts
export type Direction = 'down' | 'up' | 'left' | 'right';
```
The four supported facing directions.

##### `SpriteFrame`
```ts
export interface SpriteFrame {
  texture: THREE.Texture;
  direction: Direction;
}
```

#### Class: `SpriteCharacter`

A camera-facing billboarded sprite placed in the 3D world. Three.js `THREE.Sprite` automatically rotates to face the camera each frame. Directional awareness is achieved by swapping the sprite material's texture map.

##### Constructor
```ts
constructor(parent: THREE.Scene | THREE.Group, basePath: string = '/assets/rocky/')
```
- Creates a `THREE.SpriteMaterial` configured with:
  - `transparent: true`
  - `depthTest: true`
  - `depthWrite: false` (prevents z-fighting and sorting glitches with floor/walls)
- Creates a `THREE.Sprite` with the material and adds it to `parent`.
- Stores `basePath` for texture loading.

##### Properties
| Name | Type | Description |
|---|---|---|
| `sprite` | `THREE.Sprite` | Internal Three.js sprite object |
| `material` | `THREE.SpriteMaterial` | Internal Three.js sprite material |
| `frames` | `Map<Direction, THREE.Texture[]>` | 3 walk textures per direction |
| `idleFrames` | `Map<Direction, THREE.Texture>` | 1 idle texture per direction |
| `currentDirection` | `Direction` | Currently active facing direction (default `'down'`) |
| `walkFrameIndex` | `number` | Current walk cycle frame index (0–2) |
| `walkTimer` | `number` | Accumulated animation time in seconds |
| `walkFrameDuration` | `number` | Time per walk frame (`0.15` seconds) |
| `isWalking` | `boolean` | Whether currently in walking state |
| `pos` | `THREE.Vector3` | Feet position in world space (matching `Player.pos`) |
| `spriteHeight` | `number` | Visual height in world units (default `10`) |

##### Methods

###### `async load(): Promise<void>`
Loads all 16 textures (4 directions × (1 idle + 3 walk frames)) using `THREE.TextureLoader`:
- Filters: `tex.magFilter = THREE.NearestFilter`, `tex.minFilter = THREE.NearestFilter` (ensures crisp pixel art without bilinear blurring).
- Color space: `tex.colorSpace = THREE.SRGBColorSpace`.
- Edge crop: `tex.offset`/`tex.repeat` trim `EDGE_CROP_PX` (**7 px**) from every edge so the
  white border baked into the exported PNGs never shows as lines over the sprite. Seven is the
  worst measured band (a full-width opaque white strip **6 px** deep on the top of
  `rockydownwalk1.png`, 4 px down its sides; 3 px on `rockydownwalk2.png`; 1 px on several other
  frames) plus 1 px of margin. Every band sits on an edge where the artwork starts at least
  40 px in, so nothing visible is clipped. This uses the texture matrix, so it costs nothing
  per frame (no pixel copies).
- Handles filename inconsistencies gracefully:
  - `down`: `rockydownidle.png`, `rockydownwalk1.png`–`3.png`
  - `up`: `rockyupidle.png`, `rockyupwalk1.png`–`3.png`
  - `left`: `rockyleftidle1.png` *(note the "1" suffix)*, `rockyleftwalk1.png`–`3.png`
  - `right`: `rockyrightidle.png`, `rockyrightwalk1.png`–`3.png`
- Sets the initial idle texture to `'down'`.

###### `setDirection(direction: Direction): void`
Sets the active facing direction (`'down'`, `'up'`, `'left'`, or `'right'`). Updates the displayed texture immediately to the matching direction's frame.

###### `setWalking(walking: boolean): void`
Toggles walking state. When changing from walking to not-walking (`false`), resets `walkFrameIndex` to 0, resets `walkTimer`, and immediately displays the idle frame for the current direction.

###### `update(dt: number): void`
Advances the walk cycle animation:
- If `isWalking`: accumulates `walkTimer += dt`. When `walkTimer >= walkFrameDuration`, advances frame index `(walkFrameIndex + 1) % 3` and updates `material.map`.
- If not walking: ensures the idle frame is displayed.

###### `setPosition(pos: THREE.Vector3): void`
Sets the sprite world position where `pos` represents the feet anchor on the floor:
- Copies `pos` into `this.pos`.
- Sets `sprite.position` to `(pos.x, pos.y + spriteHeight / 2, pos.z)` so the bottom edge of the sprite aligns with the ground plane.

###### `setScale(width: number, height: number): void`
Sets the sprite's dimensions in world units:
- Updates `this.spriteHeight = height`.
- Calls `sprite.scale.set(width, height, 1)`.
- Re-anchors `setPosition(this.pos)` to preserve feet alignment.

###### `getObject(): THREE.Sprite`
Returns the underlying Three.js `THREE.Sprite` instance.

---

### `boss.ts`

**Boss billboard sprite.** One camera-facing sprite (same technique as
`SpriteCharacter`) that stands idle in a corner of the room until the game puts
it into battle mode. It owns no game logic — no per-frame ticking, no AI — so
maintaining it is just texture + placement plumbing.

#### Class: `Boss`

| Field | Type | Default | Description |
|---|---|---|---|
| `sprite` (private) | `THREE.Sprite` | new | The billboard, added to the parent passed to the constructor |
| `material` (private) | `THREE.SpriteMaterial` | new | `transparent: true`, `depthTest: true`, `depthWrite: false` |
| `idleTexture` (private) | `THREE.Texture \| null` | `null` | `assets/boss/bossidle.png` |
| `battleTexture` (private) | `THREE.Texture \| null` | `null` | `assets/boss/bossbattle.png` |
| `pos` (private) | `THREE.Vector3` | `(0,0,0)` | Feet position in world space |
| `isInBattle` (private) | `boolean` | `false` | True after `setBattleMode(true)` |
| `spriteHeight` (private) | `number` | `10` | Visual height; used to keep the feet anchored to the floor |
| `interactionRadius` (public) | `number` | `3` | Horizontal distance within which contact counts. `main.ts` raises it to `12` for this room's scale |
| `onPlayerTouch` (public) | `(() => void) \| null` | `null` | Callback fired once per approach, the first frame the player is in range |
| `wasTouched` (private) | `boolean` | `false` | Debounce latch — stops the callback re-firing every frame while in range |

##### `constructor(parent, basePath = '/assets/boss/')`
Creates the material and sprite and adds the sprite to `parent`
(a `THREE.Scene` or `THREE.Group`).

##### `async load(): Promise<void>`
Loads both textures with `THREE.TextureLoader`:
- `NearestFilter` for mag and min (crisp pixel art) and `SRGBColorSpace`.
- URLs resolve through `import.meta.glob('/assets/boss/**/*.png')` so production
  builds use the hashed asset URLs, falling back to the literal path.
- A missing file is **tolerated**: the boss falls back to whichever texture did
  load, and sets `sprite.visible = false` if neither did (never a blank white quad).
- Sets the material map to `idleTexture` (or `battleTexture` as fallback).

##### `setPosition(pos: THREE.Vector3)`
Copies `pos` and places the sprite at `(pos.x, pos.y + spriteHeight / 2, pos.z)`,
so `pos` is the **feet** position and the sprite's bottom edge sits on the floor.

##### `setScale(width: number, height: number)`
Sets `spriteHeight = height`, calls `sprite.scale.set(width, height, 1)` and
re-anchors through `setPosition(this.pos)`.

##### `getPosition(): THREE.Vector3`
Returns the feet position.

##### `getObject(): THREE.Sprite`
Returns the underlying `THREE.Sprite`.

##### `setBattleMode(battle: boolean)`
Sets `isInBattle` and swaps the material map to the battle pose (or back to the
idle pose). If that pose's texture is missing it falls back to the other one.

##### `checkProximity(playerPos: THREE.Vector3): boolean`
Compares the **horizontal** (XZ) distance between `playerPos` and the boss's own
`pos`; Y is ignored, so jumping or standing on a raised patch of floor doesn't
change the result.

| Condition | Effect | Returns |
|---|---|---|
| `distance <= interactionRadius` and `!wasTouched` | sets `wasTouched = true`, calls `onPlayerTouch` | `true` — the frame the touch is first detected |
| `distance <= interactionRadius` and `wasTouched` | nothing (still latched) | `false` |
| `distance > interactionRadius` | clears `wasTouched`, re-arming the hook | `false` |

#### Proximity detection

When Rocky walks into range, `onPlayerTouch` fires once per approach, and that is what
starts a battle — see [`battleCoordinator.ts`](#battlecoordinatorts):

Wiring in `main.ts`:

```ts
boss.interactionRadius = 12;   // see the note below
boss.onPlayerTouch = () => {
  if (!battleCoordinator || battleCoordinator.isBattleActive()) return;
  if (!boss?.getObject().parent) return;   // already defeated and removed
  battleCoordinator.startBattle();
};
// …and once per frame, inside the ready/playing block:
if (battleCoordinator?.isBattleActive()) battleCoordinator.update(dt);
else boss?.checkProximity(player.pos);
```

During the fight the overworld is frozen: `player.update()`, the sprite sync, the walk
cycle and `checkProximity()` are all skipped, so nothing fights the battle staging.

> **Why `12` and not the class default of `3`?** This room's scale is about
> 10 world units per character height (Rocky is 10 units tall, and the boss
> sprite is 15 units wide), so `3` would only fire when Rocky is effectively
> *inside* the boss. `12` is roughly the boss's half-width — close enough to read
> as contact. Tune the value in `main.ts` or the class default as needed.

The `wasTouched` latch is what keeps the callback from firing on every frame while
Rocky stands next to the boss; walking back out of range resets it, so the next
approach fires again. The hook starts `BattleCoordinator.startBattle()` (flash, camera, overlay, turn loop).

#### Placement

`main.ts` creates the boss in `loadRoom()`, right after the Rocky sprite:

```ts
const bossSpawn = new THREE.Vector3(-4.649, -0.531, -29.386); // corner of room618
boss = new Boss(scene);
await boss.load();
boss.setScale(15, 15);   // 1.5x Rocky's 10-unit height
boss.setPosition(bossSpawn);
```

`y = -0.531` is the floor height at that spot, so the vector is used directly as
the feet position — the sprite is drawn 7.5 units above it (`15 / 2`).

> The two PNGs in `assets/boss/` are **placeholders** (generated silhouettes),
> meant to be replaced with real boss art at the same paths — no code changes needed.

---

### `battle.ts`

**Battle layout contract.** Feet marks for the two fighters plus the camera
framing used by `switchToBattleCamera()` in `main.ts`. Staging, overlay,
animations and the turn loop live in [`BattleCoordinator`](#battlecoordinatorts).

#### Constants

| Constant | Value | Purpose |
|---|---|---|
| `BATTLE_POSITIONS.rocky` | `(-4.328, -0.531, 21.705)` | Rocky's battle mark (feet) |
| `BATTLE_POSITIONS.boss` | `(-4.649, -0.531, -29.386)` | Boss battle mark — the same corner it idles in |
| `BATTLE_CAMERA_POSITION` | `(10, 13, 39)` | Lens behind Rocky, off to his right (+X) and well above head height (3/4 rear shot) |
| `BATTLE_CAMERA_YAW_DEG` | `20` | Yaw in degrees (YXZ Euler) — swings the lens left toward the boss, which is what splits the frame horizontally |
| `BATTLE_CAMERA_PITCH_DEG` | `-13` | Pitch in degrees — shallow downward tilt; because the lens sits between the two sprite centres, this is what stacks them vertically |
| `BATTLE_CAMERA_FOV` | `52` | Tighter than the overworld 75° FOV |

`y = -0.531` on the marks is floor height. Camera Y is raised well above it
(13, clear of Rocky's head) so the view reads as a 3/4 rear shot rather than
sitting on the floor.

> The battle camera is typed in as a **literal position plus a literal yaw/pitch
> angle** (`BATTLE_CAMERA_POSITION` / `BATTLE_CAMERA_YAW_DEG` /
> `BATTLE_CAMERA_PITCH_DEG` in `battle.ts`, applied as a `'YXZ'` Euler rotation
> in `switchToBattleCamera()`), so the shot is tuned by editing numbers rather
> than chasing a look-at target.
>
> Both fighters stand on nearly the same X line (`−4.33` and `−4.65`), so they
> are almost collinear along the view axis — a lens aimed straight at the boss
> simply stacks them, with Rocky (3× closer) spilling off the left edge.
> The separation has to come from the **camera's own rotation**: yawing left
> shifts the near sprite (Rocky) much further than the far one, landing Rocky in
> the lower-left foreground and the boss in the upper-right. At 16:9 the two
> sprites land near NDC `(−0.39, −0.32)` and `(+0.16, +0.29)` and both stay
> fully inside the frame (checked down to a 4:3 viewport).

---

### `actionGate.ts`

**Pluggable action gate.** Right now a button press attacks instantly; a future
puzzle module can be plugged in **without touching the battle flow**. This file
contains only the contract, the instant default, and the router — no puzzle
implementation of any kind.

#### `ActionGate` (interface)

```ts
export interface ActionGate {
  /**
   * Called when the player presses ATTACK or COUNTER.
   * Resolves to:
   *   'proceed' — the action executes immediately.
   *   'cancel'  — the action is aborted (e.g., player failed the puzzle).
   * When a gate needs player input (future puzzle), it should show its own UI,
   * and only resolve after the player completes or fails it.
   */
  requestAction(): Promise<'proceed' | 'cancel'>;
}
```

One method, one promise. A gate is allowed to be asynchronous because a puzzle
needs time: it shows its own UI, waits for the answer, and only then resolves.

#### `InstantGate` (default)

| Member | Signature | Notes |
|---|---|---|
| `requestAction()` | `Promise<'proceed' | 'cancel'>` | Returns `Promise.resolve('proceed')` — resolves synchronously |

Button press → attack fires immediately. This is the shipping behaviour.

#### `GateRouter`

Chains gates together; **all** of them must return `'proceed'` for the action to
fire.

| Member | Signature | Notes |
|---|---|---|
| `constructor(gates?)` | `(gates: ActionGate[] = [])` | Copies the array, so the caller can't mutate the router from outside |
| `requestAction()` | `Promise<'proceed' | 'cancel'>` | Pure-`async`: awaits each gate in order; the **first `'cancel'` short-circuits** and returns `'cancel'` without running later gates; otherwise `'proceed'` |
| `addGate(gate)` | `void` | Appends a gate at runtime; gates run in insertion order |

An **empty router resolves `'proceed'` for every press**, which makes it exactly
equivalent to `InstantGate` — that is the intended starting state.

#### Intended usage

`BattleCoordinator` owns **one** `GateRouter` and asks it before every action
(`this.gateRouter.requestAction()` in `handleAttackPress()` and
`handleCounterPress()`), which is exactly the wiring below:

```ts
const gateRouter = new GateRouter();        // empty → instant attacks

const result = await gateRouter.requestAction();
if (result === 'proceed') {
  // fire the attack / counter
}
```

To add a puzzle later, write a class that implements `ActionGate` and inject it —
**no battle-flow code changes needed**:

```ts
class PuzzleGate implements ActionGate {
  async requestAction(): Promise<'proceed' | 'cancel'> {
    // show puzzle UI, await the player's result, return the outcome
  }
}

gateRouter.addGate(new PuzzleGate(...));
```

Because the router is a gate too, it can be composed recursively (`new GateRouter([new GateRouter([...])])`)
and swapped wholesale by assigning a different `ActionGate` to the coordinator.

#### `'cancel'` semantics

When a gate resolves `'cancel'`, the action is aborted and the turn proceeds
**as if the button had never been pressed** — no attack, no damage, and the
queue advances from the same point. The battle state machine decides what
`'cancel'` means per context: a failed counter, for example, means the boss hits
you anyway. The router itself never interprets the value; it only short-circuits.

---

### `battleState.ts`

**The battle turn loop — pure state, no DOM and no Three.js.** It knows whose
turn it is, both fighters' HP, and the counter countdown; a controller
(`main.ts`, or a future battle coordinator) subscribes to phase changes and
mirrors the values into `#battle-ui`.

The *press* is filtered by an `ActionGate` (`actionGate.ts`), and the shipping
`InstantGate` resolves on the spot. A future puzzle gate can hold its own UI
open while its promise is pending — the phases below do not change.

#### `BattlePhase` (enum)

| Member | Value | Meaning |
|---|---|---|
| `IDLE` | `'IDLE'` | No battle running |
| `PLAYER_TURN` | `'PLAYER_TURN'` | Waiting for the player to press **ATTACK** |
| `PLAYER_ANIMATING` | `'PLAYER_ANIMATING'` | Rocky's attack animation is playing |
| `BOSS_TURN` | `'BOSS_TURN'` | Warning shown, **COUNTER!** available, 45 s timer running |
| `COUNTER_ANIMATING` | `'COUNTER_ANIMATING'` | Counter succeeded: Rocky attacks again |
| `BOSS_ANIMATING` | `'BOSS_ANIMATING'` | Counter failed: the boss hits Rocky |
| `VICTORY` | `'VICTORY'` | Boss HP reached 0 |
| `DEFEAT` | `'DEFEAT'` | Rocky's HP reached 0 |

#### `BattleState` (interface)

```ts
export interface BattleState {
  phase: BattlePhase;
  bossHP: number;         // 0-100
  rockyHP: number;        // 0-100
  timerRemaining: number; // seconds
  timerActive: boolean;
  damageBoostActive: boolean;
  turnCount: number;
}
```

| Field | Range | Notes |
|---|---|---|
| `phase` | `BattlePhase` | Current phase; also readable via `getPhase()` |
| `bossHP` | 0-100 | Clamped at 0 — never negative |
| `rockyHP` | 0-100 | Clamped at 0 — never negative |
| `timerRemaining` | seconds | Counts down only while `timerActive` |
| `timerActive` | boolean | `true` between `startTimer()` and `stopTimer()`/expiry |
| `damageBoostActive` | boolean | `true` after Rocky is hit; next player attack gains +25 |
| `turnCount` | integer | Completed player attacks this battle |

#### `BattleStateMachine`

| Member | Signature | Notes |
|---|---|---|
| `constructor()` | — | Starts `IDLE` at full HP |
| `startBattle()` | `void` | Stops any running timer, rewinds HP/`turnCount`, then transitions to `PLAYER_TURN` |
| `getState()` | `BattleState` | **Copy** — callers cannot mutate the live state |
| `getPhase()` | `BattlePhase` | Shorthand for `getState().phase` |
| `onPhaseChange(phase, cb)` | `(BattlePhase, () => void)` | Registers a phase-enter listener; several per phase are allowed and run in registration order |
| `advanceTo(phase)` | `(BattlePhase) → void` | Public entry point into the turn loop, used by the coordinator; `transitionTo()` itself stays private so the machine still owns every transition |
| `startTimer(duration)` | `number` | (Re)starts the 1 s countdown; fires `onTimerWarning` once, `onTimerExpire()` at 0 |
| `stopTimer()` | `void` | Clears the interval, `timerActive = false` |
| `getTimerRemaining()` | `number` | Seconds left |
| `dealDamageToBoss(baseDamage)` | `number` | Damage → boss, clamped at 0; adds to `turnCount`; `VICTORY` at 0 HP |
| `dealDamageToRocky(damage)` | `number` | Damage → Rocky, clamped at 0; `DEFEAT` at 0 HP |
| `reset()` | `void` | Back to `IDLE`, full HP, timer stopped, `turnCount` 0 |

Callbacks and internals: `onTimerWarning` is a public `(() => void) | null` fired
once when the counter timer hits **10 s**; `transitionTo()` sets the phase and
notifies that phase's listeners; `onTimerExpire()` is private and stops the
timer, treating expiry during `BOSS_TURN` as a failed counter (`BOSS_ANIMATING`).

#### Flow

The loop, with the numbers that ship today:

```
PLAYER_TURN ──(attack pressed, gate passes)──▶ PLAYER_ANIMATING ──▶ BOSS_TURN
      ▲                       player attack = 25% boss HP            │
      │                                                              │
      │  (counter pressed in time, gate passes) ──▶ COUNTER_ANIMATING ─┘
      │
      └── (timeout, or the gate cancels) ──▶ BOSS_ANIMATING ──────────┘
                     failed counter boss hit = 45% Rocky HP
```

- **Player attack** — **25%** of the boss's HP per landed hit, so a clean run
  takes four attacks.
- **Failed counter** — the boss connects for **45%** of Rocky's HP: two mistakes
  and Rocky is out.
- **Counter timer** — **45 seconds**, with a warning fired at **10 seconds**
  remaining (`onTimerWarning`), matching `#battle-timer`'s starting value in `index.html`.
- Reaching 0 HP on either side jumps straight to `VICTORY` / `DEFEAT`, whichever
  the damage call was aimed at — the turn loop stops there.

`BattleCoordinator` owns the one live machine and drives it through
`startBattle()`, `advanceTo()`, and the damage helpers.

---

### `battleAnimations.ts`

**The retro attack animation — no damage logic.** The attacking sprite jumps,
thrusts at the target, stars burst where the hit lands, and it settles back.
The module only moves sprites and spawns particles; the caller passes an
`onImpact` callback and applies the damage itself.

#### `AnimationResult` (interface)

```ts
export interface AnimationResult {
  promise: Promise<void>; // resolves when the attacker is home again (or on cancel)
  cancel: () => void;     // aborts now and restores the attacker's original position
}
```

#### Timing

Three phases, read from a single elapsed-time value — **~1.2 s total**:

| Phase | Window | Duration | Motion |
|---|---|---|---|
| **JUMP** | 0 → 0.4 s | 0.4 s | Rises ~3 world units straight up, `ease-out` |
| **THRUST** | 0.4 → 0.7 s | 0.3 s | Lunges ~60% of the way to the target, `ease-in`, arcing back down |
| **RETURN** | 0.7 → 1.2 s | 0.5 s | Settles back to the origin, `ease-in-out` |

`onImpact()` fires **exactly once**, on the frame that crosses the end of the
thrust (0.7 s), immediately before the stars spawn. That is the hook for damage
and sound.

There are **no `setTimeout` chains**: `update(dt)` is the single animation driver,
so a slow frame, a dropped frame or a backgrounded tab can't desynchronise the
phases, and `cancel()` takes effect instantly.

#### Star particles

`generateStarTexture()` draws a 4-pointed star (✦) on a **32×32 canvas** with a
white-to-yellow radial fill and wraps it in a `CanvasTexture` with
`NearestFilter` for both mag and min, matching the crisp sprite art. The texture
is built lazily on first use and shared by every particle.

`spawnImpactParticles(pos)` emits **6-8 `THREE.Sprite`**s (`SpriteMaterial`,
`transparent`, `depthTest: false`, scale **~1.5**) at the impact point, each with
a random spherical velocity biased toward the camera (+Z) so the burst reads as
coming out of the screen. Every star drifts on `pos += vel * dt`, shrinks with
its remaining life, and is removed from the scene and the array after
**0.4 s** (its material is disposed at the same time).

#### `BattleAnimationManager`

| Member | Signature | Notes |
|---|---|---|
| `constructor(scene)` | `(scene: THREE.Scene)` | Scene the particles are added to |
| `playAttackAnimation(attacker, target, onImpact)` | `(THREE.Sprite, THREE.Sprite, () => void) → AnimationResult` | Records the origin, then runs JUMP → THRUST → RETURN; starting a new attack cancels the previous one (its promise still resolves, so no `await` hangs) |
| `spawnImpactParticles(pos)` | `(THREE.Vector3) → void` | The 6-8 star burst described above |
| `update(dt)` | `(number) → void` | **The one animation driver** — advances the attack tween and every particle |
| `cancelAll()` | `void` | Restores the running attacker and clears all stars from the scene |

Private pieces: `particles` (the live `{ sprite, vel, life }[]`), the lazily
created `starTex`, and the in-flight `tween` (one attack at a time).

`BattleCoordinator` constructs one manager, ticks `update(dt)` from the game
loop during a fight, and awaits `playAttackAnimation(...)` on every strike.

---

### `battleUI.ts`

**The bridge between the battle DOM and the battle logic.** It owns the
`#battle-ui` widgets — HP bars, the ATTACK / COUNTER! buttons, the countdown and
the warning banner — but holds **no game state**: the battle controller pushes
values in and receives presses out through two callbacks.

#### `BattleUIController`

| Member | Signature | Notes |
|---|---|---|
| `constructor()` | — | Queries every element by ID (`battle-ui`, `boss-hp-fill`, `rocky-hp-fill`, `attack-btn`, `counter-btn`, `battle-timer`, `battle-warning`) and **throws** `BattleUIController: missing #id in the DOM` if any is absent |
| `setOnAttack(cb)` | `(cb: () => void) → void` | Called on every ATTACK press |
| `setOnCounter(cb)` | `(cb: () => void) → void` | Called on every COUNTER! press |
| `show()` / `hide()` | `void` | Toggles `#battle-ui`'s `display` |
| `updateHP(bossHP, rockyHP)` | `(number, number) → void` | Sets both fill widths (clamped 0-100) and colours each bar by threshold |
| `showAttackButton()` | `void` | ATTACK visible, COUNTER! hidden |
| `showCounterButton()` | `void` | COUNTER! visible, ATTACK hidden, and the warning banner hidden |
| `showWarning(text?)` | `(text?: string) → void` | Shows the banner, defaulting to the copy in `index.html` |
| `hideWarning()` | `void` | Hides the banner |
| `updateTimer(seconds)` | `(number) → void` | Shows the countdown with `Math.ceil(seconds)` and pulses it at ≤ 10 s |
| `hideTimer()` | `void` | Hides the countdown |
| `showVictory()` | `void` | Big centred **YOU WIN!** |
| `showDefeat()` | `void` | Big centred **GAME OVER** |
| `reset()` | `void` | Full bars, ATTACK ready, timer and warning hidden, outcome text removed |

**HP colours:** above 50 → green (`#4caf50 → #8bc34a`), 25-50 → orange
(`#f39c12 → #f7b731`), below 25 → red (`#e74c3c → #c0392b`) — set on the fill's
`background` alongside its `width`, so the CSS transition still animates the hit.

**Timer pulse:** at **10 seconds or fewer** the countdown gets
`animation: warningPulse .5s ease-in-out infinite` — it reuses the keyframes
already defined in `index.html`, so no extra CSS is needed.

**Outcomes:** `showVictory()` / `showDefeat()` hide the buttons, countdown and
warning, then create (once) and reuse a `<div id="battle-outcome">` inside
`#battle-ui` with the big centred text. The HP cards deliberately stay visible so
the final health is still on screen. `reset()` removes that div.

Both buttons call `e.preventDefault()` on `pointerdown` and `click` before
invoking their callback. A future `ActionGate` that needs UI manages its **own
DOM** and reports only `'proceed'` / `'cancel'` through the gate interface.

---

### `battleCoordinator.ts`

**The orchestrator.** It owns the *sequence* of a fight and nothing else: it
holds the `BattleStateMachine` (whose turn it is), the `BattleUIController` (the
DOM), the `BattleAnimationManager` (jump-thrust + stars), a `GateRouter`
containing one `InstantGate`, and references to Rocky's and the boss's sprite
objects. `battle.ts` stays as the source of `BATTLE_POSITIONS`.

```ts
constructor(scene: THREE.Scene, rocky: SpriteCharacter, boss: Boss)
```

#### Battle flow

```
                     ┌───────────────────────────────┐
                     │        PLAYER_TURN            │  ATTACK visible
                     └──────────────┬────────────────┘
        press ATTACK                │
                     ┌──────────────▼────────────────┐
                     │  gateRouter.requestAction()   │  ◀── every action passes
                     └───┬───────────────────────┬───┘      through the gate first
              'proceed'  │                       │  'cancel'
                         ▼                       ▼
            PLAYER_ANIMATING              (nothing happens —
            Rocky jumps + thrusts           the turn stays with
            stars at impact, 25 dmg         the player)
                         │
                         ▼
                     BOSS_TURN  ── warning banner ──▶ 2 s ──▶ COUNTER! + 45 s timer
                     │
   press COUNTER! ───┤            │ 45 s runs out
   (timer stops)     │            ▼
        ┌────────────┴────────┐   BOSS_ANIMATING
        │                     │   Boss jump-thrusts
   gate 'proceed'      gate 'cancel'   45 dmg to Rocky
        ▼                     ▼        ▼
 COUNTER_ANIMATING      BOSS_ANIMATING ─┘
 Rocky hits again       45 dmg to Rocky
 25 dmg                       │
        │                     │
        └────────▲────────────┘
                 │ (unless a fighter hit 0 HP)
                 ▼
            PLAYER_TURN ...                    VICTORY / DEFEAT
                                               → outcome screen, 3 s → endBattle()
```

**Every action is gated.** `handleAttackPress()` and `handleCounterPress()` both
`await this.gateRouter.requestAction()` before anything moves. The router ships
with one `InstantGate`, so presses resolve immediately; a future puzzle gate is
appended with `addGate()` and can hold the action until it resolves — returning
`'cancel'` leaves the turn where it is (or, for a counter, hands it to the boss).

#### Rules and timings

| Value | Amount | Where |
|---|---|---|
| Player attack | **25%** of boss HP | `PLAYER_ATTACK_DAMAGE` |
| Successful counter | **25%** of boss HP | `COUNTER_DAMAGE` |
| Failed counter / timeout | **45%** of Rocky's HP | `BOSS_ATTACK_DAMAGE` |
| Counter window | **45 s** | `COUNTER_TIMER_SECONDS` |
| Warning lead-in | **2 s** after entering `BOSS_TURN` before COUNTER! appears and the timer starts | `WARNING_DELAY_MS` |
| Victory / defeat screen | **3 s** before `endBattle()` | `OUTCOME_DELAY_MS` |

Those phase listeners are registered in the constructor: `PLAYER_TURN` readies
ATTACK and clears the warning, `BOSS_TURN` shows the warning and schedules the
counter window, `BOSS_ANIMATING` runs the boss's strike, and `VICTORY` / `DEFEAT`
show the outcome screen and end the battle after the delay. Every pending
timeout is tracked and cleared by `endBattle()`.

#### API

| Member | Signature | Notes |
|---|---|---|
| `constructor(scene, rocky, boss)` | `(THREE.Scene, SpriteCharacter, Boss)` | Stores both sprite objects, wires the UI callbacks, registers the phase listeners, owns an `AudioManager`, and sets `stateMachine.onTimerWarning` to play `TIMER_WARNING` |
| `startBattle()` | `void` | Fires `onBattleStart`, remembers the sprites' positions, moves them to `BATTLE_POSITIONS`, switches the boss to its battle pose, shows and resets the overlay, then hands the player the first turn |
| `endBattle(victory)` | `(boolean) → void` | Hides the overlay, cancels animations and the timer, clears pending timeouts. **Win:** removes the boss sprite from the scene permanently. **Loss:** restores both positions and the boss's idle pose |
| `isBattleActive()` | `boolean` | True while a battle is staged |
| `update(dt)` | `(number) → void` | Advances the animation manager and mirrors the countdown into the overlay while the timer runs |
| `setOnBattleStart(cb)` / `setOnBattleEnd(cb)` | `(() => void) → void` | Hooks for `main.ts` — camera switching lives there, not here |

Guards: `handleAttackPress()` only accepts `PLAYER_TURN` and
`handleCounterPress()` only `BOSS_TURN`, and a `busy` flag blocks double-presses
while an action resolves. The cancelled-counter path does not duplicate the boss
strike — it transitions to `BOSS_ANIMATING` and lets that one listener run the
same `runBossAttack()` code the timer-expiry path uses.

#### Wiring in `main.ts`

`main.ts` constructs one coordinator once both sprites are loaded, hangs it off the
boss's touch hook, and ticks it from the game loop while a battle is active:

```ts
const battle = new BattleCoordinator(scene, rocky, boss);
battle.setOnBattleStart(() => { switchToBattleCamera(); });
battle.setOnBattleEnd(() => { switchToNormalCamera(); });
boss.onPlayerTouch = () => { if (!battle.isBattleActive()) battle.startBattle(); };
// in the frame loop:
if (battle.isBattleActive()) battle.update(dt);
```

Sound cues (all no-ops until `loadSound` is called): `ATTACK_JUMP` at jump start,
`ATTACK_IMPACT` on impact, `BOSS_HIT` / `ROCKY_HIT` when that fighter takes damage,
`COUNTER_PROMPT` when COUNTER! appears, `TIMER_WARNING` at 10 s,
`VICTORY` / `DEFEAT` on the outcome screens.

---

### `audio.ts`

**Stub sound hook.** Battle code calls `audio.play(SoundEffect.…)` at the trigger
points above. No audio files ship with the repo — `play()` is a no-op until
`loadSound(effect, url)` registers an `HTMLAudioElement`.

#### `SoundEffect` (enum)

| Member | When the coordinator plays it |
|---|---|
| `ATTACK_JUMP` | Attack tween starts (Rocky or boss) |
| `ATTACK_IMPACT` | Thrust lands / stars spawn |
| `BOSS_HIT` | Boss takes damage |
| `ROCKY_HIT` | Rocky takes damage |
| `VICTORY` | Outcome screen, win |
| `DEFEAT` | Outcome screen, loss |
| `TIMER_WARNING` | Counter clock hits 10 s |
| `COUNTER_PROMPT` | COUNTER! button is shown |

#### `AudioManager`

| Member | Signature | Notes |
|---|---|---|
| `loadSound(effect, url)` | `(SoundEffect, string) → void` | Creates / reuses an `HTMLAudioElement`, sets `src`, `load()` |
| `play(effect)` | `(SoundEffect) → void` | No-op if disabled or not loaded; restarts from `currentTime = 0` |
| `setEnabled(v)` | `(boolean) → void` | Master mute |
| `isEnabled()` | `boolean` | Current mute state |

Clips live in a `Map<SoundEffect, HTMLAudioElement>` owned by the instance.

---

## HTML Entry Point (`index.html`)

The page title is **Petrova Crisis**. The favicon is an inline SVG blue circle (`fill='%232d6cdf'`).

### DOM elements

| ID | Element | Purpose |
|---|---|---|
| `overlay` | `<div>` | Full-screen semi-transparent black backdrop; hides when gameplay starts |
| `menu` | `<div>` | 340 px card centred in the overlay with the game title, status, and Play button |
| `msg` | `<div>` | Yellow (`#ffd400`) status text; shows `'Loading…'` then `level.notice` |
| `play` | `<button>` | Starts the game; disabled until the GLB finishes loading |
| `tagline` | `<p>` | Static text: *"solve code to defeat the boss"* |
| `dpad` | `<div>` | Mobile D-Pad container (3×3 CSS grid, bottom-left, centre cell empty) |
| `dpad-up` / `dpad-down` / `dpad-left` / `dpad-right` | `<button class="dpad-btn">` | Direction buttons (▲ ▼ ◀ ▶), wired by `input.bindDpad()` |
| `fullscreenBtn` | `<button>` | Fullscreen toggle (top-right, 46×46 px, SVG icon) |
| `jumpBtn` | `<button class="mobile-btn">` | Jump button (⤓ emoji, rotated 180°) |
| `battle-transition` | `<div>` | Full-screen white flash covering camera cuts in and out of battle (`z-index: 400`) |
| `battle-ui` | `<div>` | Battle overlay root; `display: none` until a battle starts. `position: fixed`, `inset: 0`, `z-index: 200` (above D-Pad/jump at 100), `pointer-events: auto`, `touch-action: none` |
| `boss-info` | `<div>` | Top-left boss card (name + HP bar), mirrors the opponent panel in the reference screenshot |
| `boss-name` | `<div>` | Boss label, defaults to `BOSS` |
| `boss-hp-fill` | `<div class="hp-bar-fill">` | Boss HP bar fill; width % is set from code (100% = full health) |
| `rocky-info` | `<div>` | Bottom-right player card (name + HP bar) |
| `rocky-name` | `<div>` | Player label, defaults to `ROCKY` |
| `rocky-hp-fill` | `<div class="hp-bar-fill">` | Player HP bar fill |
| `battle-actions` | `<div>` | Bottom-centre action row (`pointer-events: auto`) |
| `attack-btn` | `<button>` | Blue `ATTACK` button — fires immediately through `InstantGate` |
| `counter-btn` | `<button>` | Red `COUNTER!` button, hidden until the boss winds up an attack |
| `battle-timer` | `<div>` | Large centred countdown (default `45`), shown with `display: block` |
| `battle-warning` | `<div>` | Pulsing red banner: *"The monster is about to attack! Counter quickly!"* |

### Key CSS rules

| Selector | Notable properties |
|---|---|
| `html, body` | `overflow: hidden` — prevents scrollbars; `background: #111` |
| `canvas` | `touch-action: none` — disables browser scroll/zoom on touch |
| `.mobile-btn` | 58×58 px, circular, `backdrop-filter: blur(4px)`, `z-index: 100` |
| `#dpad` | Fixed bottom-left, 3×3 grid of 50 px cells with a 4 px gap, `z-index: 100`, `touch-action: none` |
| `.dpad-btn` | 50×50 px rounded square, `backdrop-filter: blur(4px)`, `touch-action: none` |
| `#dpad-up/down/left/right` | `grid-area` places each button in the cross; the centre cell stays empty |
| `#fullscreenBtn` | Fixed top-right, respects `env(safe-area-inset-*)` for notched phones |
| `#jumpBtn` | `transform: rotate(180deg)` — arrow points upward visually |
| `@media (min-width: 768px) and (pointer: fine)` | Hides dpad and jumpBtn on desktop |
| `@media (orientation: portrait) and (max-width: 767px)` | Makes `#overlay` scrollable in portrait |
| `#play` | Full-width, `background: #2d6cdf` (brand blue) |
| `#battle-ui` | Overlay root: `inset: 0`, `z-index: 200`, `pointer-events: auto`, `touch-action: none` |
| `body.battle-active #dpad, #jumpBtn` | Hidden during battle |
| `#battle-transition` | White flash overlay, `z-index: 400` |
| `#boss-info`, `#rocky-info` | 250 px dark cards (`rgba(0,0,0,.7)`), rounded, positioned top-left / bottom-right (`bottom: 90px`) |
| `.hp-bar-container`, `.hp-label` | Flex row holding the `HP` label and the bar |
| `.hp-bar-bg` | 180×12 px, `#333` track, 2 px `#555` border |
| `.hp-bar-fill` | Green gradient (`#4caf50 → #8bc34a`), `transition: width 0.5s ease` |
| `#battle-actions` | Absolute bottom-centre, `translateX(-50%)`, `pointer-events: auto` |
| `#attack-btn` / `#counter-btn` | 14 px 40 px padding, 3 px white border, blue / red fill |
| `@keyframes btnPulse` | `#counter-btn` scales 1 → 1.08 on a 0.6 s loop |
| `#battle-timer` | 64 px bold `#ff4444` with a dark text-shadow |
| `#battle-warning` | 35% height, `rgba(231,76,60,.9)` banner, `@keyframes warningPulse` fades 1 → 0.6 |
| `@media (max-width: 767px)` | Cards shrink to 180 px, Rocky card `bottom: 110px`, bars to 120 px, timer to **42 px**, buttons min **44 px** with `touch-action: manipulation` |

### Battle UI overlay (`#battle-ui`)

A DOM layer that sits **above** the canvas and is hidden (`display: none`) until a
battle begins. The layout mirrors a classic monster-battle screen: the opponent's
info card top-left, the player's card bottom-right, and the action button set
bottom-centre.

```
┌──────────────────────────────┐
│ [BOSS  HP ████████░░]        │
│                              │
│           45                 │  ← #battle-timer (centre)
│   The monster is about…      │  ← #battle-warning (35% height)
│                              │
│           [ ATTACK ]         │  ← #battle-actions (bottom-centre)
│        [BOSS  HP ████░░]     │
└──────────────────────────────┘
```

- **HP bars** — `#boss-hp-fill` / `#rocky-hp-fill` start at 100% width and are
  driven by inline `style.width`; the 0.5 s CSS transition animates each hit.
- **`#attack-btn`** — blue, always visible during battle.
- **`#counter-btn`** — red and `display: none` by default; it is revealed only
  while the boss is winding up, and pulses via `@keyframes btnPulse`.
- **`#battle-timer`** — centred countdown (starts at `45`) shown with
  `display: block`.
- **`#battle-warning`** — red banner shown alongside the counter window, pulsing
  via `@keyframes warningPulse`.

Pressing ATTACK fires immediately through `InstantGate`. A future puzzle module
would bring its own UI and plug in through `src/actionGate.ts` without changing
this markup.

On a **375 px**-wide viewport the four battle widgets stay apart: boss card
top-left, Rocky card bottom-right (`bottom: 110px` so it clears the action
button), ATTACK/COUNTER bottom-centre, timer in the screen centre. The D-Pad
and jump button are covered (`z-index` 200 > 100) and hidden via
`body.battle-active`.

### Module script
```html
<script type="module" src="./src/main.ts"></script>
```
Vite resolves this at dev time; at build time it is replaced with a hashed bundle.

---

## Assets

### `assets/room618.glb` (~14.4 MB)

The only playable room. A binary GLTF 2.0 file.
The engine supports these optional naming conventions inside the model:

| Object name pattern | Effect |
|---|---|
| `SPAWN_POINT` | Defines player spawn position and facing direction (yaw extracted from Y Euler rotation) |
| `COL_*` (prefix) | Used as simplified invisible collision proxies; overrides automatic collision; the mesh is set `visible = false` |
| `userData.noCollide` | If truthy on a mesh, excludes it from automatic collision (when no `COL_*` meshes exist) |

If no `SPAWN_POINT` is found, the engine ray-casts downward at the reference spawn point
`(-2.0, 20, 43.41)` (X shifted towards center, Z doubled) to place the player 0.02 units above the floor.

### `assets/rocky/` — Character sprite sheets

A "Rocky" character sprite set stored as individual PNG frames.
Each direction contains 1 idle frame + 3 walk frames:

| Directory | Files |
|---|---|
| `rocky/down/` | `rockydownidle.png`, `rockydownwalk1.png`, `rockydownwalk2.png`, `rockydownwalk3.png` |
| `rocky/up/` | `rockyupidle.png`, `rockyupwalk1.png`, `rockyupwalk2.png`, `rockyupwalk3.png` |
| `rocky/left/` | `rockyleftidle1.png`, `rockyleftwalk1.png`, `rockyleftwalk2.png`, `rockyleftwalk3.png` |
| `rocky/right/` | `rockyrightidle.png`, `rockyrightwalk1.png`, `rockyrightwalk2.png`, `rockyrightwalk3.png` |

These textures are loaded by `src/sprite.ts` via `SpriteCharacter.load()` and rendered as a billboarded sprite in the 3D room.

---

### `assets/boss/` — Boss sprite sheets

Placeholder art so the boss is visible in-world until real art is supplied.
Both files are 512×512 RGBA PNGs:

| File | Purpose |
|---|---|
| `boss/bossidle.png` | Idle pose — used by default |
| `boss/bossbattle.png` | Battle pose — used after `Boss.setBattleMode(true)` |

They are loaded by `src/boss.ts` via `Boss.load()` and rendered as a billboarded
sprite. Replacing them with real art at the same paths requires no code changes.

---

## Build Configuration

### `vite.config.ts`

```ts
import { defineConfig } from 'vite';
export default defineConfig({
  base: './',   // Relative asset paths — works when hosted in a subdirectory
});
```

- `base: './'` ensures all asset URLs in the HTML and JS use relative paths,
  so the build can be deployed to any directory without rewriting paths.
- The `import.meta.glob('/assets/*.glb', …)` in `main.ts` is resolved by Vite
  at build time — `.glb` files are treated as static assets and emitted with a content hash.

### npm scripts

| Script | Command | Purpose |
|---|---|---|
| `dev` | `vite` | Start HMR dev server (default port 5173) |
| `build` | `tsc && vite build` | Type-check first, then bundle for production into `dist/` |

---

## TypeScript Configuration

`tsconfig.json`:

| Option | Value | Reason |
|---|---|---|
| `target` | `ES2022` | Modern JS features (top-level await, class fields, etc.) |
| `module` | `ESNext` | Native ES module output for Vite |
| `moduleResolution` | `Bundler` | Vite-aware resolution (no `.js` extension required) |
| `lib` | `["ES2022", "DOM", "DOM.Iterable"]` | Full browser API types |
| `types` | `["vite/client"]` | Adds `import.meta.glob`, `import.meta.env`, etc. |
| `strict` | `true` | Full strict mode (null checks, no implicit any, etc.) |
| `noEmit` | `true` | tsc only type-checks; Vite handles actual transpilation |
| `skipLibCheck` | `true` | Speeds up compilation by skipping `.d.ts` checks |
| `isolatedModules` | `true` | Each file must be independently transpilable (Vite requirement) |
| `include` | `["src"]` | Only type-checks files in `src/` |

---

## Dependencies

### Runtime (`dependencies`)

| Package | Version | Purpose |
|---|---|---|
| `three` | `^0.170.0` | WebGL 3D engine — renderer, scene graph, camera, lights, loaders, math |
| `three-mesh-bvh` | `^0.9.15` | Adds `MeshBVH` class for fast triangle-level ray/shape casting on arbitrary geometry |

### Development (`devDependencies`)

| Package | Version | Purpose |
|---|---|---|
| `@types/three` | `^0.170.0` | TypeScript type declarations for Three.js |
| `typescript` | `^5.6.0` | TypeScript compiler |
| `vite` | `^5.4.0` | Dev server + bundler |

---

## Development Setup

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (Vite HMR on http://localhost:5173)
npm run dev

# 3. Build for production (type-check + bundle into dist/)
npm run build
```

The `room618.glb` file **must** be present at `assets/room618.glb` before running.
If it is missing, the app will display `"Could not load room618.glb: …"` and the Play
button stays disabled.

---

## GLB Model Conventions

When creating or modifying the room618 model, follow these conventions so the
engine picks them up automatically:

1. **Spawn point** — Create any object (e.g., an empty) named exactly `SPAWN_POINT`.
   Its world position becomes the player spawn, and its Y-axis Euler rotation
   (in `'YXZ'` order) becomes the initial camera yaw.

2. **Simplified collision** — Name any mesh (or its parent) with the prefix `COL_`
   (e.g., `COL_Floor`, `COL_Walls`).
   - All descendants of `COL_*` objects are collected.
   - These objects are made invisible (`visible = false`).
   - When at least one `COL_*` mesh exists, **no other meshes** are added to the
     collider. This lets you use a low-poly proxy for physics while keeping a
     high-poly visual mesh.

3. **Non-collidable visuals** — Set `userData.noCollide = true` on any mesh you
   want visible but walkthrough (e.g., foliage, decals). Only applies in automatic
   collision mode (when no `COL_*` meshes are present).

4. **Scale** — The player is scaled for a `10 / 1.7 ≈ 5.88` world-unit = 1 metre
   ratio. Model your room at 1 unit = ~17 cm, or adjust `Player.sizeScale`.

---

## Known Architecture Notes & Future Work

The codebase contains several explicit placeholders for unimplemented features:

- **`systems` array** (`main.ts`): an empty `Array<(dt: number) => void>`
  with the comment `// FUTURE: guide arrow, puzzle checks, curtain animation etc.`
  Any per-frame subsystem can be pushed into this array and it will automatically
  run each frame.

- **`use` input** (`player.ts`, `input.ts`): the `MoveInput.use` field is wired
  to the `E` key (the mobile Use button was removed), but nothing in the current codebase
  reads it to trigger any behaviour.

- **Rocky sprites** (`assets/rocky/`): now fully used — the 16 PNG frames are loaded by
  `SpriteCharacter` and driven every frame from `directionFromInput()`.

- **Battle system** is live — see [Battle System](#battle-system). Remaining work:
  puzzle `ActionGate` implementations, dropping real files into `AudioManager`,
  and additional bosses.

- **Battle balance**: two missed counters (45 + 45) defeat Rocky; a clean run
  of four 25-damage hits wins. The HP pools and the damage constants in
  `battleCoordinator.ts` are the knobs.

- **"Petrova Crisis" puzzle / boss AI**: there is no puzzle and no boss AI — the boss
  only reacts to being touched and to the battle flow. A future `ActionGate` can add a
  puzzle step without changing the battle code. Sounds are stubbed in `src/audio.ts`.

- **Multi-room support**: `main.ts` uses `import.meta.glob('/assets/*.glb', …)`
  which would collect multiple GLBs, but `roomUrl` is hardcoded to `room618.glb`
  and there is no room-selection UI.
