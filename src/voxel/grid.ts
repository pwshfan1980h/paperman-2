import * as THREE from 'three';

const FILLED = 0x1000000;
const AO_CURVE = [0.55, 0.72, 0.86, 1];

/**
 * Dense voxel grid for world pieces (lots, parks, intersections). Cells are
 * `scale` world units on a side; cell (0,0,0) starts at `origin`.
 */
export class Grid {
  readonly data: Uint32Array;

  constructor(
    readonly nx: number,
    readonly ny: number,
    readonly nz: number,
    readonly origin: THREE.Vector3,
    readonly scale = 2,
  ) {
    this.data = new Uint32Array(nx * ny * nz);
  }

  private i(x: number, y: number, z: number) {
    return x + this.nx * (y + this.ny * z);
  }

  inside(x: number, y: number, z: number) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz;
  }

  set(x: number, y: number, z: number, c: number) {
    if (this.inside(x, y, z)) this.data[this.i(x, y, z)] = (c & 0xffffff) | FILLED;
  }

  clear(x: number, y: number, z: number) {
    if (this.inside(x, y, z)) this.data[this.i(x, y, z)] = 0;
  }

  get(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.data[this.i(x, y, z)] : 0;
  }

  filled(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) !== 0;
  }

  /**
   * Greedy mesh. Faces merge when colour and all four AO corners match, so
   * flat walls collapse to a few quads while AO creases stay per-voxel.
   */
  mesh(skipBottom = true): THREE.BufferGeometry | null {
    const dims = [this.nx, this.ny, this.nz];
    const pos: number[] = [];
    const nrm: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const color = new THREE.Color();
    const p = [0, 0, 0];
    const q = [0, 0, 0];
    const sc = this.scale;
    const o = [this.origin.x, this.origin.y, this.origin.z];

    for (let d = 0; d < 3; d++) {
      const u = (d + 1) % 3, v = (d + 2) % 3;
      const nu = dims[u], nv = dims[v];
      const maskC = new Uint32Array(nu * nv);
      const maskA = new Uint8Array(nu * nv);
      for (const s of [-1, 1]) {
        if (skipBottom && d === 1 && s < 0) continue;
        for (let i = 0; i < dims[d]; i++) {
          // build the mask for this slice
          for (let b = 0; b < nv; b++)
            for (let a = 0; a < nu; a++) {
              p[d] = i; p[u] = a; p[v] = b;
              const c = this.get(p[0], p[1], p[2]);
              const m = a + b * nu;
              maskC[m] = 0;
              if (!c) continue;
              q[0] = p[0]; q[1] = p[1]; q[2] = p[2];
              q[d] += s;
              if (this.get(q[0], q[1], q[2])) continue;
              let pack = 0;
              for (let k = 0; k < 4; k++) {
                const du = k === 1 || k === 2 ? 1 : -1;
                const dv = k >= 2 ? 1 : -1;
                const s1 = this.filled(q[0] + (u === 0 ? du : 0), q[1] + (u === 1 ? du : 0), q[2] + (u === 2 ? du : 0)) ? 1 : 0;
                const s2 = this.filled(q[0] + (v === 0 ? dv : 0), q[1] + (v === 1 ? dv : 0), q[2] + (v === 2 ? dv : 0)) ? 1 : 0;
                const cc = this.filled(
                  q[0] + (u === 0 ? du : 0) + (v === 0 ? dv : 0),
                  q[1] + (u === 1 ? du : 0) + (v === 1 ? dv : 0),
                  q[2] + (u === 2 ? du : 0) + (v === 2 ? dv : 0)) ? 1 : 0;
                const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
                pack |= ao << (k * 2);
              }
              maskC[m] = c;
              maskA[m] = pack;
            }

          // greedy merge
          for (let b = 0; b < nv; b++)
            for (let a = 0; a < nu; ) {
              const m = a + b * nu;
              const c = maskC[m];
              if (!c) { a++; continue; }
              const pack = maskA[m];
              const uniform = pack === 0 || pack === 0x55 || pack === 0xaa || pack === 0xff;
              let w = 1, h = 1;
              if (uniform) {
                while (a + w < nu && maskC[m + w] === c && maskA[m + w] === pack) w++;
                outer: for (; b + h < nv; h++) {
                  for (let k = 0; k < w; k++) {
                    const mm = a + k + (b + h) * nu;
                    if (maskC[mm] !== c || maskA[mm] !== pack) break outer;
                  }
                }
              }
              for (let hh = 0; hh < h; hh++) for (let k = 0; k < w; k++) maskC[a + k + (b + hh) * nu] = 0;

              color.setHex(c & 0xffffff);
              const base = pos.length / 3;
              const plane = i + (s > 0 ? 1 : 0);
              const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
              const aos: number[] = [];
              for (let k = 0; k < 4; k++) {
                const [cu, cv] = corners[k];
                const vtx = [0, 0, 0];
                vtx[d] = plane;
                vtx[u] = a + cu * w;
                vtx[v] = b + cv * h;
                pos.push(o[0] + vtx[0] * sc, o[1] + vtx[1] * sc, o[2] + vtx[2] * sc);
                const nn = [0, 0, 0];
                nn[d] = s;
                nrm.push(nn[0], nn[1], nn[2]);
                const ao = (pack >> (k * 2)) & 3;
                aos.push(ao);
                const f = AO_CURVE[ao];
                col.push(color.r * f, color.g * f, color.b * f);
              }
              const flip = aos[0] + aos[2] < aos[1] + aos[3];
              const tri = flip ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
              if (s < 0) tri.reverse();
              for (const t of tri) idx.push(base + t);
              a += w;
            }
        }
      }
    }
    if (!idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}
