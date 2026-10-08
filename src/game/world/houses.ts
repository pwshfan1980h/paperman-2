import * as THREE from 'three';
import { Canvas, ColorFn } from './canvas';
import { Rng, hash2, shade } from '../rng';
import { CELL, Target } from './types';
import { W, bush } from './props';

/** One storey, in cells (28 world units, a little under the rider's height on the bike). */
export const STORY = 14;

export type Siding = 'lap' | 'brick' | 'shingle' | 'batten' | 'stucco' | 'wood' | 'scale';

export interface HouseCtx {
  cv: Canvas;
  rng: Rng;
  targets: Target[];
  id: number;
}

export interface HouseResult {
  /** facade plane, cells outward from the curb */
  front: number;
  /** door centre along b */
  doorB: number;
  /** driveway b range, if any */
  drive?: [number, number];
  /** where a car can park on the drive (a, b) */
  carSpot?: [number, number];
  /** b range the house occupies */
  span: [number, number];
  depth: number;
  style: string;
  color: number;
}

export type Fn3 = (a: number, y: number, b: number) => number;

export function siding(kind: Siding, base: number): Fn3 {
  const mortar = 0xd2c9bc;
  switch (kind) {
    case 'lap': return (_a, y) => (y % 2 === 0 ? base : shade(base, 0.92));
    case 'brick': return (a, y, b) => {
      if (y % 3 === 0) return mortar;
      const off = Math.floor(y / 3) % 2 ? 2 : 0;
      if ((a + b + off) % 4 === 0) return mortar;
      return hash2(a + b * 3, y) < 0.3 ? shade(base, 0.9) : base;
    };
    case 'shingle': return (a, y, b) => (y % 2 === 0 ? (hash2(a + b, y) < 0.3 ? shade(base, 0.95) : base) : shade(base, 0.9));
    case 'batten': return (a, _y, b) => ((a + b) % 3 === 0 ? shade(base, 0.86) : base);
    case 'stucco': return (a, y, b) => (hash2(a * 7 + b, y * 3) < 0.25 ? shade(base, 0.96) : base);
    case 'wood': return (_a, y) => (y % 2 ? base : shade(base, 0.84));
    case 'scale': return (a, y, b) => (y % 2 === 0 && (a + b) % 2 === 0 ? shade(base, 0.84) : base);
  }
}

const roofStripe = (c: number): ColorFn => (_a, y) => (y % 2 === 0 ? c : shade(c, 0.9));

// ---------------------------------------------------------------- massing

export function mass(h: HouseCtx, A: number, B: number, D: number, Wd: number, y0: number, y1: number, wall: ColorFn, trim: number, foundation = true) {
  const { cv } = h;
  cv.box(A, y0, B, A + D - 1, y1, B + Wd - 1, wall);
  // corner boards on the two visible edges
  for (let y = y0; y <= y1; y++) {
    cv.set(A, y, B, trim);
    cv.set(A, y, B + Wd - 1, trim);
  }
  if (foundation && y0 === 1) cv.paint(A, 1, B, A + D - 1, 1, B + Wd - 1, (a, _y, b) => (hash2(a, b) < 0.3 ? W.stone2 : W.stone));
}

// ---------------------------------------------------------------- windows & doors

export interface WinOpts {
  trim: number;
  shutter?: number;
  lit?: boolean;
  mull?: boolean;
  target?: boolean;
}

function glass(lit: boolean | undefined, u: number, v: number, w: number, hgt: number): number {
  if (lit) return v === hgt - 1 ? 0xffe8b0 : 0xffd27a;
  if ((u + (hgt - 1 - v)) % 5 === 0) return 0xc8e6f6;
  return v >= hgt - 2 ? 0x9ccde8 : 0x7fb4d6;
}

/** Window on the street facade (plane a = A). */
export function winFront(h: HouseCtx, A: number, b0: number, y0: number, w: number, hgt: number, o: WinOpts) {
  const { cv } = h;
  for (let b = b0 - 1; b <= b0 + w; b++) for (let y = y0 - 1; y <= y0 + hgt; y++) cv.set(A, y, b, o.trim);
  for (let b = b0; b < b0 + w; b++)
    for (let y = y0; y < y0 + hgt; y++) {
      cv.clear(A, y, b);
      cv.set(A + 1, y, b, glass(o.lit, b - b0, y - y0, w, hgt));
    }
  if (o.mull && w >= 4) {
    const bm = b0 + Math.floor(w / 2);
    for (let y = y0; y < y0 + hgt; y++) cv.set(A + 1, y, bm, o.trim);
    for (let b = b0; b < b0 + w; b++) cv.set(A + 1, y0 + Math.floor(hgt / 2), b, o.trim);
  }
  for (let b = b0 - 1; b <= b0 + w; b++) cv.set(A - 1, y0 - 1, b, o.trim);
  if (o.shutter !== undefined)
    for (let y = y0; y < y0 + hgt; y++) {
      cv.set(A, y, b0 - 2, (y - y0) % 2 ? o.shutter : shade(o.shutter, 0.85));
      cv.set(A, y, b0 + w + 1, (y - y0) % 2 ? o.shutter : shade(o.shutter, 0.85));
    }
  if (o.target !== false) {
    const r = cv.rect(A - 1, A + 1, b0, b0 + w - 1);
    const facadeX = cv.side * (cv.aOffset + A * CELL);
    h.targets.push({
      kind: 'window', house: h.id,
      box: new THREE.Box3(new THREE.Vector3(r.x0, y0 * CELL, r.z0), new THREE.Vector3(r.x1, (y0 + hgt) * CELL, r.z1)),
      face: { x: facadeX, side: cv.side, z0: r.z0, z1: r.z1, y0: y0 * CELL, y1: (y0 + hgt) * CELL },
    });
  }
}

/** Window on the near gable/side wall (plane b = B), the side the camera sees. */
export function winSide(h: HouseCtx, B: number, a0: number, y0: number, w: number, hgt: number, o: WinOpts) {
  const { cv } = h;
  for (let a = a0 - 1; a <= a0 + w; a++) for (let y = y0 - 1; y <= y0 + hgt; y++) cv.set(a, y, B, o.trim);
  for (let a = a0; a < a0 + w; a++)
    for (let y = y0; y < y0 + hgt; y++) {
      cv.clear(a, y, B);
      cv.set(a, y, B + 1, glass(o.lit, a - a0, y - y0, w, hgt));
    }
  for (let a = a0 - 1; a <= a0 + w; a++) cv.set(a, y0 - 1, B - 1, o.trim);
}

export function door(h: HouseCtx, A: number, b0: number, color: number, trim: number, w = 4, hgt = 10, stoop = true) {
  const { cv } = h;
  for (let b = b0 - 1; b <= b0 + w; b++) for (let y = 1; y <= hgt + 1; y++) cv.set(A, y, b, trim);
  for (let b = b0; b < b0 + w; b++)
    for (let y = 1; y <= hgt; y++) {
      cv.clear(A, y, b);
      const panel = (y === 3 || y === 7) && b > b0 && b < b0 + w - 1;
      cv.set(A + 1, y, b, y === hgt ? 0xffe2a0 : panel ? shade(color, 0.82) : color);
    }
  cv.set(A, 5, b0 + w - 1, 0xe8c040); // knob
  if (stoop) {
    cv.box(A - 3, 1, b0 - 1, A - 1, 1, b0 + w, 0xcac4b8);
    cv.paint(A - 2, 1, b0, A - 2, 1, b0 + w - 1, 0x9a5e3a); // mat
  }
  const r = cv.rect(A - 13, A + 1, b0 - 6, b0 + w + 5);
  h.targets.push({ kind: 'door', house: h.id, box: new THREE.Box3(new THREE.Vector3(r.x0, -2, r.z0), new THREE.Vector3(r.x1, 30, r.z1)) });
}

// ---------------------------------------------------------------- roofs

/** Gable roof. ridge 'b' runs along the street (side gable), 'a' runs away from it (front gable). Returns top cell. */
export function gable(h: HouseCtx, A: number, B: number, D: number, Wd: number, yBase: number, ridge: 'a' | 'b', pitch: number, roof: number, gableWall: ColorFn, trim: number, over = 1): number {
  const { cv } = h;
  const thick = Math.max(1, Math.ceil(pitch)) + 1;
  const rc = roofStripe(roof);
  let maxTop = 0;
  for (let a = A - over; a <= A + D - 1 + over; a++)
    for (let b = B - over; b <= B + Wd - 1 + over; b++) {
      const dist = ridge === 'b' ? Math.abs(a + 0.5 - (A + D / 2)) : Math.abs(b + 0.5 - (B + Wd / 2));
      const half = (ridge === 'b' ? D / 2 : Wd / 2) + over;
      const top = yBase + Math.max(1, Math.ceil((half - dist) * pitch));
      maxTop = Math.max(maxTop, top);
      const inFoot = a >= A && a <= A + D - 1 && b >= B && b <= B + Wd - 1;
      const edge = ridge === 'b' ? a === A - over || a === A + D - 1 + over : b === B - over || b === B + Wd - 1 + over;
      for (let y = yBase; y < top; y++) {
        if (y >= top - thick) cv.set(a, y, b, edge && y === top - 1 ? trim : rc);
        else if (inFoot) cv.set(a, y, b, gableWall);
      }
    }
  // vent in the visible gable
  if (ridge === 'b') {
    const ac = Math.floor(A + D / 2) - 1;
    cv.box(ac, maxTop - 4, B, ac + 1, maxTop - 3, B, trim);
  } else {
    const bc = Math.floor(B + Wd / 2) - 1;
    cv.box(A, maxTop - 5, bc, A, maxTop - 4, bc + 1, trim);
  }
  return maxTop;
}

export function hip(h: HouseCtx, A: number, B: number, D: number, Wd: number, yBase: number, pitch: number, roof: number, trim: number, over = 1, cap = 99): number {
  const { cv } = h;
  const thick = Math.max(1, Math.ceil(pitch)) + 1;
  const rc = roofStripe(roof);
  let maxTop = 0;
  for (let a = A - over; a <= A + D - 1 + over; a++)
    for (let b = B - over; b <= B + Wd - 1 + over; b++) {
      const dA = Math.min(a - (A - over), A + D - 1 + over - a) + 0.5;
      const dB = Math.min(b - (B - over), B + Wd - 1 + over - b) + 0.5;
      const top = yBase + Math.min(cap, Math.max(1, Math.ceil(Math.min(dA, dB) * pitch)));
      maxTop = Math.max(maxTop, top);
      for (let y = Math.max(yBase, top - thick); y < top; y++) cv.set(a, y, b, Math.min(dA, dB) < 1 && y === top - 1 ? trim : rc);
      for (let y = yBase; y < top - thick; y++) cv.set(a, y, b, roof);
    }
  return maxTop;
}

export function flat(h: HouseCtx, A: number, B: number, D: number, Wd: number, y: number, roof: number, parapet: number) {
  const { cv } = h;
  cv.box(A, y, B, A + D - 1, y, B + Wd - 1, roof);
  for (let a = A; a < A + D; a++) { cv.set(a, y + 1, B, parapet); cv.set(a, y + 1, B + Wd - 1, parapet); }
  for (let b = B; b < B + Wd; b++) { cv.set(A, y + 1, b, parapet); cv.set(A + D - 1, y + 1, b, parapet); }
  return y + 2;
}

export function chimney(h: HouseCtx, a: number, b: number, top: number, brick = 0xa8503a) {
  const f = siding('brick', brick);
  h.cv.box(a, 1, b, a + 2, top, b + 2, f);
  h.cv.box(a - 1, top + 1, b - 1, a + 3, top + 1, b + 3, 0x7a7068);
  h.cv.carve(a + 1, top + 1, b + 1, a + 1, top + 1, b + 1);
}

export function porch(h: HouseCtx, A: number, b0: number, b1: number, depth: number, yRoof: number, o: { floor: number; column: number; roof: number; trim: number; rail?: boolean; stoneBase?: boolean; gapB?: [number, number] }) {
  const { cv } = h;
  const a0 = A - depth;
  cv.box(a0, 1, b0, A - 1, 1, b1, (a, _y, b) => ((a + b) % 2 ? o.floor : shade(o.floor, 0.92)));
  const cols: number[] = [b0, b1];
  if (b1 - b0 > 16) cols.push(Math.round((b0 + b1) / 2));
  for (const b of cols) {
    if (o.stoneBase) {
      cv.box(a0, 2, b, a0 + 1, 5, b + (b === b1 ? -1 : 1), (a, y, bb) => (hash2(a + bb, y) < 0.4 ? W.stone2 : W.stone));
      cv.box(a0, 6, b, a0, yRoof - 1, b, o.column);
    } else cv.box(a0, 2, b, a0, yRoof - 1, b, o.column);
  }
  if (o.rail)
    for (let b = b0; b <= b1; b++) {
      if (o.gapB && b >= o.gapB[0] && b <= o.gapB[1]) continue;
      cv.set(a0, 4, b, o.trim);
      if (b % 2 === 0) cv.set(a0, 3, b, o.trim);
      cv.set(a0, 2, b, o.trim);
    }
  cv.box(a0 - 1, yRoof, b0 - 1, A - 1, yRoof, b1 + 1, roofStripe(o.roof));
  for (let b = b0 - 1; b <= b1 + 1; b++) cv.set(a0 - 1, yRoof, b, o.trim);
  cv.box(a0 - 1, yRoof + 1, b0 - 1, A - 3, yRoof + 1, b1 + 1, roofStripe(o.roof));
  cv.collide(a0, A - 1, b0, b1, 2, 'walk', 'porch');
  for (const b of cols) cv.collide(a0, a0, b, b, yRoof + 1, 'solid', 'column');
}

function garageDoor(h: HouseCtx, A: number, b0: number, w: number, color: number, trim: number, hgt = 9) {
  const { cv } = h;
  for (let b = b0 - 1; b <= b0 + w; b++) for (let y = 1; y <= hgt + 1; y++) cv.set(A, y, b, trim);
  for (let b = b0; b < b0 + w; b++)
    for (let y = 1; y <= hgt; y++) {
      cv.clear(A, y, b);
      const win = y === hgt - 1 && (b - b0) % 3 !== 2;
      cv.set(A + 1, y, b, win ? 0x5a7a96 : y % 2 ? color : shade(color, 0.9));
    }
}

function foundationBushes(h: HouseCtx, A: number, b0: number, b1: number, skip: [number, number][]) {
  for (let b = b0 + 2; b <= b1 - 2; b += h.rng.int(4, 6)) {
    if (skip.some(([s0, s1]) => b >= s0 - 3 && b <= s1 + 3)) continue;
    bush(h.cv, A - 3, b, 2, h.rng);
  }
}

// ---------------------------------------------------------------- styles

export interface StyleOpts {
  wall: number;
  trim: number;
  roof: number;
  door: number;
  shutter?: number;
  lit: boolean;
}

type StyleFn = (h: HouseCtx, o: StyleOpts) => HouseResult;

export const STYLES: Record<string, StyleFn> = {
  ranch(h, o) {
    const { rng } = h;
    const A = rng.int(26, 30), D = 20;
    const garageNear = rng.chance(0.5);
    const mainB = garageNear ? 19 : 6, gB = garageNear ? 6 : 34;
    const brickBase = rng.chance(0.5);
    const lap = siding('lap', o.wall);
    const brick = siding('brick', 0xa8583e);
    const wall: ColorFn = brickBase ? (a, y, b) => (y <= 5 ? brick(a, y, b) : lap(a, y, b)) : lap;
    mass(h, A, mainB, D, 28, 1, 12, wall, o.trim);
    mass(h, A + 2, gB, D - 2, 13, 1, 11, wall, o.trim);
    const top = hip(h, A, mainB, D, 28, 13, 0.45, o.roof, o.trim, 2);
    hip(h, A + 2, gB, D - 2, 13, 12, 0.45, o.roof, o.trim, 1);
    garageDoor(h, A + 2, gB + 2, 9, o.trim, shade(o.trim, 0.9));
    const doorB = mainB + (garageNear ? 4 : 20);
    door(h, A, doorB, o.door, o.trim);
    winFront(h, A, garageNear ? mainB + 11 : mainB + 4, 4, 10, 6, { trim: o.trim, lit: o.lit, mull: true });
    winFront(h, A, garageNear ? mainB + 23 : mainB + 15, 5, 3, 5, { trim: o.trim, shutter: o.shutter, lit: false });
    winSide(h, garageNear ? gB : mainB, A + 7, 5, 4, 5, { trim: o.trim, lit: o.lit });
    foundationBushes(h, A, mainB, mainB + 27, [[doorB, doorB + 4]]);
    h.cv.collide(A, A + D - 1, Math.min(mainB, gB), Math.max(mainB + 27, gB + 12), top, 'solid', 'house');
    return { front: A, doorB: doorB + 2, drive: [gB + 1, gB + 11], carSpot: [A - 8, gB + 6], span: [Math.min(mainB, gB), Math.max(mainB + 27, gB + 12)], depth: D, style: 'Ranch', color: o.wall };
  },

  colonial(h, o) {
    const A = h.rng.int(30, 33), B = 12, D = 22, Wd = 32;
    const wall = siding(h.rng.chance(0.3) ? 'brick' : 'lap', o.wall);
    mass(h, A, B, D, Wd, 1, STORY * 2, wall, o.trim);
    // belt course between floors
    h.cv.paint(A, STORY + 1, B, A, STORY + 1, B + Wd - 1, o.trim);
    const top = gable(h, A, B, D, Wd, STORY * 2 + 1, 'b', 0.7, o.roof, wall, o.trim, 2);
    chimney(h, A + 9, B + Wd, top + 2);
    const doorB = B + 14;
    for (const b of [B + 3, B + 8, B + 20, B + 25]) winFront(h, A, b, 4, 4, 7, { trim: o.trim, shutter: o.shutter, lit: o.lit && b < B + 10, mull: true });
    for (const b of [B + 3, B + 8, B + 14, B + 20, B + 25]) winFront(h, A, b, STORY + 4, 4, 7, { trim: o.trim, shutter: o.shutter, mull: true });
    door(h, A, doorB, o.door, o.trim);
    // portico with a little pediment
    porch(h, A, doorB - 3, doorB + 6, 4, 13, { floor: 0xcac4b8, column: o.trim, roof: o.roof, trim: o.trim });
    gable(h, A - 5, doorB - 4, 5, 12, 14, 'a', 0.6, o.roof, o.trim, o.trim, 0);
    winSide(h, B, A + 8, 5, 4, 6, { trim: o.trim, lit: o.lit });
    winSide(h, B, A + 8, STORY + 5, 4, 6, { trim: o.trim });
    foundationBushes(h, A, B, B + Wd - 1, [[doorB - 3, doorB + 6]]);
    h.cv.collide(A, A + D - 1, B, B + Wd - 1, top, 'solid', 'house');
    return { front: A, doorB: doorB + 2, drive: [48, 58], carSpot: [A - 2, 53], span: [B, B + Wd - 1], depth: D, style: 'Colonial', color: o.wall };
  },

  craftsman(h, o) {
    const A = h.rng.int(32, 35), B = 8, D = 26, Wd = 30;
    const wall = siding('lap', o.wall);
    mass(h, A, B, D, Wd, 1, STORY, wall, o.trim);
    const top = gable(h, A, B, D, Wd, STORY + 1, 'a', 0.62, o.roof, siding('batten', shade(o.wall, 1.08)), o.trim, 2);
    const doorB = B + 18;
    porch(h, A, B + 1, B + Wd - 2, 7, STORY, { floor: 0x8a6a4a, column: o.trim, roof: o.roof, trim: o.trim, stoneBase: true });
    door(h, A, doorB, o.door, o.trim, 4, 10, false);
    winFront(h, A, B + 5, 4, 8, 7, { trim: o.trim, lit: o.lit, mull: true });
    winFront(h, A, B + 12, STORY + 5, 6, 4, { trim: o.trim, mull: true });
    winSide(h, B, A + 6, 4, 5, 6, { trim: o.trim, lit: o.lit, mull: true });
    winSide(h, B, A + 16, 4, 4, 6, { trim: o.trim });
    chimney(h, A + 14, B - 3, top - 4, 0x8a7060);
    h.cv.collide(A, A + D - 1, B, B + Wd - 1, top, 'solid', 'house');
    return { front: A - 7, doorB: doorB + 2, drive: [44, 54], carSpot: [A + 2, 49], span: [B, B + Wd - 1], depth: D, style: 'Craftsman', color: o.wall };
  },

  cape(h, o) {
    const A = h.rng.int(30, 32), B = 14, D = 22, Wd = 30;
    const wall = siding('shingle', o.wall);
    mass(h, A, B, D, Wd, 1, 11, wall, o.trim);
    const top = gable(h, A, B, D, Wd, 12, 'b', 1.0, o.roof, wall, o.trim, 1);
    const doorB = B + 13;
    door(h, A, doorB, o.door, o.trim);
    for (const b of [B + 4, B + 21]) winFront(h, A, b, 4, 4, 6, { trim: o.trim, shutter: o.shutter, lit: o.lit && b < 20, mull: true });
    // dormers
    for (const b of [B + 5, B + 20]) {
      h.cv.box(A + 3, 12, b - 1, A + 9, 17, b + 4, wall);
      winFront(h, A + 3, b, 13, 4, 4, { trim: o.trim, mull: true, target: false });
      gable(h, A + 3, b - 1, 7, 6, 18, 'a', 1.0, o.roof, wall, o.trim, 1);
    }
    chimney(h, A + 10, B + Wd - 4, top + 1);
    winSide(h, B, A + 8, 14, 4, 5, { trim: o.trim });
    foundationBushes(h, A, B, B + Wd - 1, [[doorB, doorB + 4]]);
    h.cv.collide(A, A + D - 1, B, B + Wd - 1, top, 'solid', 'house');
    return { front: A, doorB: doorB + 2, drive: [2, 12], carSpot: [A + 4, 7], span: [B, B + Wd - 1], depth: D, style: 'Cape Cod', color: o.wall };
  },

  modern(h, o) {
    const A = h.rng.int(28, 31), B = 8;
    const wall = siding('stucco', o.wall);
    const dark = 0x3a3c44;
    mass(h, A, B, 24, 38, 1, 13, wall, o.wall, false);
    const top1 = flat(h, A, B, 24, 38, 14, 0x5a5c64, dark);
    mass(h, A + 4, B + 14, 18, 22, 15, 26, siding('stucco', dark), dark, false);
    const top = flat(h, A + 4, B + 14, 18, 22, 27, 0x5a5c64, o.wall);
    // cedar accent around the entry
    h.cv.box(A, 1, B + 16, A, 13, B + 23, siding('batten', 0xb4743e));
    const doorB = B + 18;
    door(h, A, doorB, 0x2a2a30, 0x2a2a30, 4, 11);
    winFront(h, A, B + 25, 3, 11, 8, { trim: dark, lit: o.lit, mull: true });
    winFront(h, A + 4, B + 16, 18, 16, 5, { trim: o.wall, lit: false });
    // flush garage
    garageDoor(h, A, B + 3, 10, 0x4a4c54, dark, 10);
    winSide(h, B, A + 6, 5, 12, 5, { trim: dark, lit: o.lit });
    h.cv.collide(A, A + 23, B, B + 37, Math.max(top, top1), 'solid', 'house');
    return { front: A, doorB: doorB + 2, drive: [B + 2, B + 13], carSpot: [A - 8, B + 8], span: [B, B + 37], depth: 24, style: 'Modern', color: o.wall };
  },

  victorian(h, o) {
    const A = h.rng.int(32, 35), B = 16, D = 24, Wd = 26;
    const wall = siding('lap', o.wall);
    mass(h, A, B, D, Wd, 1, STORY * 2, wall, o.trim);
    const top = gable(h, A, B, D, Wd, STORY * 2 + 1, 'a', 1.15, o.roof, siding('scale', shade(o.wall, 0.9)), o.trim, 2);
    // turret on the near corner
    const tc = [A + 2, B - 1], r = 5.5;
    let tTop = 0;
    for (let a = Math.floor(tc[0] - r); a <= Math.ceil(tc[0] + r); a++)
      for (let b = Math.floor(tc[1] - r); b <= Math.ceil(tc[1] + r); b++) {
        const d = Math.hypot(a + 0.5 - tc[0], b + 0.5 - tc[1]);
        if (d > r + 1.2) continue;
        if (d <= r) for (let y = 1; y <= STORY * 2 + 3; y++) h.cv.set(a, y, b, wall(a, y, b));
        const ct = STORY * 2 + 4 + Math.ceil((r + 1.2 - d) * 1.9);
        tTop = Math.max(tTop, ct);
        for (let y = STORY * 2 + 4; y < ct; y++) if (y >= ct - 3) h.cv.set(a, y, b, (y % 2 ? o.roof : shade(o.roof, 0.88)));
      }
    h.cv.set(Math.floor(tc[0]), tTop, Math.floor(tc[1]), 0xe8c040);
    for (const y0 of [5, STORY + 5]) {
      winFront(h, Math.floor(tc[0] - r) + 1, Math.floor(tc[1]) - 1, y0, 3, 7, { trim: o.trim, lit: o.lit && y0 === 5, target: y0 === 5 });
    }
    const doorB = B + 14;
    porch(h, A, B + 4, B + Wd - 1, 6, STORY, { floor: 0x9a7a5a, column: o.trim, roof: o.roof, trim: o.trim, rail: true, gapB: [doorB, doorB + 3] });
    door(h, A, doorB, o.door, o.trim, 4, 11, false);
    winFront(h, A, B + 21, 4, 3, 8, { trim: o.trim, lit: o.lit });
    for (const b of [B + 8, B + 15, B + 21]) winFront(h, A, b, STORY + 4, 3, 8, { trim: o.trim });
    winFront(h, A, B + 11, STORY * 2 + 4, 4, 5, { trim: o.trim, target: false });
    chimney(h, A + 15, B + Wd - 3, top - 2, 0x9a4a3a);
    h.cv.collide(A, A + D - 1, B - 6, B + Wd - 1, Math.max(top, tTop), 'solid', 'house');
    return { front: A - 6, doorB: doorB + 2, drive: [50, 60], carSpot: [A + 2, 55], span: [B - 6, B + Wd - 1], depth: D, style: 'Victorian', color: o.wall };
  },

  splitLevel(h, o) {
    const A = h.rng.int(28, 31), B = 6;
    const wall = siding(h.rng.chance(0.5) ? 'batten' : 'lap', o.wall);
    const brick = siding('brick', 0x9a5a40);
    // two-storey half with the garage underneath
    mass(h, A, B, 22, 18, 1, 24, (a, y, b) => (y <= 11 ? brick(a, y, b) : wall(a, y, b)), o.trim);
    const t1 = hip(h, A, B, 22, 18, 25, 0.5, o.roof, o.trim, 2);
    garageDoor(h, A, B + 4, 10, 0xe8e2d4, o.trim);
    winFront(h, A, B + 5, 15, 8, 6, { trim: o.trim, mull: true, lit: o.lit });
    // raised single-storey half, set back
    const A2 = A + 3;
    mass(h, A2, B + 18, 20, 20, 1, 16, wall, o.trim);
    const t2 = gable(h, A2, B + 18, 20, 20, 17, 'b', 0.5, o.roof, wall, o.trim, 2);
    const doorB = B + 21;
    h.cv.box(A2 - 4, 1, doorB - 1, A2 - 1, 2, doorB + 4, 0xcac4b8);
    door(h, A2, doorB, o.door, o.trim, 4, 10, false);
    winFront(h, A2, B + 28, 6, 7, 6, { trim: o.trim, shutter: o.shutter, mull: true });
    winSide(h, B, A + 6, 15, 5, 5, { trim: o.trim });
    foundationBushes(h, A2, B + 18, B + 37, [[doorB, doorB + 4]]);
    h.cv.collide(A, A + 22, B, B + 37, Math.max(t1, t2), 'solid', 'house');
    return { front: A, doorB: doorB + 2, drive: [B + 3, B + 14], carSpot: [A - 8, B + 9], span: [B, B + 37], depth: 22, style: 'Split-Level', color: o.wall };
  },

  aframe(h, o) {
    const A = h.rng.int(32, 34), B = 18, D = 26, Wd = 24;
    const wood = siding('wood', 0x9a6a42);
    const top = gable(h, A, B, D, Wd, 1, 'a', 1.9, o.roof, wood, 0x6a4a2e, 1);
    // glazed front triangle
    for (let b = B + 3; b < B + Wd - 3; b++)
      for (let y = 2; y < top - 4; y++) {
        const half = Wd / 2 - 3;
        const dist = Math.abs(b + 0.5 - (B + Wd / 2));
        if ((half - dist) * 1.9 < y - 1) continue;
        const frame = (b - B) % 5 === 0 || y % 7 === 0;
        h.cv.set(A, y, b, frame ? 0x6a4a2e : glass(o.lit && y < 12, b, y, 1, 99));
      }
    const doorB = B + 10;
    door(h, A, doorB, o.door, 0x6a4a2e, 4, 10, false);
    // deck
    h.cv.box(A - 6, 1, B - 1, A - 1, 1, B + Wd, (a, _y, b) => ((a + b) % 2 ? 0xa87a4e : 0x9a6e44));
    for (let b = B - 1; b <= B + Wd; b++) if (b < doorB - 1 || b > doorB + 4) { h.cv.set(A - 6, 2, b, 0x8a5e3a); h.cv.set(A - 6, 3, b, 0x8a5e3a); }
    h.cv.collide(A - 6, A - 1, B - 1, B + Wd, 2, 'walk', 'deck');
    h.targets.push({
      kind: 'window', house: h.id,
      box: (() => { const r = h.cv.rect(A - 1, A + 1, B + 4, B + Wd - 5); return new THREE.Box3(new THREE.Vector3(r.x0, 14, r.z0), new THREE.Vector3(r.x1, 34, r.z1)); })(),
      face: (() => { const r = h.cv.rect(A, A, B + 4, B + Wd - 5); return { x: h.cv.side * (h.cv.aOffset + A * CELL), side: h.cv.side, z0: r.z0, z1: r.z1, y0: 14, y1: 34 }; })(),
    });
    h.cv.box(A + 16, top - 8, B + 4, A + 16, top + 2, B + 4, 0x3a3a40); // stovepipe
    h.cv.collide(A, A + D - 1, B, B + Wd - 1, top, 'solid', 'house');
    return { front: A - 6, doorB: doorB + 2, drive: [4, 14], carSpot: [A - 4, 9], span: [B, B + Wd - 1], depth: D, style: 'A-Frame', color: o.wall };
  },
};

export interface Palette { wall: number[]; trim: number[]; roof: number[]; door: number[]; shutter: number[] }

export const STYLE_PALETTES: Record<string, Palette> = {
  ranch: { wall: [0xd8c8a0, 0xa8b89a, 0x9ab4c8, 0xe0d4bc, 0xc8a888], trim: [0xf4f0e6, 0xe8e0cc], roof: [0x6a5a4e, 0x4e4e56, 0x7a4a3a], door: [0xb83a2a, 0x2a5a8a, 0x3a6a3a], shutter: [0x3a5a3a, 0x5a3a2a, 0x2a3a5a] },
  colonial: { wall: [0xf2eee4, 0xf0deb0, 0xc8d8e0, 0xb84a3a], trim: [0xf8f6f0], roof: [0x3a3c44, 0x4a4248], door: [0x2a2a30, 0xa82a2a, 0x2a4a3a], shutter: [0x1e2a24, 0x2a3a5a, 0x7a2a2a] },
  craftsman: { wall: [0x7a8a5a, 0x8a6a4a, 0xa86a4a, 0x5a7a7a], trim: [0xf0e6cc, 0xe8dcc0], roof: [0x5a4a3e, 0x3e4a3e], door: [0x7a4a2a, 0x9a5a2a], shutter: [0x5a4a3a] },
  cape: { wall: [0xa8b4bc, 0xf2f0e8, 0x8aa0b8, 0xd8d0c0], trim: [0xf8f6f0], roof: [0x4a4c54, 0x5a5048], door: [0xc83a2a, 0x2a4a7a, 0xe8c040], shutter: [0x2a3a5a, 0x2a4a3a, 0x1e1e24] },
  modern: { wall: [0xf2f2ee, 0xd8d4cc, 0xe8e2d6], trim: [0x2a2a30], roof: [0x3a3c44], door: [0x2a2a30], shutter: [0x2a2a30] },
  victorian: { wall: [0xb89ad0, 0x6ab8b0, 0xe8c050, 0xf0a0b0, 0x8ab8e0], trim: [0xf8f6f0, 0x7a3a5a, 0x2a4a5a], roof: [0x5a3a5a, 0x3a4a5a, 0x7a3a3a], door: [0x7a2a3a, 0x2a5a4a], shutter: [0x5a2a4a] },
  splitLevel: { wall: [0xc8a070, 0x9a8a5a, 0xd8b890, 0xb87a4a], trim: [0xf0e6d0, 0x5a3a2a], roof: [0x5a4a3a, 0x4a3a30], door: [0xe8a030, 0x8a3a2a, 0x3a5a3a], shutter: [0x5a3a2a] },
  aframe: { wall: [0x9a6a42], trim: [0x6a4a2e], roof: [0x4a3a30, 0x3a5a3a, 0x7a3a2a], door: [0xd8a030, 0x3a6a5a], shutter: [0x6a4a2e] },
};
