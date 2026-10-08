import * as THREE from 'three';
import { Built, CELL, Collider, HouseInfo, LOT_W, Piece, ROAD_HALF, Spawn, Target } from './types';
import { DISTRICTS, LotPlan, buildLot, lotInfo } from './lot';
import { buildConstruction, buildCross, buildFinish, buildPark, buildStart } from './special';
import { Rng } from '../rng';

export interface Segment {
  kind: Piece['kind'];
  district: string;
  zNear: number;
  zFar: number;
  label: string;
}

const LOTS_PER_BLOCK = 7;
const SPEC: { kind: Piece['kind'] | 'block'; district?: string; len?: number }[] = [
  { kind: 'start', len: 192 },
  { kind: 'block', district: 'maple' },
  { kind: 'cross', len: 128 },
  { kind: 'block', district: 'sycamore' },
  { kind: 'park', len: 512 },
  { kind: 'block', district: 'hilltop' },
  { kind: 'construction', len: 384 },
  { kind: 'block', district: 'elm' },
  { kind: 'cross', len: 128 },
  { kind: 'block', district: 'willow' },
  { kind: 'finish', len: 320 },
];

const LABELS: Record<string, string> = {
  start: 'Herald Depot', cross: 'Crossing', park: 'Birch Park', construction: 'Road Works', finish: 'Finish',
};

/**
 * The route: a fixed sequence of pieces along -z. Voxel meshes stream in
 * ahead of the camera and are dropped behind it.
 */
export class World {
  readonly group = new THREE.Group();
  readonly pieces: Piece[] = [];
  readonly houses: HouseInfo[] = [];
  readonly segments: Segment[] = [];
  readonly crossings: [number, number][] = [];
  readonly length: number;
  readonly finishZ: number;

  private buckets = new Map<number, Collider[]>();
  readonly targets: Target[] = [];
  onBuilt?: (piece: Piece, built: Built) => void;
  onDisposed?: (piece: Piece) => void;
  private day = 0;

  constructor() {
    let z = 0;
    let id = 0;
    const rng = new Rng(2026);
    for (const s of SPEC) {
      if (s.kind === 'block') {
        const d = DISTRICTS[s.district!];
        const zStart = z;
        for (let i = 0; i < LOTS_PER_BLOCK; i++) {
          for (const side of [-1, 1]) {
            const plan: LotPlan = { id: id++, side, zNear: z, district: s.district!, seed: rng.int(1, 1e9), style: '' };
            // avoid the same style twice in a row on a side
            const prev = this.pieces.filter((p) => p.kind === 'lot' && (p as LotPiece).plan.side === side).pop() as LotPiece | undefined;
            do plan.style = rng.pick(d.styles); while (prev && prev.plan.style === plan.style && d.styles.length > 1);
            const piece: LotPiece = {
              kind: 'lot', district: s.district!, zNear: z, zFar: z - LOT_W, plan,
              build: (day) => {
                const b = buildLot(plan, day);
                const h = this.houses.find((hh) => hh.id === plan.id)!;
                h.mailbox.copy(b.info.mailbox);
                h.color = b.info.color;
                h.style = b.info.style;
                return b;
              },
            };
            this.pieces.push(piece);
            this.houses.push(lotInfo(plan));
          }
          z -= LOT_W;
        }
        this.segments.push({ kind: 'lot', district: s.district!, zNear: zStart, zFar: z, label: d.name });
      } else {
        const len = s.len!;
        const zN = z;
        const kind = s.kind as Piece['kind'];
        const build = (day: number): Built => {
          switch (kind) {
            case 'start': return buildStart(zN, len);
            case 'cross': return buildCross(zN, len, day);
            case 'park': return buildPark(zN, len, day);
            case 'construction': return buildConstruction(zN, len, day);
            default: return buildFinish(zN, len);
          }
        };
        this.pieces.push({ kind, district: kind, zNear: zN, zFar: zN - len, build, openRoad: kind === 'cross' });
        if (kind === 'cross') this.crossings.push([zN - 10 * CELL, zN - len + 10 * CELL]);
        this.segments.push({ kind, district: kind, zNear: zN, zFar: zN - len, label: LABELS[kind] });
        z -= len;
      }
    }
    this.length = -z;
    this.finishZ = this.segments[this.segments.length - 1].zNear - 40;
    this.group.add(makeRoad(this.length, this.crossings));
  }

  reset(day: number) {
    this.day = day;
    for (const p of this.pieces) if (p.built) this.dispose(p);
    this.buckets.clear();
    this.targets.length = 0;
  }

  /** Build what's needed around the camera; at most `budget` pieces per call. */
  stream(zCam: number, budget = 2, ahead = 900, behind = 260) {
    let n = 0;
    for (const p of this.pieces) {
      const want = p.zFar < zCam + behind && p.zNear > zCam - ahead;
      if (want && !p.built && n < budget) {
        p.built = p.build(this.day);
        this.group.add(p.built.group);
        for (const c of p.built.colliders) this.addCollider(c);
        this.targets.push(...p.built.targets);
        this.onBuilt?.(p, p.built);
        n++;
      } else if (!want && p.built && p.zNear < zCam - ahead - 200) {
        this.dispose(p);
      } else if (!want && p.built && p.zFar > zCam + behind + 100) {
        this.dispose(p);
      }
    }
    return n;
  }

  private dispose(p: Piece) {
    const b = p.built!;
    this.group.remove(b.group);
    b.group.traverse((o) => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
    for (const c of b.colliders) this.removeCollider(c);
    for (const t of b.targets) {
      const i = this.targets.indexOf(t);
      if (i >= 0) this.targets.splice(i, 1);
    }
    p.built = undefined;
    this.onDisposed?.(p);
  }

  // ------------------------------------------------------------ collision

  private keys(c: { z0: number; z1: number }) {
    const out: number[] = [];
    for (let k = Math.floor(c.z0 / 64); k <= Math.floor(c.z1 / 64); k++) out.push(k);
    return out;
  }

  addCollider(c: Collider) {
    for (const k of this.keys(c)) {
      let b = this.buckets.get(k);
      if (!b) this.buckets.set(k, (b = []));
      b.push(c);
    }
  }

  removeCollider(c: Collider) {
    for (const k of this.keys(c)) {
      const b = this.buckets.get(k);
      if (!b) continue;
      const i = b.indexOf(c);
      if (i >= 0) b.splice(i, 1);
    }
  }

  near(x: number, z: number, r = 0): Collider[] {
    const out: Collider[] = [];
    const b = this.buckets.get(Math.floor(z / 64));
    if (!b) return out;
    for (const c of b) if (x >= c.x0 - r && x <= c.x1 + r && z >= c.z0 - r && z <= c.z1 + r) out.push(c);
    return out;
  }

  baseGround(x: number, z: number): number {
    if (Math.abs(x) < ROAD_HALF) return 0;
    for (const [a, b] of this.crossings) if (z <= a && z >= b) return 0;
    return 2;
  }

  colliderTop(c: Collider, z: number): number {
    if (c.kind !== 'ramp') return c.top;
    const t = Math.max(0, Math.min(1, (c.z1 - z) / (c.z1 - c.z0)));
    return (c.rampFrom ?? 0) + ((c.rampTo ?? c.top) - (c.rampFrom ?? 0)) * t;
  }

  /** Surface height a wheel would rest on. */
  groundAt = (x: number, z: number): number => {
    let g = this.baseGround(x, z);
    for (const c of this.near(x, z)) if (c.kind !== 'solid') g = Math.max(g, this.colliderTop(c, z));
    return g;
  };

  /** Anything the bike can't ride into at height y. */
  blocked(x: number, z: number, y: number, r = 1.5): Collider | undefined {
    for (const c of this.near(x, z, r)) {
      const top = this.colliderTop(c, z);
      if (c.kind === 'ramp') continue;
      if (c.kind === 'walk' ? top > y + 3.5 : top > y + 0.5) return c;
    }
    return undefined;
  }

  segmentAt(z: number): Segment | undefined {
    return this.segments.find((s) => z <= s.zNear && z > s.zFar);
  }
}

interface LotPiece extends Piece {
  plan: LotPlan;
}

// ---------------------------------------------------------------- road surface

function asphaltTexture(lines: boolean) {
  const W = 88, H = 96;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = 76 + rnd() * 12;
      if (rnd() < 0.035) v += 20;
      let r = v, gg = v, b = v + 7;
      if (lines) {
        if (x >= 43 && x <= 44 && y % 48 < 26) { r = 236; gg = 196; b = 70; }
        if (x === 3 || x === W - 4) { r = 220; gg = 218; b = 210; }
        if (x <= 1 || x >= W - 2) { r *= 0.8; gg *= 0.8; b *= 0.8; }
      }
      if (y === 30 && x > 10 && x < 30) { r *= 0.85; gg *= 0.85; b *= 0.85; }
      img.data.set([r, gg, b, 255], (y * W + x) * 4);
    }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function makeRoad(length: number, crossings: [number, number][]) {
  const g = new THREE.Group();
  const main = asphaltTexture(true);
  const len = length + 600;
  main.repeat.set(1, len / 96);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, len), new THREE.MeshLambertMaterial({ map: main }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, -length / 2 + 100);
  road.receiveShadow = true;
  g.add(road);
  for (const [a, b] of crossings) {
    const t = asphaltTexture(false);
    t.repeat.set(1, 1200 / 96);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(a - b, 1200), new THREE.MeshLambertMaterial({ map: t }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.PI / 2;
    m.position.set(0, 0.05, (a + b) / 2);
    m.receiveShadow = true;
    g.add(m);
  }
  // distant ground so the horizon is never empty
  const far = new THREE.Mesh(new THREE.PlaneGeometry(3000, len + 2000), new THREE.MeshLambertMaterial({ color: 0x5aa040 }));
  far.rotation.x = -Math.PI / 2;
  far.position.set(0, -0.6, -length / 2);
  far.receiveShadow = true;
  g.add(far);
  return g;
}

export type { Spawn };
