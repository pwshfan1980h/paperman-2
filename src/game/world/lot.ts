import * as THREE from 'three';
import { Canvas } from './canvas';
import { Rng, shade } from '../rng';
import { HouseCtx, STYLES, STYLE_PALETTES } from './houses';
import {
  W, groundStrip, tree, TreeKind, fence, FenceKind, flowerBed, gnome, flamingo, birdbath, trampoline,
  swingSet, hoop, kiddiePool, sign, wheelbarrow, bench,
} from './props';
import { Built, CELL, HouseInfo, LOT_NA, LOT_NB, LOT_NY, ROAD_HALF, Spawn, Target } from './types';
import { voxMaterial } from '../../voxel/vox';

export interface District {
  name: string;
  styles: string[];
  trees: TreeKind[];
  fences: FenceKind[];
  fenceColor: number[];
  /** chance of each yard extra */
  extras: number;
  mowers: number;
}

export const DISTRICTS: Record<string, District> = {
  maple: { name: 'Maple Row', styles: ['cape', 'craftsman', 'colonial', 'cape', 'ranch'], trees: ['maple', 'autumn', 'oak', 'oak'], fences: ['picket', 'picket', 'none', 'hedge'], fenceColor: [0xf4f1e8], extras: 0.5, mowers: 0.15 },
  sycamore: { name: 'Sycamore Court', styles: ['ranch', 'splitLevel', 'modern', 'ranch', 'splitLevel'], trees: ['birch', 'oak', 'bush', 'blossom'], fences: ['none', 'rail', 'none'], fenceColor: [0x8a6a48], extras: 0.65, mowers: 0.55 },
  hilltop: { name: 'Hilltop Lane', styles: ['victorian', 'colonial', 'victorian', 'modern', 'craftsman'], trees: ['oak', 'pine', 'maple', 'blossom'], fences: ['stone', 'hedge', 'stone', 'picket'], fenceColor: [0xf4f1e8, 0x2a2a30], extras: 0.4, mowers: 0.35 },
  elm: { name: 'Elm Street', styles: ['aframe', 'cape', 'ranch', 'craftsman', 'splitLevel', 'aframe'], trees: ['pine', 'oak', 'autumn', 'birch'], fences: ['rail', 'none', 'picket', 'hedge'], fenceColor: [0xf4f1e8, 0x8a6a48], extras: 0.7, mowers: 0.3 },
  willow: { name: 'Willow Bend', styles: ['victorian', 'modern', 'colonial', 'aframe', 'ranch', 'cape', 'craftsman', 'splitLevel'], trees: ['blossom', 'oak', 'maple', 'pine', 'birch'], fences: ['picket', 'stone', 'hedge', 'none', 'rail'], fenceColor: [0xf4f1e8, 0x6a8ab8], extras: 0.6, mowers: 0.45 },
};

export interface LotPlan {
  id: number;
  side: number;
  zNear: number;
  district: string;
  seed: number;
  style: string;
}

/** House metadata without building voxels, so the route knows every house up front. */
export function lotInfo(p: LotPlan): HouseInfo {
  const rng = new Rng(p.seed);
  const pal = STYLE_PALETTES[p.style];
  return {
    id: p.id, side: p.side, district: p.district, style: p.style,
    zMid: p.zNear - LOT_NB,
    mailbox: new THREE.Vector3(p.side * (ROAD_HALF + 4), 0, p.zNear - 20),
    color: rng.pick(pal.wall),
  };
}

export function buildLot(p: LotPlan, day: number): Built & { info: HouseInfo } {
  const rng = new Rng(p.seed);
  const dist = DISTRICTS[p.district];
  const pal = STYLE_PALETTES[p.style];
  const cv = new Canvas(p.side, p.zNear, LOT_NA, LOT_NB, LOT_NY);
  const targets: Target[] = [];
  const spawns: Spawn[] = [];

  groundStrip(cv, LOT_NB);

  const opts = {
    wall: rng.pick(pal.wall), trim: rng.pick(pal.trim), roof: rng.pick(pal.roof),
    door: rng.pick(pal.door), shutter: rng.chance(0.7) ? rng.pick(pal.shutter) : undefined, lit: rng.chance(0.45),
  };
  const h: HouseCtx = { cv, rng, targets, id: p.id };
  const res = STYLES[p.style](h, opts);
  const front = res.front;

  // front walk from the sidewalk to the door
  for (let a = 10; a < front - 1; a++)
    for (let b = res.doorB - 2; b <= res.doorB + 1; b++) cv.set(a, 0, b, (a + b) % 3 === 0 ? W.paver2 : W.paver);

  // driveway through the sidewalk to the garage
  let mailB = res.doorB - 6;
  if (res.drive) {
    const [d0, d1] = res.drive;
    const end = front + 4;
    for (let a = 0; a <= end; a++)
      for (let b = d0; b <= d1; b++) {
        if (cv.get(a, 1, b)) continue;
        cv.set(a, 0, b, a % 8 === 0 && a > 0 ? W.driveJoint : a === 0 ? W.curb : W.drive);
      }
    mailB = d0 > 32 ? d0 - 3 : d1 + 3;
    if (rng.chance(0.55) && res.carSpot)
      spawns.push({ type: 'parkedCar', ...xz(cv, res.carSpot[0], res.carSpot[1]), heading: p.side > 0 ? Math.PI / 2 : -Math.PI / 2, variant: rng.int(0, 99) });
    if (rng.chance(0.35)) hoop(cv, Math.min(end, 22), d0 > 32 ? d1 + 1 : d0 - 1);
  }

  // fence along the lawn edge
  const fk = rng.pick(dist.fences);
  const gaps: [number, number][] = [[res.doorB - 3, res.doorB + 2]];
  if (res.drive) gaps.push([res.drive[0] - 1, res.drive[1] + 1]);
  fence(cv, 11, 0, LOT_NB - 1, fk, gaps, rng.pick(dist.fenceColor));

  // trees: keep tall things back from the sidewalk so they don't hide the rider
  const used: [number, number][] = [[res.doorB - 4, res.doorB + 4]];
  if (res.drive) used.push([res.drive[0] - 4, res.drive[1] + 4]);
  const free = (b: number, r: number) => b - r >= 1 && b + r <= LOT_NB - 2 && !used.some(([u0, u1]) => b + r >= u0 && b - r <= u1);
  const treeCount = rng.int(1, 2);
  for (let i = 0; i < treeCount; i++) {
    for (let tries = 0; tries < 8; tries++) {
      const b = rng.int(4, LOT_NB - 6);
      if (!free(b, 3)) continue;
      const a = rng.int(18, Math.max(19, front - 9));
      tree(cv, a, b, rng.pick(dist.trees), rng, rng.range(0.85, 1.15));
      used.push([b - 6, b + 6]);
      break;
    }
  }
  // side-yard tree behind the house line on the far edge
  if (rng.chance(0.7)) tree(cv, front + rng.int(8, 18), res.span[1] < 52 ? rng.int(res.span[1] + 4, 60) : rng.int(1, 3), rng.pick(dist.trees), rng, rng.range(1, 1.3));

  // yard extras
  const extras: ((a: number, b: number) => void)[] = [
    (a, b) => flowerBed(cv, a, b, a + 4, b + 5, rng),
    (a, b) => gnome(cv, a, b),
    (a, b) => { flamingo(cv, a, b); flamingo(cv, a + 2, b + 3); },
    (a, b) => { birdbath(cv, a, b); spawns.push({ type: 'birds', ...xz(cv, a - 3, b), variant: rng.int(0, 4) }); },
    (a, b) => trampoline(cv, a + 2, b),
    (a, b) => swingSet(cv, a, b),
    (a, b) => kiddiePool(cv, a, b),
    (a, b) => sign(cv, a, b, 0xd8322f, 0xf4f1e8),
    (a, b) => wheelbarrow(cv, a, b),
    (a, b) => bench(cv, a, b, 6),
  ];
  for (let i = 0; i < 2; i++) {
    if (!rng.chance(dist.extras)) continue;
    for (let tries = 0; tries < 6; tries++) {
      const b = rng.int(3, LOT_NB - 14);
      if (!free(b, 6)) continue;
      const a = rng.int(14, Math.max(15, front - 10));
      rng.pick(extras)(a, b);
      used.push([b - 7, b + 12]);
      break;
    }
  }

  // ---- creatures and street furniture for today
  const lawn = cv.rect(14, front - 3, 2, LOT_NB - 3);
  const dayR = new Rng(p.seed * 31 + day * 977);
  spawns.push({ type: 'mailbox', ...xz(cv, 2, mailB), house: p.id, side: p.side });
  const lawnFree = (b: number) => free(b, 2);
  if (dayR.chance(dist.mowers + day * 0.04)) {
    spawns.push({ type: 'mower', ...xz(cv, 20, 20), area: lawn, variant: dayR.int(0, 9), house: p.id });
  }
  if (dayR.chance(0.09 + day * 0.035)) {
    const fenced = fk === 'picket' || fk === 'hedge' ? dayR.chance(0.5) : false;
    const b = lawnFree(14) ? 14 : 50;
    spawns.push({ type: 'dog', ...xz(cv, front - 6, b), area: lawn, variant: dayR.int(0, 99), fenced, side: p.side });
  }
  if (dayR.chance(0.2 + day * 0.03)) {
    const perch = dayR.pick(['porch', 'lawn', 'fence', 'sidewalk']);
    const a = perch === 'porch' ? front - 3 : perch === 'fence' ? 11 : perch === 'sidewalk' ? 5 : 18;
    const yy = perch === 'fence' && fk !== 'none' ? (fk === 'hedge' ? 6 : fk === 'stone' ? 4 : 5) * CELL : CELL;
    spawns.push({ type: 'cat', ...xz(cv, a, dayR.int(8, 56)), y: yy, variant: dayR.int(0, 99), side: p.side, perch });
  }
  if (dayR.chance(0.3)) spawns.push({ type: 'birds', ...xz(cv, dayR.int(2, 8), dayR.int(6, 56)), variant: dayR.int(0, 4) });
  if (dayR.chance(0.12 + day * 0.04)) spawns.push({ type: 'trash', x: p.side * (ROAD_HALF - 4), z: p.zNear - dayR.int(16, 110), variant: dayR.int(0, 9) });

  const geom = cv.grid.mesh();
  const group = new THREE.Group();
  if (geom) {
    const mesh = new THREE.Mesh(geom, voxMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const info = lotInfo(p);
  info.mailbox.copy(cv.at(2, mailB, 0));
  info.color = opts.wall;
  info.style = res.style;
  return { group, colliders: cv.colliders, targets, spawns, info };
}

function xz(cv: Canvas, a: number, b: number) {
  const v = cv.at(a, b);
  return { x: v.x, z: v.z };
}

export { shade };
