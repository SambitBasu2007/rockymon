import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshBVH } from 'three-mesh-bvh';

function disposeObject(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
}

/** Merge meshes (in world space) into one triangle soup and build a BVH over it. */
export function buildCollider(meshes: THREE.Mesh[]): { bvh: MeshBVH; box: THREE.Box3; tris: number } | null {
  const usable = meshes.filter((m) => m.geometry?.attributes?.position);
  const count = (m: THREE.Mesh) => Math.floor((m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3) * 3;
  const total = usable.reduce((n, m) => n + count(m), 0);
  if (!total) return null;
  const out = new Float32Array(total * 3);
  const v = new THREE.Vector3();
  let o = 0;
  for (const m of usable) {
    const pos = m.geometry.attributes.position, idx = m.geometry.index, n = count(m);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
      out[o++] = v.x; out[o++] = v.y; out[o++] = v.z;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
  geo.computeBoundingBox();
  return { bvh: new MeshBVH(geo), box: geo.boundingBox!.clone(), tris: total / 3 };
}

/**
 * The current room:
 *  - By default every visible mesh becomes solid (collision = its real triangles).
 *  - Optional: meshes/objects named COL_* are used INSTEAD, as simplified invisible collision.
 *  - Optional: an object named SPAWN_POINT sets the start position and direction.
 */
export class Level {
  readonly root = new THREE.Group();
  collider: MeshBVH | null = null;
  readonly spawn = new THREE.Vector3();
  spawnYaw = 0;
  notice = '';
  killY = -100;
  size = 100; // rough world diagonal, used for the camera far plane
  private readonly world = new THREE.Group();
  private token = 0;

  constructor() { this.root.add(this.world); }

  /** Load the room GLB. Returns false if a newer load superseded this one.
   *  Throws on failure and leaves the current world untouched. */
  async load(url: string): Promise<boolean> {
    const token = ++this.token;
    const content = (await new GLTFLoader().loadAsync(url)).scene;
    if (token !== this.token) { disposeObject(content); return false; }
    this.setWorld(content);
    return true;
  }

  setWorld(content: THREE.Object3D) {
    while (this.world.children.length) { const c = this.world.children[0]; this.world.remove(c); disposeObject(c); }
    this.world.scale.setScalar(1);
    this.world.add(content);
    this.rebuild();
  }

  /** Call again after adding/removing meshes in the world (curtains, doors...). */
  rebuild() {
    this.notice = '';
    this.world.updateMatrixWorld(true);
    const cols = new Set<THREE.Mesh>();
    let spawnNode: THREE.Object3D | null = null;
    this.world.traverse((o) => {
      if (o.name === 'SPAWN_POINT') spawnNode = o;
      if (o.name.startsWith('COL_')) {
        o.traverse((c) => { if ((c as THREE.Mesh).isMesh) cols.add(c as THREE.Mesh); });
        o.visible = false;
      }
    });
    let meshes = [...cols];
    const auto = !meshes.length;
    if (auto) this.world.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.noCollide) meshes.push(o as THREE.Mesh); });

    const built = buildCollider(meshes);
    this.collider = built?.bvh ?? null;
    if (!built) { this.notice = 'No solid geometry found in this model.'; this.spawn.set(0, 1, 0); this.spawnYaw = 0; return; }

    const size = built.box.getSize(new THREE.Vector3());
    this.size = size.length();
    this.killY = built.box.min.y - 30;
    this.notice = '';

    const node = spawnNode as THREE.Object3D | null;
    if (node) {
      node.getWorldPosition(this.spawn);
      this.spawnYaw = new THREE.Euler().setFromQuaternion(node.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    } else {
      // no SPAWN_POINT: raycast downward onto the floor at reference spawn point (x reduced towards center to -2.0, z doubled to 43.41)
      const target = new THREE.Vector3(-2.0, 20, 43.41);
      const down = new THREE.Vector3(0, -1, 0);
      const hit = built.bvh.raycastFirst(new THREE.Ray(target, down), THREE.DoubleSide);
      this.spawn.copy(hit ? hit.point : new THREE.Vector3(-2.0, -0.531, 43.41));
      this.spawn.y += 0.02;
      this.spawnYaw = 0;
    }
  }
}
