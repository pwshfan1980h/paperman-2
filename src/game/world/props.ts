import { Canvas } from './canvas';
import { Rng, hash2, shade } from '../rng';

export const W = {
  grass: 0x5fae45,
  grass2: 0x57a23f,
  grassDark: 0x4a8d36,
  sidewalk: 0xcdc8bc,
  joint: 0xb5b0a4,
  curb: 0xdcd8ce,
  drive: 0xbfbab0,
  driveJoint: 0xaaa59a,
  paver: 0xc79c6e,
  paver2: 0xb58a5e,
  mulch: 0x6e4b33,
  soil: 0x7a5636,
  trunk: 0x6b4a2e,
  trunkDark: 0x553a22,
  leaf: [0x4e9a3a, 0x5aaa42, 0x438a33],
  autumn: [0xe0782a, 0xd8562a, 0xe8a033],
  maple: [0xc8352a, 0xb02a24, 0xd84a30],
  blossom: [0xf2a8c4, 0xe890b2, 0xf8c4d8],
  birchLeaf: [0x9cc44a, 0x8ab83e, 0xb0d058],
  pine: [0x2f6a3a, 0x285c32, 0x367a42],
  hedge: [0x3f8a35, 0x377d2f],
  white: 0xf4f1e8,
  stone: 0x9a958c,
  stone2: 0x86817a,
  water: 0x4aa0d8,
  water2: 0x5ab4e8,
  metal: 0x8a8f9a,
  darkMetal: 0x4a4e58,
  red: 0xd8322f,
  flowers: [0xe84a6a, 0xf2d03a, 0xf08a2a, 0xb05ad8, 0xffffff, 0x5a8ae8],
};

/** ground + sidewalk + curb for a lot-style strip */
export function groundStrip(cv: Canvas, nb: number, sidewalkTo = 9) {
  for (let b = 0; b < nb; b++) {
    cv.set(0, 0, b, W.curb);
    for (let a = 1; a <= sidewalkTo; a++) cv.set(a, 0, b, b % 8 === 0 || a === sidewalkTo ? W.joint : W.sidewalk);
    for (let a = sidewalkTo + 1; a < cv.na; a++) cv.set(a, 0, b, lawnColor(a, b));
  }
}

export function lawnColor(a: number, b: number): number {
  const stripe = Math.floor(b / 4) % 2 === 0;
  const n = hash2(Math.floor(a / 3), Math.floor(b / 3));
  if (n < 0.08) return W.grassDark;
  return stripe ? W.grass : W.grass2;
}

// ------------------------------------------------------------------ trees

export type TreeKind = 'oak' | 'pine' | 'birch' | 'maple' | 'autumn' | 'blossom' | 'bush';

export function tree(cv: Canvas, a: number, b: number, kind: TreeKind, rng: Rng, scale = 1) {
  if (kind === 'pine') return pine(cv, a, b, rng, scale);
  if (kind === 'bush') return bush(cv, a, b, rng.int(2, 3), rng);
  const trunkH = Math.round((kind === 'birch' ? 14 : 10) * scale);
  const birch = kind === 'birch';
  for (let y = 1; y <= trunkH; y++)
    cv.box(a, y, b, a + 1, y, b + 1, birch ? (hash2(y, a) < 0.25 ? 0x2a2a2a : W.white) : y % 3 ? W.trunk : W.trunkDark);
  // a branch or two
  cv.set(a + 2, trunkH - 2, b, W.trunk);
  cv.set(a - 1, trunkH - 1, b + 1, W.trunk);
  const leaves = kind === 'autumn' ? W.autumn : kind === 'maple' ? W.maple : kind === 'blossom' ? W.blossom : birch ? W.birchLeaf : W.leaf;
  const r = (birch ? 5 : 7.5) * scale;
  const cy = trunkH + r * 0.7;
  const blobs = [[0, 0, 0, r], [r * 0.5, -r * 0.2, r * 0.3, r * 0.75], [-r * 0.45, -r * 0.1, -r * 0.4, r * 0.7], [0, r * 0.35, 0, r * 0.7]];
  for (const [ox, oy, oz, rr] of blobs) {
    const cx = a + 1 + ox, cz = b + 1 + oz, yy = cy + oy;
    const ry = birch ? rr * 1.4 : rr * 0.85;
    for (let x = Math.floor(cx - rr); x <= Math.ceil(cx + rr); x++)
      for (let z = Math.floor(cz - rr); z <= Math.ceil(cz + rr); z++)
        for (let y = Math.floor(yy - ry); y <= Math.ceil(yy + ry); y++) {
          const d = ((x + 0.5 - cx) / rr) ** 2 + ((z + 0.5 - cz) / rr) ** 2 + ((y + 0.5 - yy) / ry) ** 2;
          if (d > 1) continue;
          const n = hash2(x * 7 + y, z * 13 - y);
          if (d > 0.75 && n < 0.35) continue; // ragged edge
          const shadeIdx = y > yy + ry * 0.3 ? 1 : n < 0.3 ? 2 : 0;
          cv.set(x, y, z, leaves[shadeIdx]);
        }
  }
  cv.collide(a, a + 1, b, b + 1, 60, 'solid', 'tree');
}

function pine(cv: Canvas, a: number, b: number, rng: Rng, scale: number) {
  const h = Math.round(rng.range(22, 30) * scale);
  for (let y = 1; y <= 4; y++) cv.box(a, y, b, a + 1, y, b + 1, W.trunk);
  for (let y = 4; y <= h; y++) {
    const t = (y - 4) / (h - 4);
    const layer = ((y - 4) % 5) / 5;
    const r = (1 - t) * 7 * scale * (1 - layer * 0.35) + 0.6;
    for (let x = Math.floor(-r); x <= Math.ceil(r); x++)
      for (let z = Math.floor(-r); z <= Math.ceil(r); z++) {
        if ((x + 0.5 - 1) ** 2 + (z + 0.5 - 1) ** 2 > r * r) continue;
        const n = hash2(x + a * 3 + y, z + b * 5);
        cv.set(a + x, y, b + z, W.pine[n < 0.2 ? 2 : layer > 0.6 ? 1 : 0]);
      }
  }
  cv.set(a, h + 1, b, W.pine[2]);
  cv.collide(a, a + 1, b, b + 1, 60, 'solid', 'tree');
}

export function bush(cv: Canvas, a: number, b: number, r: number, rng: Rng, flowers = rng.chance(0.4)) {
  const fc = rng.pick(W.flowers);
  for (let x = -r; x <= r; x++)
    for (let z = -r; z <= r; z++)
      for (let y = 1; y <= r + 1; y++) {
        const d = (x * x + z * z) / (r * r + 0.5) + ((y - 1) * (y - 1)) / ((r + 1) * (r + 1));
        if (d > 1) continue;
        const n = hash2(a + x * 3 + y, b + z * 7);
        cv.set(a + x, y, b + z, flowers && n < 0.12 && y > 1 ? fc : W.hedge[n < 0.4 ? 1 : 0]);
      }
}

// ------------------------------------------------------------------ fences

export type FenceKind = 'picket' | 'hedge' | 'stone' | 'rail' | 'none';

/** fence along the lawn's street edge at `a`, with gaps at the given b ranges */
export function fence(cv: Canvas, a: number, b0: number, b1: number, kind: FenceKind, gaps: [number, number][], color = W.white) {
  if (kind === 'none') return;
  const open = (b: number) => gaps.some(([g0, g1]) => b >= g0 && b <= g1);
  let runStart = -1;
  const flush = (end: number) => {
    if (runStart < 0) return;
    const h = kind === 'picket' ? 4 : kind === 'hedge' ? 5 : kind === 'stone' ? 3 : 3;
    cv.collide(a, kind === 'hedge' ? a + 1 : a, runStart, end, h + 1, kind === 'stone' ? 'walk' : 'solid', 'fence');
    runStart = -1;
  };
  for (let b = b0; b <= b1; b++) {
    if (open(b)) { flush(b - 1); continue; }
    if (runStart < 0) runStart = b;
    if (kind === 'picket') {
      cv.set(a, 2, b, color);
      cv.set(a, 3, b, color);
      if (b % 2 === 0) { cv.set(a, 1, b, color); cv.set(a, 4, b, color); }
      if (b % 8 === 0) cv.box(a, 1, b, a, 5, b, shade(color, 0.92));
    } else if (kind === 'hedge') {
      for (let y = 1; y <= 5; y++) for (let aa = a; aa <= a + 1; aa++) {
        const n = hash2(aa * 5 + y, b * 3);
        if (y === 5 && n < 0.3) continue;
        cv.set(aa, y, b, W.hedge[n < 0.45 ? 1 : 0]);
      }
    } else if (kind === 'stone') {
      for (let y = 1; y <= 3; y++) cv.set(a, y, b, hash2(b, y * 3) < 0.4 ? W.stone2 : W.stone);
      cv.set(a, 3, b, 0xb0aba2);
    } else if (kind === 'rail') {
      if (b % 6 === 0) cv.box(a, 1, b, a, 4, b, 0x8a6a48);
      cv.set(a, 3, b, 0x9a7a56);
      cv.set(a, 2, b, b % 6 === 0 ? 0x8a6a48 : 0);
      if (!(b % 6 === 0)) cv.clear(a, 2, b);
    }
  }
  flush(b1);
}

// ------------------------------------------------------------------ yard bits

export function flowerBed(cv: Canvas, a0: number, b0: number, a1: number, b1: number, rng: Rng) {
  const pal = [rng.pick(W.flowers), rng.pick(W.flowers)];
  for (let a = a0; a <= a1; a++)
    for (let b = b0; b <= b1; b++) {
      cv.set(a, 0, b, W.mulch);
      const n = hash2(a * 3, b * 5);
      if (n < 0.45) cv.set(a, 1, b, n < 0.18 ? pal[0] : n < 0.3 ? pal[1] : W.leaf[0]);
    }
}

export function gnome(cv: Canvas, a: number, b: number) {
  cv.set(a, 1, b, 0x3a6ad8);
  cv.set(a, 2, b, 0xf2c8a0);
  cv.set(a, 3, b, W.red);
}

export function flamingo(cv: Canvas, a: number, b: number) {
  cv.set(a, 1, b, 0x2a2a2a);
  cv.box(a, 2, b, a, 2, b + 1, 0xf080b0);
  cv.set(a, 3, b, 0xf080b0);
  cv.set(a, 4, b, 0xf080b0);
}

export function birdbath(cv: Canvas, a: number, b: number) {
  cv.set(a, 1, b, W.stone);
  cv.set(a, 2, b, W.stone);
  cv.box(a - 1, 3, b - 1, a + 1, 3, b + 1, W.stone);
  cv.set(a, 3, b, W.water2);
  cv.collide(a - 1, a + 1, b - 1, b + 1, 4, 'solid', 'birdbath');
}

export function bench(cv: Canvas, a: number, b0: number, len: number, color = 0x9a6a3a) {
  for (let b = b0; b < b0 + len; b++) {
    cv.box(a, 2, b, a + 1, 2, b, color);
    cv.set(a + 2, 3, b, color);
    cv.set(a + 2, 4, b, color);
  }
  for (const b of [b0, b0 + len - 1]) cv.box(a, 1, b, a + 2, 1, b, W.darkMetal);
  cv.collide(a, a + 2, b0, b0 + len - 1, 3, 'walk', 'bench');
}

export function trampoline(cv: Canvas, a: number, b: number) {
  const r = 5;
  for (let x = -r; x <= r; x++)
    for (let z = -r; z <= r; z++) {
      const d = Math.hypot(x, z);
      if (d > r + 0.3) continue;
      cv.set(a + x, 3, b + z, d > r - 1 ? 0x3a7ad8 : 0x2a2a30);
    }
  for (const [x, z] of [[-4, 0], [4, 0], [0, -4], [0, 4]]) cv.box(a + x, 1, b + z, a + x, 2, b + z, W.darkMetal);
  cv.collide(a - r, a + r, b - r, b + r, 4, 'walk', 'trampoline');
}

export function swingSet(cv: Canvas, a: number, b: number) {
  for (const bb of [b, b + 10]) {
    cv.box(a - 2, 1, bb, a - 2, 9, bb, 0xd8a03a);
    cv.box(a + 2, 1, bb, a + 2, 9, bb, 0xd8a03a);
    cv.box(a - 1, 10, bb, a + 1, 10, bb, 0xd8a03a);
  }
  cv.box(a, 10, b, a, 10, b + 10, 0xc83a2a);
  for (const bb of [b + 3, b + 7]) {
    cv.box(a, 5, bb, a, 9, bb, 0x6a6a72);
    cv.set(a, 4, bb, 0x2a6ad8);
  }
  cv.collide(a - 2, a + 2, b, b + 10, 11, 'solid', 'swing');
}

export function hoop(cv: Canvas, a: number, b: number) {
  cv.box(a, 1, b, a, 13, b, W.darkMetal);
  cv.box(a - 1, 12, b - 2, a - 1, 15, b + 2, W.white);
  cv.paint(a - 1, 13, b - 1, a - 1, 14, b + 1, W.red);
  cv.box(a - 2, 12, b - 1, a - 3, 12, b + 1, 0xe8662a);
  cv.collide(a, a, b, b, 16, 'solid', 'hoop');
}

export function kiddiePool(cv: Canvas, a: number, b: number) {
  const r = 3;
  for (let x = -r; x <= r; x++)
    for (let z = -r; z <= r; z++) {
      const d = Math.hypot(x, z);
      if (d > r + 0.3) continue;
      cv.set(a + x, 1, b + z, d > r - 1 ? 0x4ac0e8 : W.water2);
    }
}

export function lampPost(cv: Canvas, a: number, b: number) {
  cv.box(a, 1, b, a, 14, b, 0x2a2e36);
  cv.box(a - 1, 15, b - 1, a + 1, 16, b + 1, 0x2a2e36);
  cv.set(a, 15, b, 0xfff2b0);
  cv.collide(a, a, b, b, 17, 'solid', 'lamp');
}

export function sign(cv: Canvas, a: number, b: number, color: number, text: number) {
  cv.box(a, 1, b, a, 5, b, 0x8a6a48);
  cv.box(a, 5, b - 2, a, 8, b + 2, color);
  cv.paint(a, 6, b - 1, a, 7, b + 1, text);
}

export function wheelbarrow(cv: Canvas, a: number, b: number) {
  cv.box(a, 2, b, a + 2, 2, b + 3, 0x2a8a4a);
  cv.box(a, 3, b, a, 3, b + 3, 0x2a8a4a);
  cv.box(a + 2, 3, b, a + 2, 3, b + 3, 0x2a8a4a);
  cv.set(a + 1, 1, b + 4, 0x2a2a2a);
}
