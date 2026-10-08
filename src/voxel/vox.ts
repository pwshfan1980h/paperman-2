import * as THREE from 'three';

/**
 * Sparse voxel grid. A cell (x, y, z) occupies [x, x+1) on each axis, so its
 * centre is at (x + 0.5, y + 0.5, z + 0.5). Units are voxels throughout the
 * project: one voxel is roughly 4 cm on the rider.
 */
export class Vox {
  readonly cells = new Map<string, number>();

  set(x: number, y: number, z: number, c: number): this {
    this.cells.set(`${x},${y},${z}`, c);
    return this;
  }

  get(x: number, y: number, z: number): number | undefined {
    return this.cells.get(`${x},${y},${z}`);
  }

  has(x: number, y: number, z: number): boolean {
    return this.cells.has(`${x},${y},${z}`);
  }

  del(x: number, y: number, z: number): this {
    this.cells.delete(`${x},${y},${z}`);
    return this;
  }

  /** Inclusive box of cells. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): this {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.set(x, y, z, c);
    return this;
  }

  /** Recolour only cells that already exist inside the box. */
  paint(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): this {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
          if (this.has(x, y, z)) this.set(x, y, z, c);
    return this;
  }

  /** Every cell whose centre lies within r of the segment a-b (continuous coords). */
  tube(a: readonly number[], b: readonly number[], r: number, c: number): this {
    const [ax, ay, az] = a;
    const [bx, by, bz] = b;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz || 1;
    for (let x = Math.floor(Math.min(ax, bx) - r); x <= Math.ceil(Math.max(ax, bx) + r); x++)
      for (let y = Math.floor(Math.min(ay, by) - r); y <= Math.ceil(Math.max(ay, by) + r); y++)
        for (let z = Math.floor(Math.min(az, bz) - r); z <= Math.ceil(Math.max(az, bz) + r); z++) {
          const px = x + 0.5 - ax, py = y + 0.5 - ay, pz = z + 0.5 - az;
          const t = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / len2));
          const qx = px - dx * t, qy = py - dy * t, qz = pz - dz * t;
          if (qx * qx + qy * qy + qz * qz <= r * r) this.set(x, y, z, c);
        }
    return this;
  }

  /** Copy every cell mirrored across the plane x = 0 (cell x maps to -1 - x). */
  mirrorX(): this {
    for (const [k, c] of [...this.cells]) {
      const [x, y, z] = k.split(',').map(Number);
      this.set(-1 - x, y, z, c);
    }
    return this;
  }

  forEach(fn: (x: number, y: number, z: number, c: number) => void): void {
    for (const [k, c] of this.cells) {
      const [x, y, z] = k.split(',').map(Number);
      fn(x, y, z, c);
    }
  }
}

const AO_CURVE = [0.5, 0.68, 0.84, 1];

function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export interface MeshOptions {
  /** Per-voxel brightness jitter, 0 to disable. */
  grain?: number;
}

/**
 * Face-culled voxel mesh with baked ambient occlusion in the vertex colours.
 * `pivot` (voxel coords) becomes the geometry origin.
 */
export function meshVox(v: Vox, pivot: readonly number[] = [0, 0, 0], opts: MeshOptions = {}): THREE.BufferGeometry {
  const grain = opts.grain ?? 0.05;
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const color = new THREE.Color();
  const [px, py, pz] = pivot;

  v.forEach((x, y, z, c) => {
    color.setHex(c);
    const jitter = 1 + (hash3(x, y, z) - 0.5) * 2 * grain;
    const p = [x, y, z];
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3, w = (axis + 2) % 3;
      for (const s of [-1, 1]) {
        const n = [x, y, z];
        n[axis] += s;
        if (v.has(n[0], n[1], n[2])) continue;

        const corners = s > 0 ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[0, 0], [0, 1], [1, 1], [1, 0]];
        const ao: number[] = [];
        const verts: number[][] = [];
        for (const [du, dw] of corners) {
          const s1 = [...n]; s1[u] += du ? 1 : -1;
          const s2 = [...n]; s2[w] += dw ? 1 : -1;
          const cc = [...n]; cc[u] += du ? 1 : -1; cc[w] += dw ? 1 : -1;
          const a = v.has(s1[0], s1[1], s1[2]) ? 1 : 0;
          const b = v.has(s2[0], s2[1], s2[2]) ? 1 : 0;
          const d = v.has(cc[0], cc[1], cc[2]) ? 1 : 0;
          ao.push(a && b ? 0 : 3 - (a + b + d));
          const q = [...p];
          if (s > 0) q[axis] += 1;
          q[u] += du;
          q[w] += dw;
          verts.push([q[0] - px, q[1] - py, q[2] - pz]);
        }
        // flip the quad diagonal so AO interpolates without a crease
        const order = ao[0] + ao[2] > ao[1] + ao[3] ? [0, 1, 2, 0, 2, 3] : [1, 2, 3, 1, 3, 0];
        const normal = [0, 0, 0];
        normal[axis] = s;
        for (const i of order) {
          pos.push(...verts[i]);
          nrm.push(...normal);
          const k = AO_CURVE[ao[i]] * jitter;
          col.push(color.r * k, color.g * k, color.b * k);
        }
      }
    }
  });

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

export const voxMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

export function voxMesh(v: Vox, pivot: readonly number[] = [0, 0, 0], opts?: MeshOptions): THREE.Mesh {
  const m = new THREE.Mesh(meshVox(v, pivot, opts), voxMaterial);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
