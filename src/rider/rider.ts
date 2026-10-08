import * as THREE from 'three';
import * as Models from './models';
import { BIKE, LIMB, STEER_AXIS } from './models';
import { P } from './palette';
import {
  Spring, clamp, lerp, smooth, easeOut, curve, catmull,
  solveTwoBone, placeSegment, placeWithQuat,
} from './motion';

export interface RideInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

export type Mode = 'ride' | 'crash' | 'respawn';

/** voxels / second; one voxel is ~4 cm, so cruise is ~3.2 m/s */
export const CRUISE = 80;
export const FAST = 165;
const GRAVITY = 245;
const GEAR = 2.6;
/** the three true headings: straight, and +/- this many radians */
export const HEADING_MAX = 0.52;
const WHEELBASE = BIKE.rearHub[2] - BIKE.frontHub[2];
const THROW_TIME = 0.62;
const STEP = 1 / 240;

const v3 = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2]);

/* Throw path for the right hand in spine space (mirrored in x for the left). */
const THROW_KEYS = [0, 0.2, 0.4, 0.52, 0.66, 1];
const THROW_PTS = [
  null, // grip, filled in per frame
  v3([2.0, 6.5, 4.8]), // into the bag
  v3([8.5, 11.5, 4.5]), // cocked back and up
  v3([13, 8.5, -3]), // release, out to the side
  v3([6.5, 3.5, -9]), // follow through across the front
  null,
];
const RELEASE_T = 0.52;
const TWIST_KEYS = [[0, 0], [0.2, -0.12], [0.4, -0.5], [0.52, 0.32], [0.66, 0.42], [1, 0]] as const;
const LOOK_KEYS = [[0, 0], [0.15, 0.35], [0.45, 0.95], [0.6, 0.85], [1, 0]] as const;

interface Paper {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  q: THREE.Quaternion;
  axis: THREE.Vector3;
  spin: number;
  landed: boolean;
  age: number;
}

interface Dust {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
}

export class Rider {
  /** Add this to the scene. It must stay at the identity transform. */
  readonly root = new THREE.Group();

  // ---- telemetry / state
  mode: Mode = 'ride';
  speed = CRUISE;
  time = 0;
  crankAngle = 0;
  crankVel = 0;
  /** total distance the ground has moved; the rider stays put and the world scrolls */
  readonly groundShift = new THREE.Vector3();
  readonly groundVel = new THREE.Vector3();

  readonly heading = new Spring(0, 6.5, 1);
  readonly lean = new Spring(0, 13, 0.85);
  readonly steer = new Spring(0, 16, 0.8);
  readonly effort = new Spring(0.45, 4, 1);
  readonly stand = new Spring(0, 5, 0.9);
  readonly brake = new Spring(0, 7, 1);
  readonly footDown = new Spring(0, 4.5, 1);
  private readonly bump = new Spring(0, 24, 0.3);
  private readonly absorb = new Spring(0, 9, 0.5);
  private readonly bagPitch = new Spring(0, 6, 0.22);
  private readonly bagRoll = new Spring(0, 6, 0.22);
  private readonly look = new Spring(0, 8, 1);
  private readonly accelS = new Spring(0, 6, 1);

  yawRate = 0;
  skid = 0;
  private frontAngle = 0;
  private rearAngle = 0;
  private bumpTimer = 1;
  private prevSpeed = CRUISE;
  private input: RideInput = { left: false, right: false, up: false, down: false };

  throwT = -1;
  throwSide = 1;
  private throwQueue: number[] = [];
  private released = false;

  private crashT = 0;
  private crashSpeed = 0;
  private crashLanded = -1;
  private readonly crashVel = new THREE.Vector3();
  private readonly crashPos = new THREE.Vector3();
  private readonly crashQ0 = new THREE.Quaternion();
  private crashSlide = 0;
  private crashEndo = 0;
  private crashLean = 0;
  private respawnT = 0;
  private plantedDust = false;

  // ---- hierarchy
  private readonly bikeRoot = new THREE.Group();
  private readonly endo = new THREE.Group();
  private readonly leanG = new THREE.Group();
  private readonly bumpG = new THREE.Group();
  private readonly frameM = Models.frame();
  private readonly rearWheel = Models.wheel();
  private readonly frontWheel = Models.wheel();
  private readonly crankM = Models.crank();
  private readonly forkM = Models.fork();
  private readonly pedals = [Models.pedal(), Models.pedal()];

  private readonly riderRoot = new THREE.Group();
  private readonly pelvisM = Models.pelvis();
  private readonly spine = new THREE.Group();
  private readonly chestM = Models.chest();
  private readonly neck = new THREE.Group();
  private readonly headM = Models.head();
  private readonly bagPivot = new THREE.Group();
  private readonly bagM = Models.bag();
  private readonly shoulders = [new THREE.Object3D(), new THREE.Object3D()];
  private readonly hips = [new THREE.Object3D(), new THREE.Object3D()];

  // index 0 = left, 1 = right
  private readonly upperArms = [Models.upperArm(), Models.upperArm()];
  private readonly forearms = [Models.forearm(), Models.forearm()];
  private readonly thighs = [Models.thigh(), Models.thigh()];
  private readonly shins = [Models.shin(), Models.shin()];
  private readonly feet = [Models.foot(), Models.foot()];
  private readonly handPaper = Models.paperRoll();
  private readonly stars = [Models.star(), Models.star(), Models.star()];

  private readonly papers: Paper[] = [];
  private readonly dust: Dust[] = [];
  private readonly dustMesh: THREE.InstancedMesh;

  // joint positions from the last pose, for the debug skeleton
  readonly joints = {
    hip: [new THREE.Vector3(), new THREE.Vector3()],
    knee: [new THREE.Vector3(), new THREE.Vector3()],
    ankle: [new THREE.Vector3(), new THREE.Vector3()],
    shoulder: [new THREE.Vector3(), new THREE.Vector3()],
    elbow: [new THREE.Vector3(), new THREE.Vector3()],
    hand: [new THREE.Vector3(), new THREE.Vector3()],
    pelvis: new THREE.Vector3(),
    neck: new THREE.Vector3(),
  };

  constructor() {
    this.root.add(this.bikeRoot);
    this.bikeRoot.add(this.endo);
    this.endo.add(this.leanG);
    this.leanG.add(this.bumpG);
    this.endo.position.z = BIKE.frontContactZ;
    this.leanG.position.z = -BIKE.frontContactZ;

    this.bumpG.add(this.frameM, this.rearWheel, this.crankM, this.forkM, ...this.pedals);
    this.rearWheel.position.set(...BIKE.rearHub);
    this.crankM.position.set(...BIKE.bb);
    this.forkM.position.set(...BIKE.headTop);
    this.forkM.add(this.frontWheel);
    this.frontWheel.position.set(
      BIKE.frontHub[0] - BIKE.headTop[0],
      BIKE.frontHub[1] - BIKE.headTop[1],
      BIKE.frontHub[2] - BIKE.headTop[2],
    );

    this.bumpG.add(this.riderRoot);
    this.riderRoot.add(this.pelvisM, this.spine, ...this.hips);
    this.spine.position.set(0, 2, 0);
    this.spine.add(this.chestM, this.neck, this.bagPivot, ...this.shoulders);
    this.neck.position.set(...LIMB.neck);
    this.neck.add(this.headM);
    this.bagPivot.position.set(...LIMB.bagAnchor);
    this.bagPivot.add(this.bagM);
    this.shoulders.forEach((o, i) => o.position.set((i ? 1 : -1) * LIMB.shoulder[0], LIMB.shoulder[1], LIMB.shoulder[2]));
    this.hips.forEach((o, i) => o.position.set((i ? 1 : -1) * LIMB.hip[0], LIMB.hip[1], LIMB.hip[2]));

    const free = [...this.upperArms, ...this.forearms, ...this.thighs, ...this.shins, ...this.feet, this.handPaper, ...this.stars];
    for (const m of free) {
      m.matrixAutoUpdate = false;
      this.root.add(m);
    }
    this.handPaper.visible = false;
    for (const s of this.stars) s.visible = false;

    this.dustMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: P.dust }),
      160,
    );
    this.dustMesh.count = 0;
    this.dustMesh.frustumCulled = false;
    this.root.add(this.dustMesh);

    this.crankAngle = 0.3;
    this.pose();
  }

  // ------------------------------------------------------------ commands

  setInput(i: RideInput): void {
    this.input = { ...i };
  }

  throwPaper(side: -1 | 1): void {
    if (this.mode === 'crash' || this.footDown.x > 0.5) return;
    if (this.throwT < 0) this.startThrow(side);
    else if (this.throwQueue.length < 2) this.throwQueue.push(side);
  }

  private startThrow(side: number): void {
    this.throwT = 0;
    this.throwSide = side;
    this.released = false;
    this.bagPitch.v -= 1.5;
  }

  crash(): void {
    if (this.mode !== 'ride') return;
    this.mode = 'crash';
    this.crashT = 0;
    this.crashLanded = -1;
    this.crashSpeed = Math.max(this.speed, 70);
    this.crashSlide = this.crashSpeed * 0.4;
    this.crashEndo = 0;
    this.crashLean = this.lean.x;
    this.speed = 0;
    this.throwT = -1;
    this.throwQueue.length = 0;
    this.handPaper.visible = false;

    this.root.attach(this.riderRoot);
    this.crashPos.copy(this.riderRoot.position);
    this.crashQ0.copy(this.riderRoot.quaternion);
    const fwd = this.dir(0, 0, -1);
    this.crashVel.copy(fwd).multiplyScalar(this.crashSpeed * 0.75).add(new THREE.Vector3(0, 80, 0));

    // the bag empties
    const bagPos = this.bagM.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -2, 0));
    for (let i = 0; i < 6; i++) {
      const v = fwd.clone().multiplyScalar(this.crashSpeed * (0.3 + Math.random() * 0.5));
      v.x += (Math.random() - 0.5) * 90;
      v.y = 50 + Math.random() * 60;
      this.spawnPaper(bagPos, v);
    }
  }

  // ------------------------------------------------------------ simulation

  update(dt: number): void {
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(STEP, left);
      this.step(h);
      left -= h;
    }
    this.pose();
  }

  private step(dt: number): void {
    this.time += dt;
    if (this.mode === 'crash') this.stepCrash(dt);
    else this.stepRide(dt);
    this.stepPapers(dt);
    this.stepDust(dt);
  }

  private stepRide(dt: number): void {
    const inp = this.input;
    if (this.mode === 'respawn') {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.mode = 'ride';
    }
    const steerIn = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);

    // speed
    const target = inp.down ? 0 : inp.up ? FAST : CRUISE;
    if (this.speed < target) {
      const push = inp.up ? 120 : 60;
      this.speed = Math.min(target, this.speed + push * (1 - 0.45 * this.speed / FAST) * (this.footDown.x > 0.3 ? 0.4 : 1) * dt);
    } else {
      this.speed = Math.max(target, this.speed - (inp.down ? 140 : 30) * dt);
    }
    const accel = (this.speed - this.prevSpeed) / dt;
    this.prevSpeed = this.speed;
    this.accelS.step(accel, dt);

    // body modes
    this.footDown.step(inp.down && this.speed < 6 ? 1 : 0, dt);
    if (this.footDown.x > 0.85 && !this.plantedDust) {
      this.plantedDust = true;
      this.puff(this.bumpG.localToWorld(new THREE.Vector3(-7, 0, 2)), 5, 10);
    }
    if (this.footDown.x < 0.3) this.plantedDust = false;
    this.stand.step(inp.up && this.footDown.x < 0.3 ? 1 : 0, dt);
    this.brake.step(inp.down && this.speed > 2 ? 1 : 0, dt);
    const pedaling = !inp.down && this.footDown.x < 0.5;
    this.effort.step(!pedaling ? 0 : inp.up ? 1 : this.speed < target - 4 ? 0.75 : 0.45, dt);

    // crank: locked to the wheel while pedaling, settles to level pedals when coasting
    if (pedaling) {
      const want = Math.max(this.speed / (BIKE.wheelR * GEAR), 2.4 * this.effort.x);
      this.crankVel += (want - this.crankVel) * Math.min(1, dt * 10);
    } else {
      // stopping: right pedal up front, ready to push off
      const base = this.footDown.x > 0.05 || inp.down ? -0.7 : 0;
      const tgt = base + Math.round((this.crankAngle - base) / Math.PI) * Math.PI;
      const w = 9;
      this.crankVel += (w * w * (tgt - this.crankAngle) - 2 * w * this.crankVel) * dt;
    }
    this.crankAngle += this.crankVel * dt;

    // wheels; the rear locks in a hard skid
    this.skid = this.brake.x * clamp((this.speed - 30) / 60, 0, 1);
    this.frontAngle += (this.speed / BIKE.wheelR) * dt;
    if (this.skid < 0.5) this.rearAngle += (this.speed / BIKE.wheelR) * dt;
    if (this.skid > 0.3 && Math.random() < this.skid * 0.7) {
      this.puff(this.bumpG.localToWorld(new THREE.Vector3((Math.random() - 0.5) * 2, 0, BIKE.rearContactZ)), 1, 6);
    }

    // heading follows input; the bike can only turn while rolling
    const mobility = clamp(this.speed / 40, 0, 1);
    this.heading.step(steerIn * HEADING_MAX, dt * mobility);
    this.yawRate = this.heading.v * mobility;

    // lean balances the turn; standing makes the bike rock under the rider
    const ramp = clamp(this.speed / 30, 0, 1);
    const rock = -this.stand.x * 0.13 * Math.cos(this.crankAngle) * ramp;
    const turnLean = Math.atan((this.speed * this.yawRate) / GRAVITY);
    this.lean.step(clamp(turnLean, -0.62, 0.62) + rock - this.footDown.x * 0.17, dt);

    // fork: kinematic steer at speed, input-driven at walking pace, a flick of countersteer
    const kin = Math.atan((WHEELBASE * this.yawRate) / Math.max(this.speed, 10));
    let st = lerp(steerIn * 0.45, kin, ramp) - 0.035 * this.lean.v + this.stand.x * 0.06 * Math.cos(this.crankAngle) * ramp;
    if (this.throwT >= 0) st += Math.sin(this.throwT * Math.PI * 2) * 0.03 * this.throwSide;
    this.steer.step(clamp(st, -0.7, 0.7), dt);

    // road texture
    this.bumpTimer -= dt * (this.speed / CRUISE);
    if (this.bumpTimer < 0) {
      this.bumpTimer = 1.2 + Math.random() * 2.5;
      const k = 0.6 + Math.random() * 0.6;
      this.bump.v += 10 * k;
      this.absorb.v -= 16 * k * (1 - this.stand.x * 0.4);
      this.bagPitch.v += 2.5 * k;
    }
    this.bump.step(0, dt);
    this.absorb.step(0, dt);

    // secondary: the bag hangs from the shoulder and swings
    this.bagPitch.step(-this.spinePitch() * 0.45 - clamp(this.accelS.x * 0.004, -0.4, 0.4), dt);
    this.bagRoll.step(this.lean.x * 0.6 + this.yawRate * 0.15, dt);

    // head looks where the bike is going, or at the throw
    let lookT = -(steerIn * HEADING_MAX - this.heading.x) * 1.1;
    if (this.throwT >= 0) lookT -= this.throwSide * curve(LOOK_KEYS, this.throwT);
    this.look.step(lookT, dt);

    // throw timeline
    if (this.throwT >= 0) {
      this.throwT += dt / THROW_TIME;
      if (this.throwT >= 1) {
        this.throwT = -1;
        const next = this.throwQueue.shift();
        if (next !== undefined) this.startThrow(next);
      }
    }

    // ground moves opposite the bike
    const h = this.heading.x;
    this.groundVel.set(-Math.sin(h) * this.speed, 0, Math.cos(h) * this.speed);
    this.groundShift.addScaledVector(this.groundVel, dt);
  }

  private stepCrash(dt: number): void {
    const t = (this.crashT += dt);
    this.groundVel.set(0, 0, 0);

    // bike: noses over, falls on its side, slides to a stop
    this.crashEndo = 0.5 * Math.sin(clamp(t / 0.55, 0, 1) * Math.PI);
    const fall = clamp((t - 0.25) / 0.6, 0, 1);
    this.crashLean = lerp(this.crashLean, -1.36 * bounceOut(fall), Math.min(1, dt * 30));
    this.crashSlide *= Math.exp(-2.5 * dt);
    this.bikeRoot.position.addScaledVector(this.dir(0, 0, -1, this.bikeRoot), this.crashSlide * dt);
    this.steer.step(0.65, dt);
    this.rearAngle += (this.crashSpeed / BIKE.wheelR) * Math.exp(-0.7 * t) * dt;
    if (fall > 0.95 && this.crashSlide > 8 && Math.random() < 0.5) {
      this.puff(this.bikeRoot.localToWorld(new THREE.Vector3(0, 0, 0)), 1, 8);
    }

    // rider: ballistic over the bars, lands on his back and skids
    this.crashVel.y -= GRAVITY * dt;
    this.crashPos.addScaledVector(this.crashVel, dt);
    const floor = 2.6;
    if (this.crashPos.y < floor) {
      this.crashPos.y = floor;
      if (this.crashLanded < 0) {
        this.crashLanded = t;
        this.puff(this.crashPos.clone().setY(0), 12, 22);
      }
      if (this.crashVel.y < 0) this.crashVel.y = -this.crashVel.y * 0.2;
      this.crashVel.x *= Math.exp(-5 * dt);
      this.crashVel.z *= Math.exp(-5 * dt);
    }

    if (t > 3.1) this.respawn();
  }

  private respawn(): void {
    this.mode = 'respawn';
    this.respawnT = 1.2;
    this.bumpG.add(this.riderRoot);
    this.bikeRoot.position.set(0, 0, 0);
    this.crashEndo = 0;
    this.speed = 0;
    this.prevSpeed = 0;
    this.heading.reset(0);
    this.lean.reset(0);
    this.steer.reset(0);
    this.stand.reset(0);
    this.brake.reset(0);
    this.footDown.reset(1);
    this.effort.reset(0);
    this.crankAngle = -0.7;
    this.crankVel = 0;
    for (const s of this.stars) s.visible = false;
  }

  private stepPapers(dt: number): void {
    for (let i = this.papers.length - 1; i >= 0; i--) {
      const p = this.papers[i];
      p.age += dt;
      if (!p.landed) {
        p.vel.y -= GRAVITY * dt;
        p.pos.addScaledVector(p.vel, dt);
        p.q.premultiply(new THREE.Quaternion().setFromAxisAngle(p.axis, p.spin * dt));
        if (p.pos.y < 1) {
          p.pos.y = 1;
          const rel = p.vel.clone().sub(this.groundVel);
          if (-rel.y > 30) {
            rel.y = -rel.y * 0.3;
            rel.x *= 0.5;
            rel.z *= 0.5;
            p.spin *= 0.5;
            p.vel.copy(rel).add(this.groundVel);
            this.puff(p.pos.clone().setY(0), 2, 6);
          } else {
            p.landed = true;
          }
        }
      } else {
        // skid to rest against the ground, settle flat
        const rel = p.vel.clone().sub(this.groundVel).multiplyScalar(Math.exp(-6 * dt));
        rel.y = 0;
        p.vel.copy(rel).add(this.groundVel);
        p.pos.addScaledVector(p.vel, dt);
        const along = new THREE.Vector3(1, 0, 0).applyQuaternion(p.q).setY(0);
        if (along.lengthSq() > 1e-4) {
          const flat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), along.normalize());
          p.q.slerp(flat, Math.min(1, dt * 12));
        }
      }
      placeWithQuat(p.mesh, p.pos, p.q);
      if (p.age > 10 || p.pos.lengthSq() > 450 * 450) {
        this.root.remove(p.mesh);
        this.papers.splice(i, 1);
      }
    }
  }

  private spawnPaper(pos: THREE.Vector3, vel: THREE.Vector3, q?: THREE.Quaternion): void {
    const mesh = Models.paperRoll();
    mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
    const axis = new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize();
    this.papers.push({
      mesh, pos: pos.clone(), vel: vel.clone(), q: q ? q.clone() : new THREE.Quaternion(),
      axis, spin: 14 + Math.random() * 6, landed: false, age: 0,
    });
  }

  private puff(at: THREE.Vector3, n: number, spread: number): void {
    for (let i = 0; i < n && this.dust.length < 160; i++) {
      const max = 0.4 + Math.random() * 0.5;
      this.dust.push({
        pos: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2)),
        vel: this.groundVel.clone().multiplyScalar(0.8).add(new THREE.Vector3(
          (Math.random() - 0.5) * spread, 4 + Math.random() * spread * 0.6, (Math.random() - 0.5) * spread)),
        life: max, max, size: 0.9 + Math.random() * 1.1,
      });
    }
  }

  private stepDust(dt: number): void {
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i];
      d.life -= dt;
      if (d.life <= 0) { this.dust.splice(i, 1); continue; }
      d.vel.y -= 6 * dt;
      d.vel.lerp(this.groundVel, Math.min(1, dt * 2));
      d.pos.addScaledVector(d.vel, dt);
    }
  }

  // ------------------------------------------------------------ pose

  private spinePitch(): number {
    return -(0.3 + 0.14 * (this.speed / FAST) + 0.26 * this.stand.x) + this.brake.x * 0.24 + this.footDown.x * 0.22;
  }

  /** World direction of a bike-local axis. */
  private dir(x: number, y: number, z: number, obj: THREE.Object3D = this.bumpG): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).transformDirection(obj.matrixWorld);
  }

  private pose(): void {
    const crashing = this.mode === 'crash';
    const a = this.crankAngle;

    // ---- bike
    const fishtail = this.skid * 0.07 * Math.sin(this.time * 11);
    this.bikeRoot.rotation.set(0, -(this.heading.x + fishtail), 0);
    this.endo.rotation.x = -(crashing ? this.crashEndo : 0);
    this.leanG.rotation.z = -(crashing ? this.crashLean : this.lean.x);
    this.bumpG.position.y = crashing ? 0 : Math.max(-0.3, this.bump.x);
    this.rearWheel.rotation.x = -this.rearAngle;
    this.frontWheel.rotation.x = -this.frontAngle;
    this.crankM.rotation.x = -a;
    this.forkM.quaternion.setFromAxisAngle(STEER_AXIS, -this.steer.x);
    const pedalPos = [0, 1].map((i) => {
      const ai = a + (i ? 0 : Math.PI);
      return new THREE.Vector3(
        (i ? 1 : -1) * BIKE.pedalX,
        BIKE.bb[1] - BIKE.crankLen * Math.sin(ai),
        BIKE.bb[2] - BIKE.crankLen * Math.cos(ai),
      );
    });
    this.pedals.forEach((p, i) => p.position.copy(pedalPos[i]));

    // ---- torso
    const s = this.stand.x, b = this.brake.x, f = this.footDown.x, ef = this.effort.x;
    const pitch = crashing ? 0.15 : this.spinePitch();
    let twist = 0, sideBend = 0;
    if (this.throwT >= 0) {
      twist = this.throwSide * curve(TWIST_KEYS, this.throwT);
      sideBend = -this.throwSide * 0.12 * Math.sin(this.throwT * Math.PI);
    }
    if (!crashing) {
      const c2 = Math.cos(a) * Math.cos(a);
      this.riderRoot.position.set(
        BIKE.saddleHip[0] - f * 0.6,
        BIKE.saddleHip[1] + s * (3.6 - 1.1 * c2) + b * 1.2 - f * 0.4 + this.absorb.x,
        BIKE.saddleHip[2] - s * 3.2 + b * 2.6 - f * 3.2,
      );
      const hipRoll = (s * 0.13 + (1 - s) * ef * 0.04) * Math.cos(a) + f * 0.12;
      this.riderRoot.rotation.set(-0.06 * s, 0, -hipRoll);
    } else {
      const t = this.crashT;
      const flip = -(Math.PI * 1.5) * easeOut(clamp(t / 0.8, 0, 1));
      const wob = Math.sin(t * 7) * 0.25 * Math.exp(-t * 1.5);
      this.riderRoot.position.copy(this.crashPos);
      this.riderRoot.quaternion.copy(this.crashQ0)
        .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(flip, wob, wob * 0.6)));
    }
    this.spine.rotation.set(pitch, twist, sideBend + (crashing ? 0 : this.lean.x * 0.3 + f * 0.05));

    const headPitch = crashing ? Math.sin(this.crashT * 9) * 0.3 * Math.exp(-this.crashT) : -pitch * 0.72 - 0.06;
    this.neck.rotation.set(headPitch, crashing ? 0 : this.look.x, crashing ? 0.2 : this.lean.x * 0.45 - sideBend * 0.5);
    this.bagPivot.rotation.set(this.bagPitch.x, 0, this.bagRoll.x);

    this.root.updateMatrixWorld(true);

    // ---- frames for limb solving
    const fwd = this.dir(0, 0, -1, crashing ? this.riderRoot : this.bumpG);
    const up = this.dir(0, 1, 0, crashing ? this.riderRoot : this.bumpG);
    const right = this.dir(1, 0, 0, crashing ? this.riderRoot : this.bumpG);
    const bumpQ = this.bumpG.getWorldQuaternion(new THREE.Quaternion());
    const J = this.joints;
    J.pelvis.setFromMatrixPosition(this.riderRoot.matrixWorld);
    this.neck.getWorldPosition(J.neck);

    // ---- legs
    for (let i = 0; i < 2; i++) {
      const sd = i ? 1 : -1;
      const ai = a + (i ? 0 : Math.PI);
      const hip = this.hips[i].getWorldPosition(J.hip[i]);
      const ankleT = new THREE.Vector3();
      const footQ = new THREE.Quaternion();

      if (!crashing) {
        const phi = (0.05 + 0.24 * Math.cos(ai - 0.5)) * (0.5 + 0.5 * Math.min(1, ef * 2));
        const qLocal = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), phi);
        const ankleLocal = pedalPos[i].clone().sub(v3(LIMB.ball).applyQuaternion(qLocal));
        ankleT.copy(ankleLocal);
        this.bumpG.localToWorld(ankleT);
        footQ.copy(bumpQ).multiply(qLocal);
        if (i === 0 && f > 0.001) {
          // left foot comes off the pedal and plants on the road
          const plant = this.bumpG.localToWorld(new THREE.Vector3(-7.5, 0, 2.5));
          plant.y = -LIMB.ball[1];
          ankleT.lerp(plant, smooth(f)).addScaledVector(up, 5 * Math.sin(Math.PI * f));
          const groundQ = this.bikeRoot.getWorldQuaternion(new THREE.Quaternion());
          footQ.slerp(groundQ, smooth(f));
        }
      } else {
        const t = this.crashT;
        const land = this.crashLanded < 0 ? 0 : smooth(clamp((t - this.crashLanded) / 0.3, 0, 1));
        const flail = new THREE.Vector3(sd * (3 + 2.5 * Math.sin(14 * t + sd)), -13 + 3 * Math.cos(16 * t), -4 + 5 * Math.sin(12 * t + sd));
        const sprawl = new THREE.Vector3(sd * 5.5, -14.5, -1);
        ankleT.copy(this.hips[i].position).add(flail.lerp(sprawl, land));
        this.riderRoot.localToWorld(ankleT);
        footQ.copy(this.riderRoot.getWorldQuaternion(new THREE.Quaternion()))
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.4 * land - 0.3));
      }

      const pole = fwd.clone().addScaledVector(up, 0.3).addScaledVector(right, sd * 0.25);
      solveTwoBone(hip, ankleT, LIMB.thigh, LIMB.shin, pole, J.knee[i], J.ankle[i]);
      placeSegment(this.thighs[i], hip, J.knee[i], pole);
      placeSegment(this.shins[i], J.knee[i], J.ankle[i], pole);
      placeWithQuat(this.feet[i], J.ankle[i], footQ);
    }

    // ---- arms
    this.handPaper.visible = false;
    for (let i = 0; i < 2; i++) {
      const sd = i ? 1 : -1;
      const sh = this.shoulders[i].getWorldPosition(J.shoulder[i]);
      const gripLocal = new THREE.Vector3(sd * BIKE.grip[0], BIKE.grip[1], BIKE.grip[2]).sub(v3(BIKE.headTop));
      const grip = this.forkM.localToWorld(gripLocal);
      const handT = grip.clone();
      const pole = right.clone().multiplyScalar(sd * 0.7).addScaledVector(up, -0.6).addScaledVector(fwd, -0.5);
      let holding = false;

      if (crashing) {
        const t = this.crashT;
        const land = this.crashLanded < 0 ? 0 : smooth(clamp((t - this.crashLanded) / 0.3, 0, 1));
        const flail = new THREE.Vector3(sd * (5 + 3 * Math.sin(17 * t + sd)), 4 + 4 * Math.cos(15 * t), -2 + 4 * Math.sin(13 * t));
        const sprawl = new THREE.Vector3(sd * 10, 4, -1.5);
        handT.copy(this.shoulders[i].position).add(flail.lerp(sprawl, land));
        this.spine.localToWorld(handT);
      } else if (this.throwT >= 0 && sd === this.throwSide) {
        const t = this.throwT;
        const g = this.spine.worldToLocal(grip.clone());
        const pts = THROW_PTS.map((p) => (p ? new THREE.Vector3(p.x * sd, p.y, p.z) : g));
        let k = 0;
        while (k < THROW_KEYS.length - 2 && t > THROW_KEYS[k + 1]) k++;
        let u = clamp((t - THROW_KEYS[k]) / (THROW_KEYS[k + 1] - THROW_KEYS[k]), 0, 1);
        u = k === 2 ? u * u : k === 3 ? easeOut(u) : smooth(u);
        catmull(pts[Math.max(0, k - 1)], pts[k], pts[k + 1], pts[Math.min(pts.length - 1, k + 2)], u, handT);
        this.spine.localToWorld(handT);
        pole.copy(new THREE.Vector3(sd, -0.4, 0.7).transformDirection(this.spine.matrixWorld));
        holding = t >= THROW_KEYS[1] && t < RELEASE_T;
      }

      solveTwoBone(sh, handT, LIMB.upperArm, LIMB.forearm, pole, J.elbow[i], J.hand[i]);
      placeSegment(this.upperArms[i], sh, J.elbow[i], fwd);
      placeSegment(this.forearms[i], J.elbow[i], J.hand[i], fwd.clone().addScaledVector(up, 0.5));

      if (holding) {
        this.handPaper.visible = true;
        this.handPaper.matrix.copy(this.forearms[i].matrix).setPosition(J.hand[i]);
        this.handPaper.matrixWorldNeedsUpdate = true;
      }
      if (!crashing && this.throwT >= RELEASE_T && !this.released && sd === this.throwSide) {
        this.released = true;
        const vel = right.clone().setY(0).normalize().multiplyScalar(sd * 105)
          .add(new THREE.Vector3(0, 55, 0))
          .addScaledVector(fwd.clone().setY(0).normalize(), 15);
        this.spawnPaper(J.hand[i], vel, new THREE.Quaternion().setFromRotationMatrix(this.forearms[i].matrix));
        this.bagPitch.v += 1;
      }
    }

    // ---- crash stars
    const showStars = crashing && this.crashLanded >= 0 && this.crashT - this.crashLanded > 0.35;
    this.stars.forEach((st, i) => {
      st.visible = showStars;
      if (!showStars) return;
      const ang = this.crashT * 4 + (i * Math.PI * 2) / 3;
      const c = this.headM.getWorldPosition(new THREE.Vector3());
      const p = c.add(new THREE.Vector3(Math.cos(ang) * 5, 8 + Math.sin(ang * 2) * 0.6, Math.sin(ang) * 5));
      placeWithQuat(st, p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.crashT * 6 + i, 0)));
    });

    // ---- dust
    const m = new THREE.Matrix4();
    this.dust.forEach((d, i) => {
      const k = d.size * (d.life / d.max);
      m.makeScale(k, k, k).setPosition(d.pos);
      this.dustMesh.setMatrixAt(i, m);
    });
    this.dustMesh.count = this.dust.length;
    this.dustMesh.instanceMatrix.needsUpdate = true;

    // respawn blink
    const vis = this.mode !== 'respawn' || Math.floor(this.respawnT * 12) % 2 === 0;
    this.bikeRoot.visible = vis;
    for (const g of [this.upperArms, this.forearms, this.thighs, this.shins, this.feet]) for (const o of g) o.visible = vis;
  }

  get cadenceRpm(): number {
    return (this.crankVel / (Math.PI * 2)) * 60;
  }
}

function bounceOut(t: number): number {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}
