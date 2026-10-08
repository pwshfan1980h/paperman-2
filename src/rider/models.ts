import * as THREE from 'three';
import { Vox, voxMesh } from '../voxel/vox';
import { P } from './palette';

/*
 * Bike space: +Y up, -Z forward, +X to the rider's right, ground at y = 0.
 * Continuous coordinates in voxels. Rider parts are modelled in their own
 * local frames (documented per part) and posed by the rig.
 */

type V3 = readonly [number, number, number];

export const BIKE = {
  wheelR: 6.6,
  rearHub: [0, 6.6, 10] as V3,
  frontHub: [0, 6.6, -10.7] as V3,
  bb: [0, 6.5, 1.5] as V3,
  seatTop: [0, 15.5, 4] as V3,
  headTop: [0, 15.5, -7] as V3,
  headBottom: [0, 11.5, -8] as V3,
  crankLen: 4,
  pedalX: 4.6,
  /** hip joint centre when seated */
  saddleHip: [0, 20, 5.6] as V3,
  /** right grip centre at zero steer (left is mirrored) */
  grip: [6.4, 22, -4.6] as V3,
  frontContactZ: -10.7,
  rearContactZ: 10,
};

export const STEER_AXIS = new THREE.Vector3(
  BIKE.headTop[0] - BIKE.headBottom[0],
  BIKE.headTop[1] - BIKE.headBottom[1],
  BIKE.headTop[2] - BIKE.headBottom[2],
).normalize();

export const LIMB = {
  upperArm: 6,
  forearm: 7, // elbow to fist centre
  thigh: 8.5,
  shin: 8.5, // knee to ankle
  /** ball of the foot relative to the ankle, foot-local */
  ball: [0, -3, -2.5] as V3,
  /** shoulder joints, spine-local */
  shoulder: [5, 8.5, 0] as V3,
  /** hip joints, pelvis-local */
  hip: [2.2, 0, 0] as V3,
  neck: [0, 10, 0] as V3,
  bagAnchor: [0, 8.5, 2.5] as V3,
};


// ---------------------------------------------------------------- bike

export function wheel(): THREE.Mesh {
  const v = new Vox();
  const spokes = 8;
  for (let y = -7; y <= 6; y++)
    for (let z = -7; z <= 6; z++) {
      const cy = y + 0.5, cz = z + 0.5;
      const d = Math.hypot(cy, cz);
      const ang = Math.atan2(cy, cz);
      if (d < 6.75 && d >= 5.25) {
        const knob = Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 20) % 2 === 0;
        const c = d > 6.1 && knob ? P.tread : P.tire;
        v.set(-1, y, z, c).set(0, y, z, c);
      } else if (d < 5.25 && d >= 4.4) {
        v.set(-1, y, z, P.chrome).set(0, y, z, P.chrome);
      } else if (d < 4.4 && d >= 1.2) {
        for (let s = 0; s < spokes; s++) {
          const a = (s / spokes) * Math.PI * 2;
          const perp = Math.abs(cy * Math.cos(a) - cz * Math.sin(a));
          const along = cy * Math.sin(a) + cz * Math.cos(a);
          if (perp < 0.5 && along > 0) v.set(s % 2 ? -1 : 0, y, z, P.chromeDark);
        }
      } else if (d < 1.2) {
        v.box(-2, y, z, 1, y, z, P.chrome);
      }
    }
  // spoke reflector so the rotation reads at a glance
  v.set(0, 2, 1, P.reflector).set(-1, 2, 1, P.reflector);
  return voxMesh(v, [0, 0, 0], { grain: 0.03 });
}

export function frame(): THREE.Mesh {
  const v = new Vox();
  const { rearHub: RH, bb: BB, seatTop: ST, headTop: HT, headBottom: HB } = BIKE;
  const r = 0.8;
  // stays first so the main tubes win where they meet
  for (const x of [-1.5, 1.5]) {
    v.tube([x, BB[1], BB[2] + 1], [x, RH[1], RH[2]], 0.6, P.frame);
    v.tube([x, ST[1] - 1, ST[2] + 0.3], [x, RH[1], RH[2]], 0.6, P.frame);
  }
  v.tube(BB, ST, r, P.frame);
  v.tube(ST, HT, r, P.frameLight);
  v.tube(BB, HB, r, P.frame);
  v.tube(HB, HT, 1.0, P.frame);
  // gusset where top and down tube meet the head tube
  v.tube([0, 13.5, -5.5], [0, 12, -6.2], 0.7, P.frame);
  // bottom bracket shell
  v.box(-2, 6, 1, 1, 6, 1, P.chromeDark);
  // seatpost and saddle
  v.tube(ST, [0, 17, 4.6], 0.6, P.chrome);
  v.box(-2, 17, 3, 1, 17, 8, P.seat);
  v.box(-1, 17, 1, 0, 17, 2, P.seat);
  v.box(-2, 18, 6, 1, 18, 8, P.seat);
  // rear reflector under the saddle
  v.box(-1, 15, 7, 0, 16, 7, P.reflectorRed);
  // chain and rear cog on the drive side
  v.tube([2.5, BB[1] + 2.8, BB[2]], [2.5, RH[1] + 1.2, RH[2]], 0.5, P.chain);
  v.tube([2.5, BB[1] - 2.8, BB[2]], [2.5, RH[1] - 1.2, RH[2]], 0.5, P.chain);
  for (let y = -2; y <= 1; y++)
    for (let z = -2; z <= 1; z++)
      if (Math.hypot(y + 0.5, z + 0.5) < 1.8) v.set(2, Math.floor(RH[1]) + y, Math.floor(RH[2]) + z, P.chromeDark);
  // axle nuts
  v.set(2, 6, 10, P.chrome).set(-3, 6, 10, P.chrome);
  return voxMesh(v);
}

/** Origin at the bottom bracket. Right arm points -Z at crank angle 0. */
export function crank(): THREE.Mesh {
  const v = new Vox();
  for (let y = -4; y <= 3; y++)
    for (let z = -4; z <= 3; z++) {
      const d = Math.hypot(y + 0.5, z + 0.5);
      if (d < 3.4 && d >= 2.3) {
        const tooth = Math.floor(((Math.atan2(y + 0.5, z + 0.5) + Math.PI) / (2 * Math.PI)) * 16) % 2;
        v.set(2, y, z, tooth ? P.chrome : P.chromeDark);
      } else if (d < 2.3 && (Math.abs(y + 0.5) < 0.6 || Math.abs(z + 0.5) < 0.6)) {
        v.set(2, y, z, P.chromeDark);
      }
    }
  v.box(-3, -1, -1, 2, 0, 0, P.chrome);
  // arms: right forward, left back
  v.tube([3.5, 0, 0], [3.5, 0, -BIKE.crankLen], 0.6, P.chrome);
  v.tube([-3.5, 0, 0], [-3.5, 0, BIKE.crankLen], 0.6, P.chrome);
  return voxMesh(v, [0, 0, 0], { grain: 0.02 });
}

/** Origin at the top centre of the pedal (where the sole sits). */
export function pedal(): THREE.Mesh {
  const v = new Vox();
  v.box(-1, -1, -1, 1, -1, 0, P.chain);
  v.box(-1, -1, -1, -1, -1, 0, P.chromeDark);
  v.set(1, -1, -1, P.reflector).set(1, -1, 0, P.reflector);
  return voxMesh(v, [0.5, 0, 0]);
}

/**
 * Fork, stem, bars and number plate. Modelled in bike coordinates, origin at
 * the top of the head tube; the rig rotates it about STEER_AXIS.
 */
export function fork(): THREE.Mesh {
  const v = new Vox();
  const { frontHub: FH, headTop: HT } = BIKE;
  for (const x of [-1.5, 1.5]) v.tube([x, 11.2, -8.1], [x, FH[1], FH[2]], 0.6, P.chrome);
  v.box(-2, 11, -9, 1, 11, -8, P.chrome); // crown
  // stem
  v.tube(HT, [0, 17.5, -6.6], 0.8, P.chromeDark);
  v.box(-2, 17, -7, 1, 18, -6, P.chromeDark);
  // risers, crossbar, grips
  for (const s of [-1, 1]) {
    v.tube([s * 1.5, 17.6, -6.4], [s * 4.5, 22, -5], 0.55, P.chrome);
    v.tube([s * 4.2, 22, -5], [s * 7.8, 22, -4.4], 0.75, P.grip);
  }
  v.tube([-3.2, 19.8, -5.8], [3.2, 19.8, -5.8], 0.55, P.chrome);
  v.box(-2, 19, -6, 1, 20, -5, P.pad);
  // number plate, with a "1"
  v.box(-3, 18, -9, 2, 22, -9, P.plate);
  v.box(-1, 19, -10, 0, 21, -10, P.plate);
  v.paint(-1, 19, -10, -1, 21, -10, P.ink);
  v.set(-2, 21, -10, P.ink);
  return voxMesh(v, HT);
}

// ---------------------------------------------------------------- rider

/** Origin at the hip-joint centre. */
export function pelvis(): THREE.Mesh {
  const v = new Vox();
  v.box(-3, -2, -2, 2, 1, 1, P.jeans);
  v.box(-3, 1, -2, 2, 1, 1, P.belt);
  v.box(-1, 1, -3, 0, 1, -3, P.buckle);
  // back pockets
  v.paint(-3, -1, 1, -2, 0, 1, P.jeansDark);
  v.paint(1, -1, 1, 2, 0, 1, P.jeansDark);
  return voxMesh(v);
}

/** Origin at the spine base (top of the pelvis), chest rises along +Y. */
export function chest(): THREE.Mesh {
  const v = new Vox();
  v.box(-4, 0, -2, 3, 9, 2, P.tee);
  // taper the waist and round the shoulders
  for (const x of [-4, 3]) v.del(x, 0, -2).del(x, 0, 2).del(x, 9, -2).del(x, 9, 2);
  // raglan sleeves into the shoulders
  v.paint(-4, 6, -2, -4, 9, 2, P.sleeve);
  v.paint(3, 6, -2, 3, 9, 2, P.sleeve);
  v.paint(-3, 8, -2, -3, 9, 2, P.sleeve);
  v.paint(2, 8, -2, 2, 9, 2, P.sleeve);
  // ringer stripe
  v.paint(-4, 4, -2, 3, 4, 2, P.stripe);
  // hem shading
  v.paint(-4, 0, -2, 3, 0, 2, P.teeShade);
  // collar and neck opening
  v.paint(-2, 9, -2, 1, 9, -2, P.sleeve);
  v.paint(-1, 9, -1, 0, 9, 0, P.skin);
  // bag strap, left shoulder to right hip, front and back
  for (let y = 0; y <= 9; y++) {
    const x = Math.round(-3 + ((9 - y) * 6) / 9);
    for (const z of [-2, 2]) v.paint(x, y, z, x + 1, y, z, P.strap);
  }
  return voxMesh(v, [0, 0, 0.5]);
}

/** Origin at the base of the neck. Face looks -Z. */
export function head(): THREE.Mesh {
  const v = new Vox();
  v.box(-1, 0, -1, 0, 1, 0, P.skinShade); // neck
  v.box(-3, 1, -3, 2, 7, 2, P.skin);
  // jaw rounding
  for (const x of [-3, 2]) v.del(x, 1, -3).del(x, 1, 2);
  // face
  v.paint(-2, 4, -3, -2, 5, -3, P.ink);
  v.paint(1, 4, -3, 1, 5, -3, P.ink);
  v.paint(-3, 3, -3, -3, 3, -3, P.blush);
  v.paint(2, 3, -3, 2, 3, -3, P.blush);
  v.paint(-1, 2, -3, 0, 2, -3, P.mouth);
  v.set(-1, 3, -4, P.skinShade).set(0, 3, -4, P.skinShade); // nose
  // ears
  v.box(-4, 3, -1, -4, 4, 0, P.skin).box(3, 3, -1, 3, 4, 0, P.skin);
  // hair: back and sides
  v.paint(-3, 2, 2, 2, 6, 2, P.hair);
  v.paint(-3, 4, -1, -3, 6, 1, P.hair);
  v.paint(2, 4, -1, 2, 6, 1, P.hair);
  v.paint(-3, 6, -3, 2, 6, -3, P.hair); // fringe
  v.box(-2, 4, 3, 1, 6, 3, P.hairDark); // tuft out the back
  v.box(-1, 3, 3, 0, 3, 3, P.hairDark);
  // cap
  v.box(-3, 7, -3, 2, 8, 2, P.cap);
  v.box(-2, 9, -2, 1, 9, 1, P.cap);
  v.paint(-3, 7, -3, 2, 7, 2, P.capDark);
  v.box(-3, 7, -6, 2, 7, -4, P.cap); // brim
  v.del(-3, 7, -6).del(2, 7, -6);
  v.paint(-1, 8, -3, 0, 8, -3, P.capLogo);
  v.set(-1, 10, -1, P.capDark).set(0, 10, -1, P.capDark);
  return voxMesh(v);
}

/** Origin at the shoulder, hangs along -Y. */
export function upperArm(): THREE.Mesh {
  const v = new Vox();
  v.box(-1, -7, -1, 1, 0, 1, P.skin);
  v.paint(-1, -3, -1, 1, 0, 1, P.sleeve);
  v.paint(-1, -3, -1, 1, -3, 1, P.capDark);
  return voxMesh(v, [0.5, 0, 0.5]);
}

/** Origin at the elbow, fist centre at y = -LIMB.forearm. */
export function forearm(): THREE.Mesh {
  const v = new Vox();
  v.box(-1, -6, -1, 1, 0, 1, P.skin);
  v.paint(-1, -5, -1, 1, -5, 1, P.sleeve); // wristband
  v.box(-1, -8, -1, 1, -6, 1, P.skin);
  v.box(-1, -8, -2, 1, -7, -2, P.skinShade); // knuckles
  return voxMesh(v, [0.5, 0, 0.5]);
}

export function thigh(): THREE.Mesh {
  const v = new Vox();
  v.box(-1, -9, -1, 1, 0, 1, P.jeans);
  v.paint(-1, -9, -1, 1, -9, -1, P.jeansDark);
  return voxMesh(v, [0.5, 0, 0.5]);
}

/** Origin at the knee, ankle at y = -LIMB.shin. */
export function shin(): THREE.Mesh {
  const v = new Vox();
  v.box(-1, -8, -1, 1, 0, 1, P.jeans);
  v.paint(-1, -5, -1, 1, -4, 1, P.cuff);
  v.paint(-1, -8, -1, 1, -6, 1, P.sock);
  return voxMesh(v, [0.5, 0, 0.5]);
}

/** Origin at the ankle, toe points -Z, sole at y = -3. */
export function foot(): THREE.Mesh {
  const v = new Vox();
  v.box(-1, -3, -5, 1, -1, 1, P.shoe);
  v.del(-1, -1, -5).del(1, -1, -5).del(-1, -1, 1).del(1, -1, 1);
  v.paint(-1, -3, -5, 1, -3, 1, P.sole);
  v.paint(-1, -2, -3, -1, -2, 0, P.shoeAccent);
  v.paint(1, -2, -3, 1, -2, 0, P.shoeAccent);
  v.paint(0, -1, -4, 0, -1, -2, P.lace);
  return voxMesh(v, [0.5, 0, 0.5]);
}

/** Origin at the strap anchor on the upper back; the bag hangs below and behind. */
export function bag(): THREE.Mesh {
  const v = new Vox();
  v.box(-3, -11, 0, 2, -4, 3, P.bag);
  v.paint(-3, -11, 0, 2, -11, 3, P.bagShade);
  v.box(-3, -6, 4, 2, -4, 4, P.flap); // flap folded over the back face
  v.box(-1, -8, 4, 0, -7, 4, P.flap);
  v.paint(-1, -7, 4, 0, -7, 4, P.bagPatch);
  v.box(-3, -11, 2, -3, -4, 2, P.bagShade);
  // rolled papers standing in the mouth
  for (const x of [-3, -1, 1]) {
    v.box(x, -3, 0, x + 1, -1, 1, P.paper);
    v.paint(x, -2, 0, x + 1, -2, 1, P.paperBand);
  }
  // strap loops up to the anchor
  v.box(-3, -3, 2, -3, 0, 2, P.strap);
  v.box(2, -3, 2, 2, 0, 2, P.strap);
  return voxMesh(v, [0, 0, 0]);
}

/** Rolled newspaper, long axis along X, centred. */
export function paperRoll(): THREE.Mesh {
  const v = new Vox();
  v.box(-3, -1, -1, 2, 0, 0, P.paper);
  v.paint(-1, -1, -1, 0, 0, 0, P.paperBand);
  v.paint(-3, 0, -1, -2, 0, -1, P.paperPrint);
  return voxMesh(v, [0, 0, 0]);
}

export function star(): THREE.Mesh {
  const v = new Vox();
  v.box(-1, 0, 0, 1, 0, 0, P.star).box(0, -1, 0, 0, 1, 0, P.star);
  const m = voxMesh(v, [0.5, 0.5, 0.5], { grain: 0 });
  m.castShadow = false;
  return m;
}

