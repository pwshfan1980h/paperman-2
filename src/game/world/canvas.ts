import * as THREE from 'three';
import { Grid } from '../../voxel/grid';
import { CELL, Collider, ColliderKind, ROAD_HALF } from './types';

export type ColorFn = number | ((a: number, y: number, b: number) => number);

/**
 * Lot-local voxel canvas. `a` runs outward from the curb, `b` runs along the
 * street in the direction of travel (-z), `y` is up (cell 0 is the ground
 * layer, its top at world y = 2). Mirrors itself for the left side of the
 * street so builders only ever think about "outward".
 */
export class Canvas {
  readonly grid: Grid;
  readonly colliders: Collider[] = [];

  constructor(
    readonly side: number,
    readonly zNear: number,
    readonly na: number,
    readonly nb: number,
    readonly ny: number,
    readonly aOffset = ROAD_HALF,
  ) {
    const ox = side > 0 ? aOffset : -aOffset - na * CELL;
    this.grid = new Grid(na, ny, nb, new THREE.Vector3(ox, 0, zNear - nb * CELL), CELL);
  }

  private ix(a: number) {
    return this.side > 0 ? a : this.na - 1 - a;
  }

  set(a: number, y: number, b: number, c: ColorFn) {
    if (a < 0 || b < 0 || a >= this.na || b >= this.nb || y < 0 || y >= this.ny) return;
    const col = typeof c === 'number' ? c : c(a, y, b);
    this.grid.set(this.ix(a), y, this.nb - 1 - b, col);
  }

  clear(a: number, y: number, b: number) {
    if (a < 0 || b < 0 || a >= this.na || b >= this.nb) return;
    this.grid.clear(this.ix(a), y, this.nb - 1 - b);
  }

  get(a: number, y: number, b: number): number {
    if (a < 0 || b < 0 || a >= this.na || b >= this.nb) return 0;
    return this.grid.get(this.ix(a), y, this.nb - 1 - b);
  }

  box(a0: number, y0: number, b0: number, a1: number, y1: number, b1: number, c: ColorFn) {
    for (let a = Math.min(a0, a1); a <= Math.max(a0, a1); a++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let b = Math.min(b0, b1); b <= Math.max(b0, b1); b++) this.set(a, y, b, c);
  }

  paint(a0: number, y0: number, b0: number, a1: number, y1: number, b1: number, c: ColorFn) {
    for (let a = Math.min(a0, a1); a <= Math.max(a0, a1); a++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let b = Math.min(b0, b1); b <= Math.max(b0, b1); b++) if (this.get(a, y, b)) this.set(a, y, b, c);
  }

  carve(a0: number, y0: number, b0: number, a1: number, y1: number, b1: number) {
    for (let a = Math.min(a0, a1); a <= Math.max(a0, a1); a++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let b = Math.min(b0, b1); b <= Math.max(b0, b1); b++) this.clear(a, y, b);
  }

  /** world-space AABB on the ground of an inclusive cell rect */
  rect(a0: number, a1: number, b0: number, b1: number) {
    const xa = this.aOffset + Math.min(a0, a1) * CELL;
    const xb = this.aOffset + (Math.max(a0, a1) + 1) * CELL;
    return {
      x0: this.side > 0 ? xa : -xb,
      x1: this.side > 0 ? xb : -xa,
      z0: this.zNear - (Math.max(b0, b1) + 1) * CELL,
      z1: this.zNear - Math.min(b0, b1) * CELL,
    };
  }

  /** world point at the centre of cell (a, b), at cell height y (bottom) */
  at(a: number, b: number, y = 1): THREE.Vector3 {
    return new THREE.Vector3(
      this.side * (this.aOffset + (a + 0.5) * CELL),
      y * CELL,
      this.zNear - (b + 0.5) * CELL,
    );
  }

  /** collider over an inclusive cell rect, `topCell` = first empty cell row above it */
  collide(a0: number, a1: number, b0: number, b1: number, topCell: number, kind: ColliderKind = 'solid', tag?: string) {
    const r = this.rect(a0, a1, b0, b1);
    this.colliders.push({ ...r, top: topCell * CELL, kind, tag });
  }
}
