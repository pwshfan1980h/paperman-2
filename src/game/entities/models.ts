import * as THREE from 'three';
import { Vox, voxMesh } from '../../voxel/vox';
import { shade } from '../rng';

/* All entity models are in rider-scale voxels (1 unit), front = -Z. */

const INK = 0x1c1a22;

export function part(build: (v: Vox) => void, pivot: number[] = [0, 0, 0], grain = 0.05): THREE.Mesh {
  const v = new Vox();
  build(v);
  return voxMesh(v, pivot, { grain });
}

export function group(...children: THREE.Object3D[]) {
  const g = new THREE.Group();
  g.add(...children);
  return g;
}

// ---------------------------------------------------------------- dogs

export interface DogBreed {
  name: string;
  len: number; // body length
  w: number; // body width
  h: number; // body height
  leg: number;
  coat: number;
  belly: number;
  ear: number;
  patch?: number;
  floppy: boolean;
  tailUp: boolean;
  speed: number;
  bark: number; // pitch
}

export const BREEDS: DogBreed[] = [
  { name: 'dachshund', len: 11, w: 3, h: 3, leg: 2, coat: 0x8a4a22, belly: 0xa8643a, ear: 0x5a2e14, floppy: true, tailUp: false, speed: 82, bark: 1.5 },
  { name: 'beagle', len: 9, w: 4, h: 4, leg: 4, coat: 0xf2ece0, belly: 0xf8f4ec, ear: 0x8a5a2a, patch: 0x2a2420, floppy: true, tailUp: true, speed: 96, bark: 1.2 },
  { name: 'golden', len: 11, w: 5, h: 5, leg: 6, coat: 0xd8a050, belly: 0xe8bc70, ear: 0xc08840, floppy: true, tailUp: false, speed: 112, bark: 0.9 },
  { name: 'black lab', len: 11, w: 5, h: 5, leg: 6, coat: 0x2a2628, belly: 0x3a3436, ear: 0x1e1a1c, floppy: true, tailUp: false, speed: 112, bark: 0.85 },
  { name: 'terrier', len: 7, w: 4, h: 4, leg: 3, coat: 0xf4f2ec, belly: 0xffffff, ear: 0xc89a6a, patch: 0xc89a6a, floppy: false, tailUp: true, speed: 90, bark: 1.7 },
  { name: 'sheepdog', len: 12, w: 6, h: 6, leg: 5, coat: 0xc8c8cc, belly: 0xf2f2f2, ear: 0x8a8a90, patch: 0xf2f2f2, floppy: true, tailUp: false, speed: 104, bark: 0.75 },
  { name: 'husky', len: 11, w: 5, h: 5, leg: 6, coat: 0x6a6e78, belly: 0xf2f2f2, ear: 0x5a5e68, floppy: false, tailUp: true, speed: 118, bark: 1.0 },
];

export interface QuadRig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  tail: THREE.Group;
  legs: THREE.Group[]; // FL, FR, BL, BR
  ears: THREE.Object3D[];
  legLen: number;
  height: number;
}

export function dogRig(b: DogBreed): QuadRig {
  const L = b.len, Wd = b.w, H = b.h;
  const body = part((v) => {
    v.box(0, 0, 0, Wd - 1, H - 1, L - 1, b.coat);
    v.box(0, 0, 1, Wd - 1, 0, L - 2, b.belly);
    if (b.patch) v.box(0, H - 1, 2, Wd - 1, H - 1, Math.floor(L / 2), b.patch);
  }, [Wd / 2, H / 2, L / 2]);
  const hw = Math.max(3, Wd - 1);
  const head = part((v) => {
    v.box(0, 0, 0, hw - 1, 3, 3, b.coat);
    v.box(Math.floor(hw / 2) - 1, 0, -3, Math.floor(hw / 2) + (hw % 2 ? 0 : 0), 1, -1, b.belly); // snout
    v.set(Math.floor(hw / 2) - 1, 1, -3, INK);
    if (hw % 2 === 0) v.set(Math.floor(hw / 2), 1, -3, INK);
    v.set(0, 2, 0, INK).set(hw - 1, 2, 0, INK); // eyes
    v.set(Math.floor(hw / 2) - 1, -1, -2, 0xe85060); // tongue
  }, [hw / 2, 0, 2]);
  const ears = [0, 1].map((i) => {
    const e = part((v) => {
      if (b.floppy) v.box(0, -2, 0, 0, 0, 1, b.ear);
      else v.box(0, 0, 0, 0, 1, 0, b.ear).set(0, 2, 0, b.ear);
    }, [0.5, 0, 0.5]);
    e.position.set((i ? 1 : -1) * (hw / 2), b.floppy ? 3.5 : 4, 1);
    return e;
  });
  const headG = group(head, ...ears);
  headG.position.set(0, H / 2 + 0.5, -L / 2);
  const tail = part((v) => v.box(0, 0, 0, 0, 0, 3, b.coat).set(0, 0, 3, b.belly), [0.5, 0.5, 0]);
  const tailG = group(tail);
  tailG.position.set(0, H / 2 - 0.5, L / 2);
  tailG.rotation.x = b.tailUp ? 0.9 : 0.3;
  const bodyG = group(body, headG, tailG);
  const legs = [0, 1, 2, 3].map((i) => {
    const front = i < 2, right = i % 2 === 1;
    const leg = part((v) => {
      v.box(0, -b.leg, 0, 0, 0, 0, b.coat);
      v.set(0, -b.leg, -1, b.belly);
    }, [0.5, 0, 0.5]);
    if (Wd >= 4) leg.scale.x = 1.6;
    const g = group(leg);
    g.position.set((right ? 1 : -1) * (Wd / 2 - 0.8), -H / 2 + 0.5, (front ? -1 : 1) * (L / 2 - 1.2));
    return g;
  });
  bodyG.add(...legs);
  bodyG.position.y = b.leg + H / 2;
  const root = group(bodyG);
  return { root, body: bodyG, head: headG, tail: tailG, legs, ears, legLen: b.leg, height: b.leg + H + 4 };
}

// ---------------------------------------------------------------- cats

export const CAT_COATS = [
  { name: 'black', coat: 0x26232a, belly: 0x26232a, stripe: 0x1a181e, eye: 0xd8e040 },
  { name: 'ginger', coat: 0xe08a3a, belly: 0xf2c48a, stripe: 0xc06a24, eye: 0x6ac040 },
  { name: 'grey', coat: 0x8a8e98, belly: 0xc8ccd4, stripe: 0x6a6e78, eye: 0xe8b030 },
  { name: 'white', coat: 0xf6f4ee, belly: 0xffffff, stripe: 0xe8e4dc, eye: 0x4a9ae8 },
  { name: 'calico', coat: 0xf6f0e4, belly: 0xffffff, stripe: 0xd8823a, eye: 0x6ac040 },
  { name: 'tuxedo', coat: 0x26232a, belly: 0xf6f4ee, stripe: 0x26232a, eye: 0x6ac040 },
];

export function catRig(c: (typeof CAT_COATS)[number]): QuadRig {
  const body = part((v) => {
    v.box(0, 0, 0, 2, 2, 6, c.coat);
    v.box(0, 0, 1, 2, 0, 5, c.belly);
    for (let z = 1; z < 6; z += 2) v.box(0, 2, z, 2, 2, z, c.stripe);
  }, [1.5, 1.5, 3.5]);
  const head = part((v) => {
    v.box(0, 0, 0, 2, 2, 2, c.coat);
    v.set(0, 3, 1, c.coat).set(2, 3, 1, c.coat); // ears
    v.set(0, 1, -1, c.eye).set(2, 1, -1, c.eye);
    v.set(1, 0, -1, c.belly);
    v.set(1, 0, -2, 0xe88a9a);
  }, [1.5, 0, 1.5]);
  const headG = group(head);
  headG.position.set(0, 1.2, -3.5);
  const tailParts = [0, 1].map(() => part((v) => v.box(0, 0, 0, 0, 0, 3, c.coat).set(0, 0, 3, c.stripe), [0.5, 0.5, 0]));
  const tail2G = group(tailParts[1]);
  tail2G.position.z = 3.5;
  const tailG = group(tailParts[0], tail2G);
  tailG.position.set(0, 1, 3.5);
  const bodyG = group(body, headG, tailG);
  const legs = [0, 1, 2, 3].map((i) => {
    const leg = part((v) => v.box(0, -3, 0, 0, 0, 0, c.coat).set(0, -3, 0, c.belly), [0.5, 0, 0.5]);
    const g = group(leg);
    g.position.set(i % 2 ? 0.8 : -0.8, -1, i < 2 ? -2.6 : 2.6);
    return g;
  });
  bodyG.add(...legs);
  bodyG.position.y = 4.5;
  return { root: group(bodyG), body: bodyG, head: headG, tail: tailG, legs, ears: [tail2G], legLen: 3, height: 8 };
}

// ---------------------------------------------------------------- mower

export const MOWER_COLORS = [0xd8322f, 0x3ab84a, 0x2f74e0, 0xf2a020, 0x9a5ad8, 0xf4f1e8, 0x2ac0c0, 0xe85aa0, 0x5a5e68, 0xe8d040];

export function mowerModel(color: number) {
  const body = part((v) => {
    for (let x = 0; x < 10; x++) for (let z = 0; z < 12; z++) {
      const cx = x - 4.5, cz = z - 5.5;
      if (cx * cx / 25 + cz * cz / 36 > 1) continue;
      v.set(x, 1, z, shade(color, 0.85));
      if (cx * cx / 20 + cz * cz / 30 <= 1) v.set(x, 2, z, color);
      if (cx * cx / 12 + cz * cz / 18 <= 1) v.set(x, 3, z, shade(color, 1.1));
    }
    for (let x = 1; x < 9; x++) v.set(x, 1, 0, 0x2a2a30); // bumper
    // face display
    v.box(3, 2, 0, 6, 3, 0, 0x1e2a30);
    v.set(3, 3, -1, 0x6af0ff).set(6, 3, -1, 0x6af0ff);
    v.set(4, 4, 6, 0x2a2a30).set(5, 4, 6, 0x2a2a30);
  }, [5, 0, 6]);
  const led = part((v) => v.set(0, 0, 0, 0x6aff6a), [0.5, 0, 0.5], 0);
  led.position.set(0, 4.5, 0.5);
  const wheels = [0, 1].map((i) => {
    const w = part((v) => { for (let y = -1; y <= 0; y++) for (let z = -1; z <= 0; z++) v.set(0, y, z, 0x2a2a30); v.set(0, 0, 0, 0x5a5e68); }, [0.5, 0, 0]);
    w.position.set(i ? 5.2 : -5.2, 1.5, 1);
    return w;
  });
  const g = group(body, led, ...wheels);
  return { root: g, led, wheels };
}

// ---------------------------------------------------------------- birds

export const BIRD_KINDS = [
  { name: 'pigeon', body: 0x8a8e9a, wing: 0x6e7280, head: 0x5a7a8a, beak: 0xd8a080, size: 1.2 },
  { name: 'sparrow', body: 0x9a7a5a, wing: 0x6e5238, head: 0x8a6a4a, beak: 0x3a3030, size: 0.8 },
  { name: 'cardinal', body: 0xd82a2a, wing: 0xb02020, head: 0xe83a3a, beak: 0xf0a030, size: 1.0 },
  { name: 'crow', body: 0x26242e, wing: 0x1a1820, head: 0x26242e, beak: 0x1a1820, size: 1.4 },
  { name: 'bluejay', body: 0x4a7ad8, wing: 0x2a5ab8, head: 0xe8eef8, beak: 0x2a2a30, size: 1.0 },
  { name: 'robin', body: 0xe0703a, wing: 0x5a5250, head: 0x3a3436, beak: 0xf0c040, size: 1.0 },
];

export function birdRig(kind: (typeof BIRD_KINDS)[number]) {
  const body = part((v) => {
    v.box(0, 0, 0, 1, 1, 3, kind.body);
    v.box(0, 0, 4, 1, 0, 5, kind.wing); // tail
  }, [1, 0, 2]);
  const head = part((v) => {
    v.box(0, 0, 0, 1, 1, 1, kind.head);
    v.set(0, 1, -1, INK).set(1, 1, -1, INK);
    v.set(0, 0, -1, kind.beak).set(1, 0, -1, kind.beak);
  }, [1, 0, 1]);
  head.position.set(0, 1.4, -2);
  const wings = [0, 1].map((i) => {
    const w = part((v) => v.box(0, 0, 0, 2, 0, 2, kind.wing), [i ? 0 : 3, 0.5, 1.5]);
    const g = group(w);
    g.position.set(i ? 1 : -1, 1.2, -0.5);
    return g;
  });
  const legs = part((v) => v.set(0, 0, 0, 0xd88a50).set(1, 0, 0, 0xd88a50), [1, 1, 0.5], 0);
  legs.position.y = 0.2;
  const bodyG = group(body, head, ...wings, legs);
  bodyG.position.y = 1;
  const root = group(bodyG);
  root.scale.setScalar(kind.size);
  return { root, body: bodyG, head, wings };
}

export function duckRig(mother: boolean) {
  const c = mother ? 0x8a6a4a : 0xf2d84a;
  const body = part((v) => {
    v.box(0, 0, 0, 3, 2, 5, c);
    v.box(0, 2, 4, 3, 2, 5, mother ? 0x6a4a32 : c);
    if (mother) v.box(0, 1, 1, 0, 1, 3, 0x3a5ad8).box(3, 1, 1, 3, 1, 3, 0x3a5ad8);
  }, [2, 0, 3]);
  const head = part((v) => {
    v.box(0, 0, 0, 1, 2, 1, mother ? 0x2a6a3a : c);
    v.set(0, 2, -1, INK).set(1, 2, -1, INK);
    v.box(0, 1, -2, 1, 1, -1, 0xf0a030);
  }, [1, 0, 1]);
  head.position.set(0, 2.5, -2.5);
  const g = group(body, head);
  if (!mother) g.scale.setScalar(0.55);
  return { root: group(g), body: g, head };
}

export function gooseRig() {
  const body = part((v) => {
    v.box(0, 0, 0, 3, 2, 7, 0x8a7a6a);
    v.box(0, 0, 1, 3, 0, 6, 0xe8e0d0);
  }, [2, 1, 4]);
  const neck = part((v) => {
    v.box(0, 0, 0, 1, 0, 5, 0x1e1e22);
    v.set(0, 0, 3, 0xf2f2f2).set(1, 0, 3, 0xf2f2f2);
    v.box(0, 0, -1, 1, 0, -1, 0x2a2a2e);
  }, [1, 0.5, 6]);
  neck.position.set(0, 0.5, -4);
  const wings = [0, 1].map((i) => {
    const w = part((v) => v.box(0, 0, 0, 7, 0, 4, 0x6a5e52), [i ? 0 : 8, 0.5, 2.5]);
    const g = group(w);
    g.position.set(i ? 2 : -2, 1, -0.5);
    return g;
  });
  const g = group(body, neck, ...wings);
  return { root: group(g), wings };
}

export function squirrelRig() {
  const body = part((v) => {
    v.box(0, 0, 0, 1, 1, 3, 0x8a6a5a);
    v.box(0, 2, -1, 1, 3, 0, 0x8a6a5a);
    v.set(0, 3, -1, INK);
  }, [1, 0, 2]);
  const tail = part((v) => v.box(0, 0, 0, 1, 4, 1, 0x9a7a6a).box(0, 4, -1, 1, 4, -1, 0x9a7a6a), [1, 0, 0]);
  tail.position.set(0, 1, 2);
  return { root: group(group(body, tail)), tail };
}

// ---------------------------------------------------------------- cars

export const CAR_COLORS = [0xd8322f, 0x2f74e0, 0xe8c040, 0xf2f2ee, 0x3a3c44, 0x3ab07a, 0x8a3ad8, 0xe8762a, 0x9aa4b0, 0x6a2a2a];

export function carModel(variant: number, oncoming = true) {
  const color = CAR_COLORS[variant % CAR_COLORS.length];
  const type = Math.floor(variant / 10) % 4; // sedan, hatch, pickup, van
  const glass = 0x5a8ab0;
  const lit = shade(color, 1.12);
  const len = type === 2 ? 44 : type === 1 ? 32 : type === 3 ? 42 : 40;
  const v = new Vox();
  const W = 20;
  // body
  v.box(0, 3, 0, W - 1, 9, len - 1, color);
  v.box(0, 9, 0, W - 1, 9, len - 1, lit);
  v.box(0, 3, 0, W - 1, 3, len - 1, shade(color, 0.8));
  // cabin
  const c0 = type === 3 ? 4 : type === 2 ? 8 : type === 1 ? 8 : 11;
  const c1 = type === 3 ? len - 3 : type === 2 ? 24 : type === 1 ? len - 3 : 30;
  v.box(1, 10, c0, W - 2, 16, c1, glass);
  for (const z of [c0, c1]) v.box(1, 10, z, W - 2, 16, z, color);
  for (const z of [c0 + 1, c1 - 1]) for (const x of [1, W - 2]) v.box(x, 10, z, x, 16, z, color);
  v.box(1, 16, c0, W - 2, 16, c1, lit);
  if (type === 2) v.box(1, 10, 26, W - 2, 11, len - 2, shade(color, 0.7)).box(2, 10, 27, W - 3, 10, len - 3, 0x3a3a3a);
  if (type === 3) v.box(0, 10, 18, W - 1, 15, 22, color);
  // lights, bumpers, plate
  v.box(0, 3, -1, W - 1, 4, -1, 0xc8ccd6);
  v.box(0, 3, len, W - 1, 4, len, 0xc8ccd6);
  for (const x of [1, 2, W - 3, W - 2]) {
    v.set(x, 7, -1, oncoming ? 0xfff2b0 : 0xfff2b0);
    v.set(x, 7, len, 0xff3020);
  }
  v.box(8, 5, len, 11, 6, len, 0xf2f2ee);
  // wheels
  for (const z of [6, len - 8]) for (const x of [-1, W]) v.box(x, 0, z, x, 5, z + 5, 0x1e1e24).box(x, 2, z + 2, x, 3, z + 3, 0xb0b4bc);
  const m = voxMesh(v, [W / 2, 0, len / 2], { grain: 0.03 });
  return { mesh: m, len, width: W + 2, height: 17 };
}

// ---------------------------------------------------------------- street things

export const MAILBOX_COLORS = [0x2a2a30, 0xd8322f, 0x2a6a3a, 0x2f5ab0, 0xf2f2ee, 0x8a5a2a];

export function mailboxModel(color: number) {
  const post = part((v) => v.box(0, 0, 0, 1, 11, 1, 0x8a6a48).box(-1, 11, -1, 2, 11, 2, 0x7a5a3a), [1, 0, 1]);
  const box = part((v) => {
    v.box(0, 0, 0, 5, 4, 7, color);
    v.box(1, 5, 0, 4, 5, 7, color);
    v.box(0, 0, 0, 5, 5, 0, shade(color, 0.85)); // door
    v.set(2, 3, -1, 0xc8ccd6).set(3, 3, -1, 0xc8ccd6);
  }, [3, 0, 4]);
  box.position.y = 12;
  const flag = part((v) => v.box(0, 0, 0, 0, 4, 0, 0x3a3a40).box(0, 3, 1, 0, 4, 3, 0xe82a2a), [0.5, 0, 0.5], 0);
  const flagG = group(flag);
  flagG.position.set(3.4, 13, 1);
  return { root: group(post, box, flagG), flag: flagG, box };
}

export function trashModel(variant: number) {
  const c = [0x5a6a5a, 0x4a5a7a, 0x6a6e78][variant % 3];
  const body = part((v) => {
    for (let y = 0; y < 11; y++) for (let x = 0; x < 7; x++) for (let z = 0; z < 7; z++) {
      if ((x - 3) ** 2 + (z - 3) ** 2 > 10) continue;
      v.set(x, y, z, y % 4 === 0 ? shade(c, 0.85) : c);
    }
  }, [3.5, 0, 3.5]);
  const lid = part((v) => {
    for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) if ((x - 3.5) ** 2 + (z - 3.5) ** 2 <= 14) v.set(x, 0, z, shade(c, 1.1));
    v.box(3, 1, 3, 4, 1, 4, shade(c, 0.7));
  }, [4, 0, 4]);
  lid.position.y = 11;
  return { root: group(body, lid), lid };
}

export function coneModel() {
  return part((v) => {
    v.box(0, 0, 0, 5, 0, 5, 0x2a2a30);
    for (let y = 1; y < 9; y++) {
      const r = 2.6 - y * 0.25;
      for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++)
        if ((x - 2.5) ** 2 + (z - 2.5) ** 2 <= r * r + 0.3) v.set(x, y, z, y === 4 || y === 5 ? 0xf4f1e8 : 0xf26a1a);
    }
  }, [3, 0, 3]);
}

export function bundleModel() {
  return part((v) => {
    v.box(0, 0, 0, 7, 3, 3, 0xf6f3e6);
    v.box(0, 3, 0, 7, 3, 3, 0xe8e2d0);
    v.box(2, 0, -1, 2, 4, 4, 0xd23a3a).box(5, 0, -1, 5, 4, 4, 0xd23a3a);
    v.box(0, 1, -1, 7, 1, -1, 0x9a968a);
  }, [4, 0, 2]);
}

/** Floating "deliver here" marker over a subscriber's mailbox. */
export function markerModel() {
  return part((v) => {
    for (let y = 0; y < 7; y++) {
      const r = 3 - Math.abs(y - 3);
      for (let x = -r; x <= r; x++) v.set(x, y, 0, y === 3 && x === 0 ? 0xffffff : 0xffcf3a);
    }
  }, [0.5, 3.5, 0.5], 0);
}
