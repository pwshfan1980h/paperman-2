import * as THREE from 'three';
import { Canvas } from './canvas';
import { Rng, hash2 } from '../rng';
import { W, groundStrip, tree, bench, lampPost, bush, flowerBed, lawnColor, TreeKind } from './props';
import { Built, CELL, Collider, ROAD_HALF, Spawn, Target } from './types';
import { voxMaterial, Vox, voxMesh } from '../../voxel/vox';

const NA = 84;

function finish(canvases: Canvas[], group: THREE.Group, colliders: Collider[]) {
  for (const cv of canvases) {
    const g = cv.grid.mesh();
    if (g) {
      const m = new THREE.Mesh(g, voxMaterial);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
    colliders.push(...cv.colliders);
  }
}

function emptyBuilt(): Built {
  return { group: new THREE.Group(), colliders: [], targets: [], spawns: [] };
}

// ---------------------------------------------------------------- ramps

/** Wooden kicker on the road. Rises toward -z (the direction of travel). */
export function ramp(x: number, zNear: number, len: number, width: number, top: number, out: Built, color = 0xb88a52) {
  const v = new Vox();
  for (let k = 0; k < len; k++) {
    const hgt = Math.max(1, Math.round(((k + 1) / len) * top));
    for (let i = 0; i < width; i++) {
      const plank = (k % 4 === 0) ? 0x9a6e3e : color;
      v.set(i, hgt - 1, -k - 1, i === 0 || i === width - 1 ? 0x8a5e32 : plank);
      for (let y = 0; y < hgt - 1; y++) if (i === 0 || i === width - 1) v.set(i, y, -k - 1, 0x7a522a);
    }
  }
  // chevrons on the face
  for (let k = 2; k < len - 2; k += 6) for (let i = 2; i < width - 2; i++) {
    const hgt = Math.max(1, Math.round(((k + 1) / len) * top));
    if (Math.abs(i - width / 2) < 2 + (k % 12 === 2 ? 1 : 0)) v.set(i, hgt - 1, -k - 1, 0xf2d03a);
  }
  const m = voxMesh(v, [width / 2, 0, 0], { grain: 0.04 });
  m.position.set(x, 0, zNear);
  out.group.add(m);
  out.colliders.push({ x0: x - width / 2, x1: x + width / 2, z0: zNear - len, z1: zNear, top, kind: 'ramp', rampFrom: 0, rampTo: top, tag: 'ramp' });
}

function bullseye(x: number, z: number, side: number, out: Built) {
  const v = new Vox();
  for (let y = 0; y < 14; y++)
    for (let k = -7; k < 7; k++) {
      const d = Math.hypot(y - 6.5, k + 0.5);
      if (d > 7) continue;
      const ring = Math.floor(d / 1.8);
      v.set(0, y + 6, k, ring % 2 ? 0xf4f1e8 : 0xd8322f);
    }
  for (let y = 0; y < 7; y++) v.set(1, y, 0, 0x6a4a2e);
  const m = voxMesh(v, [0.5, 0, 0]);
  m.position.set(x, 2, z);
  if (side > 0) m.rotation.y = Math.PI;
  out.group.add(m);
  out.targets.push({ kind: 'bullseye', box: new THREE.Box3(new THREE.Vector3(x - 4, 6, z - 8), new THREE.Vector3(x + 4, 24, z + 8)) });
  out.colliders.push({ x0: x - 1, x1: x + 1, z0: z - 1, z1: z + 1, top: 22, kind: 'solid', tag: 'target' });
}

// ---------------------------------------------------------------- pieces

export function buildStart(zNear: number, len: number): Built {
  const out = emptyBuilt();
  const nb = len / CELL;
  const rng = new Rng(77);
  const R = new Canvas(1, zNear, NA, nb, 40);
  const L = new Canvas(-1, zNear, NA, nb, 40);
  groundStrip(R, nb);
  groundStrip(L, nb);
  // The Herald depot: low brick building with a sign and loading dock
  const A = 22, B = 18;
  R.box(A, 1, B, A + 30, 16, B + 50, (a, y, b) => (y % 3 === 0 || (a + b + (Math.floor(y / 3) % 2) * 2) % 4 === 0 ? 0xc8beb0 : hash2(a, y + b) < 0.3 ? 0x9a4a36 : 0xa8543c));
  R.box(A, 17, B, A + 30, 17, B + 50, 0x5a5048);
  for (let b = B; b <= B + 50; b++) R.set(A, 18, b, 0x5a5048);
  // sign board
  R.box(A - 1, 12, B + 12, A - 1, 16, B + 38, 0x1e2a4a);
  const letters = 'HERALD';
  letters.split('').forEach((_, i) => R.box(A - 2, 13, B + 15 + i * 4, A - 2, 15, B + 16 + i * 4, 0xf2d03a));
  // roll-up doors and windows
  for (const b of [B + 4, B + 42]) {
    R.carve(A, 1, b, A, 9, b + 5);
    R.box(A + 1, 1, b, A + 1, 9, b + 5, (_a, y) => (y % 2 ? 0xd8d4c8 : 0xc0bcb0));
  }
  for (let b = B + 14; b < B + 38; b += 6) {
    R.carve(A, 4, b, A, 8, b + 3);
    R.box(A + 1, 4, b, A + 1, 8, b + 3, 0xffd27a);
  }
  R.box(A - 6, 1, B, A - 1, 1, B + 50, 0xb8b2a6); // dock apron
  R.collide(A, A + 30, B, B + 50, 19, 'solid', 'depot');
  for (let a = 10; a < A - 6; a++) for (let b = B; b <= B + 50; b++) R.set(a, 0, b, W.drive);
  lampPost(R, 12, B - 4);
  lampPost(R, 12, B + 54);
  // left: a little pocket park
  for (let i = 0; i < 5; i++) tree(L, rng.int(20, 60), rng.int(6, nb - 8), rng.pick(['oak', 'maple', 'autumn'] as TreeKind[]), rng);
  bench(L, 12, 20, 8);
  flowerBed(L, 14, 40, 20, 50, rng);
  finish([R, L], out.group as THREE.Group, out.colliders);
  out.spawns.push({ type: 'birds', x: -60, z: zNear - 120, variant: 0 });
  return out;
}

export function buildCross(zNear: number, len: number, day: number): Built {
  const out = emptyBuilt();
  const nb = len / CELL;
  for (const side of [-1, 1]) {
    const cv = new Canvas(side, zNear, NA, nb, 24);
    for (const [b0, b1] of [[0, 9], [nb - 10, nb - 1]]) {
      for (let b = b0; b <= b1; b++) {
        cv.set(0, 0, b, W.curb);
        for (let a = 1; a < NA; a++) {
          const sidewalk = a <= 9 || (b0 === 0 ? b >= b1 - 7 : b <= b0 + 7);
          cv.set(a, 0, b, sidewalk ? (b === b0 + 4 && a > 9 ? W.joint : W.sidewalk) : lawnColor(a, b));
        }
        for (let a = 0; a < NA; a++) if ((b0 === 0 && b === b1) || (b0 !== 0 && b === b0)) cv.set(a, 0, b, W.curb);
      }
    }
    // stop sign on the near corner, lamp on the far one
    const sa = 3, sb = 7;
    cv.box(sa, 1, sb, sa, 10, sb, 0x8a8f9a);
    cv.box(sa - 1, 11, sb - 1, sa - 1, 13, sb + 1, 0xd8322f);
    cv.set(sa - 2, 12, sb, 0xf4f1e8);
    cv.collide(sa, sa, sb, sb, 14, 'solid', 'sign');
    lampPost(cv, 4, nb - 6);
    finish([cv], out.group as THREE.Group, out.colliders);
  }
  // crosswalk stripes and stop lines as thin slabs on the asphalt
  const stripe = new THREE.MeshLambertMaterial({ color: 0xf2f0e8 });
  const zA = zNear - 10 * CELL, zB = zNear - (nb - 10) * CELL;
  for (let x = -ROAD_HALF + 4; x < ROAD_HALF - 4; x += 8) {
    for (const z of [zA - 6, zB + 6]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 10), stripe);
      m.position.set(x + 2, 0.1, z);
      m.receiveShadow = true;
      out.group.add(m);
    }
  }
  for (const s of [-1, 1]) for (let x = 60; x < 400; x += 8) {
    for (const xx of [s * x]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(5, 0.2, 2), stripe);
      m.position.set(xx, 0.1, (zA + zB) / 2);
      out.group.add(m);
    }
  }
  out.spawns.push({ type: 'birds', x: 30, z: zNear - 30, variant: 1 });
  void day;
  return out;
}

export function buildPark(zNear: number, len: number, day: number): Built {
  const out = emptyBuilt();
  const nb = len / CELL;
  const rng = new Rng(4242);
  const L = new Canvas(-1, zNear, NA, nb, 50);
  const R = new Canvas(1, zNear, NA, nb, 50);
  for (const cv of [L, R]) {
    groundStrip(cv, nb);
    // meandering gravel path
    for (let b = 0; b < nb; b++) {
      const c = Math.round(24 + Math.sin(b / 18) * 8);
      for (let a = c - 2; a <= c + 2; a++) cv.set(a, 0, b, (a + b) % 5 ? 0xd8c8a0 : 0xc8b890);
    }
  }
  // pond on the left with lily pads
  const pc = [44, 130], pr = [22, 46];
  for (let a = pc[0] - pr[0] - 2; a <= pc[0] + pr[0] + 2; a++)
    for (let b = pc[1] - pr[1] - 2; b <= pc[1] + pr[1] + 2; b++) {
      const d = ((a - pc[0]) / pr[0]) ** 2 + ((b - pc[1]) / pr[1]) ** 2;
      if (d > 1.12) continue;
      if (d > 1) { L.set(a, 0, b, 0xa89a7a); L.set(a, 1, b, hash2(a, b) < 0.5 ? W.stone : 0xa8a298); continue; }
      L.set(a, 0, b, hash2(a * 3, b) < 0.06 ? 0x3a8a3a : d > 0.8 ? 0x5ab0d8 : W.water);
    }
  L.collide(pc[0] - pr[0], pc[0] + pr[0], pc[1] - pr[1], pc[1] + pr[1], 1, 'solid', 'pond');
  out.spawns.push({ type: 'ducks', ...wxz(L, pc[0], pc[1]), area: L.rect(pc[0] - pr[0] + 4, pc[0] + pr[0] - 4, pc[1] - pr[1] + 6, pc[1] + pr[1] - 6) });
  // gazebo by the pond
  {
    const a0 = 64, b0 = 40;
    L.box(a0, 1, b0, a0 + 12, 1, b0 + 12, 0xd8d0c0);
    for (const [a, b] of [[a0, b0], [a0 + 12, b0], [a0, b0 + 12], [a0 + 12, b0 + 12]]) L.box(a, 2, b, a, 10, b, 0xf4f1e8);
    for (let k = 0; k < 5; k++) L.box(a0 - 1 + k, 11 + k, b0 - 1 + k, a0 + 13 - k, 11 + k, b0 + 13 - k, k % 2 ? 0x2a6a5a : 0x3a7a6a);
    L.collide(a0, a0 + 12, b0, b0 + 12, 16, 'solid', 'gazebo');
  }
  // playground on the right
  {
    const a0 = 40, b0 = 60;
    for (let a = a0; a < a0 + 30; a++) for (let b = b0; b < b0 + 40; b++) R.set(a, 0, b, hash2(a, b) < 0.5 ? 0xd8b880 : 0xc8a870);
    // slide tower
    R.box(a0 + 4, 1, b0 + 6, a0 + 12, 8, b0 + 14, (a, y, b) => (y === 8 ? 0x3a7ad8 : (a + b) % 8 === 0 ? 0xe8c040 : 0));
    for (const [a, b] of [[a0 + 4, b0 + 6], [a0 + 12, b0 + 6], [a0 + 4, b0 + 14], [a0 + 12, b0 + 14]]) R.box(a, 1, b, a, 13, b, 0xe8c040);
    R.box(a0 + 3, 14, b0 + 5, a0 + 13, 14, b0 + 15, 0xd8322f);
    for (let k = 0; k < 10; k++) R.box(a0 + 13 + k, 8 - Math.floor(k * 0.75), b0 + 9, a0 + 13 + k, 8 - Math.floor(k * 0.75), b0 + 11, 0x3ac0a0);
    R.collide(a0 + 3, a0 + 23, b0 + 5, b0 + 15, 15, 'solid', 'playground');
    // see-saw
    R.box(a0 + 6, 1, b0 + 26, a0 + 6, 2, b0 + 26, 0x8a8f9a);
    R.box(a0 + 1, 3, b0 + 26, a0 + 11, 3, b0 + 26, 0xe8662a);
  }
  // trees and flower beds through both lawns
  for (const cv of [L, R])
    for (let i = 0; i < 12; i++) {
      const b = rng.int(4, nb - 6);
      const a = rng.int(34, 78);
      if (cv === L && Math.abs(b - pc[1]) < pr[1] + 8 && a < pc[0] + pr[0] + 6) continue;
      if (cv === L && a > 60 && a < 80 && b > 36 && b < 58) continue;
      if (cv === R && a > 36 && a < 74 && b > 56 && b < 104) continue;
      tree(cv, a, b, rng.pick(['oak', 'birch', 'blossom', 'pine', 'oak'] as TreeKind[]), rng, rng.range(0.9, 1.3));
    }
  for (const cv of [L, R]) {
    // benches on the sidewalk edge: hop up and grind across
    for (const b of [30, 120, 200]) bench(cv, 10, b, 10);
    lampPost(cv, 8, 70);
    lampPost(cv, 8, 170);
    flowerBed(cv, 14, 90, 20, 104, rng);
    bush(cv, 16, 150, 3, rng, true);
  }
  // fountain on the right, low rim you can hop onto
  {
    const c = [36, 190];
    for (let a = c[0] - 8; a <= c[0] + 8; a++)
      for (let b = c[1] - 8; b <= c[1] + 8; b++) {
        const d = Math.hypot(a - c[0], b - c[1]);
        if (d > 8.3) continue;
        if (d > 7) { R.box(a, 1, b, a, 2, b, W.stone); continue; }
        R.set(a, 1, b, d < 2 ? W.stone : W.water2);
      }
    R.box(c[0], 1, c[1], c[0], 6, c[1], W.stone);
    R.box(c[0] - 1, 6, c[1] - 1, c[0] + 1, 6, c[1] + 1, W.stone);
    R.set(c[0], 7, c[1], 0xb8e0f8);
    R.collide(c[0] - 8, c[0] + 8, c[1] - 8, c[1] + 8, 3, 'walk', 'fountain');
  }
  finish([L, R], out.group as THREE.Group, out.colliders);

  // BMX kickers on the road and a bonus target alley (Paperboy 2's training course, folded into the route)
  ramp(22, zNear - 60, 26, 22, 12, out);
  ramp(-22, zNear - 170, 26, 22, 12, out);
  ramp(22, zNear - 300, 30, 22, 16, out);
  ramp(0, zNear - 420, 34, 26, 18, out, 0xd8a050);
  for (const [x, z] of [[-70, 80], [72, 150], [-74, 240], [70, 330], [-72, 400], [74, 470]]) bullseye(x, zNear - z, x > 0 ? 1 : -1, out);

  out.spawns.push({ type: 'birds', x: -30, z: zNear - 100, variant: 0 });
  out.spawns.push({ type: 'birds', x: 60, z: zNear - 260, variant: 2 });
  out.spawns.push({ type: 'birds', x: -60, z: zNear - 380, variant: 3 });
  out.spawns.push({ type: 'squirrel', x: 80, z: zNear - 200 });
  if (day >= 1) out.spawns.push({ type: 'dog', x: 70, z: zNear - 350, area: { x0: 60, x1: 200, z0: zNear - 480, z1: zNear - 240 }, variant: 77, side: 1 });
  return out;
}

export function buildConstruction(zNear: number, len: number, day: number): Built {
  const out = emptyBuilt();
  const nb = len / CELL;
  const rng = new Rng(9090);
  const L = new Canvas(-1, zNear, NA, nb, 30);
  const R = new Canvas(1, zNear, NA, nb, 30);
  for (const cv of [L, R]) {
    groundStrip(cv, nb);
    for (let a = 10; a < NA; a++) for (let b = 0; b < nb; b++) cv.set(a, 0, b, hash2(a, b) < 0.4 ? W.soil : 0x8a6644);
  }
  // site fence, half-built frame and machinery on the right
  for (let b = 0; b < nb; b++) if (b % 6 === 0) R.box(14, 1, b, 14, 7, b, 0x8a8f9a); else { R.set(14, 6, b, 0x9aa0aa); R.set(14, 3, b, 0x9aa0aa); }
  R.collide(14, 14, 0, nb - 1, 8, 'solid', 'sitefence');
  for (let a = 30; a <= 60; a += 6) for (let b = 40; b <= 100; b += 6) R.box(a, 1, b, a, 26, b, 0xc8a46a);
  for (const y of [13, 26]) { R.box(30, y, 40, 60, y, 40, 0xc8a46a); R.box(30, y, 100, 60, y, 100, 0xc8a46a); R.box(30, y, 40, 30, y, 100, 0xc8a46a); }
  // excavator
  R.box(36, 1, 130, 48, 3, 146, 0x2a2a30);
  R.box(38, 4, 132, 46, 10, 144, 0xf2b32a);
  R.box(39, 7, 133, 39, 9, 137, 0x8ac0e0);
  for (let k = 0; k < 10; k++) R.box(36 - k, 10 + Math.floor(k * 0.6), 138, 36 - k, 11 + Math.floor(k * 0.6), 139, 0xf2b32a);
  // dirt heaps on the left lot and a pipe stack you can hop onto
  for (const [a, b, r] of [[30, 40, 10], [50, 110, 14], [28, 160, 9]]) {
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
      const hgt = Math.round((1 - Math.hypot(x, z) / r) * r * 0.7);
      for (let y = 1; y <= hgt; y++) L.set(a + x, y, b + z, hash2(x + a, z * y) < 0.3 ? 0x6a4a2e : W.soil);
    }
  }
  for (let k = 0; k < 3; k++) for (let b = 60; b < 84; b++) {
    for (const [da, dy] of [[0, 1], [3, 1], [6, 1], [1.5, 3], [4.5, 3], [3, 5]]) {
      const a = 14 + Math.round(da) + k * 0, y = dy;
      L.box(a, y, b, a + 2, y + 1, b, b === 60 || b === 83 ? 0x5a5e66 : 0x8a8f9a);
    }
  }
  L.collide(14, 22, 60, 83, 7, 'walk', 'pipes');
  // tree to soften it
  tree(L, 60, 20, rng.pick(['oak', 'pine'] as TreeKind[]), rng);
  finish([L, R], out.group as THREE.Group, out.colliders);

  // the road: barriers squeeze traffic into one lane, alternating sides, dirt kickers between
  const barrier = (x: number, z: number, w: number) => {
    const v = new Vox();
    for (let i = 0; i < w; i++) for (let y = 0; y < 8; y++) {
      const stripe = Math.floor((i + y) / 3) % 2 === 0;
      if (y < 3 && i % 6 > 1 && i % 6 < 4) continue;
      v.set(i, y, 0, y >= 3 ? (stripe ? 0xe8662a : 0xf4f1e8) : 0x4a4e58);
      if (y >= 3) v.set(i, y, 1, 0xd85a20);
    }
    v.set(0, 8, 0, 0xffb020).set(w - 1, 8, 0, 0xffb020);
    const m = voxMesh(v, [w / 2, 0, 1]);
    m.position.set(x, 0, z);
    out.group.add(m);
    out.colliders.push({ x0: x - w / 2, x1: x + w / 2, z0: z - 2, z1: z + 2, top: 9, kind: 'solid', tag: 'barrier' });
  };
  barrier(22, zNear - 40, 40);
  barrier(-22, zNear - 130, 40);
  barrier(22, zNear - 230, 40);
  barrier(-22, zNear - 320, 40);
  ramp(-20, zNear - 70, 24, 20, 10, out, 0x8a6644);
  ramp(20, zNear - 160, 24, 20, 12, out, 0x8a6644);
  ramp(-20, zNear - 260, 24, 20, 12, out, 0x8a6644);
  for (let z = 20; z < len; z += 22) out.spawns.push({ type: 'cone', x: (z % 44 < 22 ? 1 : -1) * 2, z: zNear - z });
  if (day >= 2) for (const z of [100, 200, 300]) out.spawns.push({ type: 'cone', x: (z % 200 === 0 ? -30 : 30), z: zNear - z - 10 });
  out.spawns.push({ type: 'birds', x: -70, z: zNear - 200, variant: 3 });
  return out;
}

export function buildFinish(zNear: number, len: number): Built {
  const out = emptyBuilt();
  const nb = len / CELL;
  const rng = new Rng(555);
  const L = new Canvas(-1, zNear, NA, nb, 40);
  const R = new Canvas(1, zNear, NA, nb, 40);
  for (const cv of [L, R]) {
    groundStrip(cv, nb);
    for (let i = 0; i < 4; i++) tree(cv, rng.int(20, 70), rng.int(8, nb - 8), rng.pick(['oak', 'maple', 'blossom'] as TreeKind[]), rng);
  }
  finish([L, R], out.group as THREE.Group, out.colliders);
  // finish arch: posts on the sidewalks, checkered banner overhead
  const v = new Vox();
  const span = (ROAD_HALF + 10) * 2;
  for (const x of [0, span - 3]) for (let y = 0; y < 58; y++) for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) v.set(x + i, y, k, y % 8 < 4 ? 0xd8322f : 0xf4f1e8);
  for (let x = 0; x < span; x++) for (let y = 48; y < 58; y++) v.set(x, y, 1, (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 0x1e1e24 : 0xf4f1e8);
  const arch = voxMesh(v, [span / 2, 0, 1.5]);
  arch.position.set(0, 0, zNear - 40);
  out.group.add(arch);
  return out;
}

function wxz(cv: Canvas, a: number, b: number) {
  const p = cv.at(a, b);
  return { x: p.x, z: p.z };
}

export type { Spawn, Target };
