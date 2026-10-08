import * as THREE from 'three';

/**
 * Damped spring integrated implicitly, so it stays stable at any stiffness.
 * zeta = 1 is critically damped (no overshoot); < 1 wobbles.
 */
export class Spring {
  v = 0;
  constructor(public x = 0, public omega = 10, public zeta = 1) {}

  step(target: number, dt: number): number {
    const w = this.omega;
    const c = 2 * this.zeta * w;
    this.v = (this.v + dt * w * w * (target - this.x)) / (1 + dt * c + dt * dt * w * w);
    this.x += dt * this.v;
    return this.x;
  }

  reset(x: number): void {
    this.x = x;
    this.v = 0;
  }
}

export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

const _d = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * Two-bone IK. Writes the middle joint (knee/elbow) and the reached end
 * (the target, pulled in if out of reach) into outJoint / outEnd.
 * `pole` is a direction the joint should bend toward.
 */
export function solveTwoBone(
  root: THREE.Vector3,
  target: THREE.Vector3,
  l1: number,
  l2: number,
  pole: THREE.Vector3,
  outJoint: THREE.Vector3,
  outEnd: THREE.Vector3,
): void {
  _d.subVectors(target, root);
  let d = _d.length();
  if (d < 1e-6) _d.set(0, -1, 0);
  else _d.multiplyScalar(1 / d);
  d = clamp(d, Math.abs(l1 - l2) + 0.05, l1 + l2 - 0.01);
  outEnd.copy(root).addScaledVector(_d, d);

  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _b.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_b.lengthSq() < 1e-8) _b.set(0, 0, -1).addScaledVector(_d, -_d.z);
  _b.normalize();
  outJoint.copy(root).addScaledVector(_d, l1 * cosA).addScaledVector(_b, l1 * sinA);
}

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

/**
 * Place a limb mesh (modelled hanging along -Y from its origin, front = -Z)
 * so it spans from -> to, with its front facing `front` as closely as possible.
 * The mesh must live directly under the scene with matrixAutoUpdate off.
 */
export function placeSegment(mesh: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, front: THREE.Vector3): void {
  _y.subVectors(from, to).normalize();
  _z.copy(front).addScaledVector(_y, -front.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, -1).addScaledVector(_y, -_y.z);
  _z.normalize().negate();
  _x.crossVectors(_y, _z);
  mesh.matrix.makeBasis(_x, _y, _z).setPosition(from);
  mesh.matrixWorldNeedsUpdate = true;
}

export function placeWithQuat(mesh: THREE.Object3D, pos: THREE.Vector3, q: THREE.Quaternion): void {
  mesh.matrix.compose(pos, q, _one);
  mesh.matrixWorldNeedsUpdate = true;
}
const _one = new THREE.Vector3(1, 1, 1);

/** Catmull-Rom through four points. */
export function catmull(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const t2 = t * t, t3 = t2 * t;
  const a = -0.5 * t3 + t2 - 0.5 * t;
  const b = 1.5 * t3 - 2.5 * t2 + 1;
  const c = -1.5 * t3 + 2 * t2 + 0.5 * t;
  const d = 0.5 * t3 - 0.5 * t2;
  return out.set(
    a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    a * p0.z + b * p1.z + c * p2.z + d * p3.z,
  );
}

/** Piecewise-linear lookup in a keyed curve: [[t, value], ...] sorted by t, smoothstepped between keys. */
export function curve(keys: readonly (readonly [number, number])[], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return lerp(v0, v1, smooth((t - t0) / (t1 - t0)));
    }
  }
  return keys[keys.length - 1][1];
}
