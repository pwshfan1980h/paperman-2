import * as THREE from 'three';
import type { Rider } from '../../rider/rider';
import type { World } from '../world/world';
import type { Collider, Spawn } from '../world/types';
import { Particles } from './particles';
import * as M from './models';
import { Rng } from '../rng';

export interface Ctx {
  rider: Rider;
  world: World;
  particles: Particles;
  time: number;
  day: number;
  sfx: (name: string, at?: THREE.Vector3) => void;
  event: (name: string, e: Entity, value?: number) => void;
}

const TAU = Math.PI * 2;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);

function turn(cur: number, target: number, rate: number, dt: number) {
  const d = wrap(target - cur);
  return cur + Math.sign(d) * Math.min(Math.abs(d), rate * dt);
}

let STARS: THREE.Mesh | null = null;
function starsMesh() {
  if (!STARS) STARS = M.part((v) => { v.box(-1, 0, 0, 1, 0, 0, 0xffe14a).box(0, -1, 0, 0, 1, 0, 0xffe14a); }, [0.5, 0.5, 0.5], 0);
  const m = STARS.clone();
  m.castShadow = false;
  return m;
}

function bang(color = 0xd8322f) {
  const m = M.part((v) => { v.box(0, 2, 0, 1, 6, 0, color); v.box(0, 0, 0, 1, 0, 0, color); }, [1, 0, 0.5], 0);
  m.castShadow = false;
  return m;
}

export abstract class Entity {
  x = 0;
  z = 0;
  y = 0;
  yaw = 0;
  radius = 4;
  height = 6;
  /** knocks the rider off when they touch */
  hazard = false;
  dead = false;
  readonly root = new THREE.Group();
  pieceRef?: object;

  abstract update(dt: number, c: Ctx): void;
  /** a paper reached this entity; return true if it absorbed the paper */
  paperHit?(at: THREE.Vector3, c: Ctx): boolean;
  /** rider ran into a hazard */
  bumped?(c: Ctx): void;
  dispose(_c: Ctx) {}

  protected place() {
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.y = this.yaw;
  }
  dist(c: Ctx) {
    return Math.hypot(c.rider.pos.x - this.x, c.rider.pos.z - this.z);
  }
}

// ================================================================ dog

export class Dog extends Entity {
  private rig: M.QuadRig;
  private breed: M.DogBreed;
  private state: 'sleep' | 'sit' | 'alert' | 'chase' | 'return' | 'dizzy' = 'sit';
  private t = 0;
  private phase = 0;
  private speed = 0;
  private home: THREE.Vector2;
  private stars: THREE.Mesh[] = [];
  private alertMark = bang();
  private barkT = 0;

  constructor(s: Spawn, c0: Ctx) {
    super();
    const rng = new Rng(s.variant ?? 1);
    this.breed = M.BREEDS[rng.int(0, M.BREEDS.length - 1)];
    this.rig = M.dogRig(this.breed);
    const scale = rng.range(0.95, 1.15);
    this.rig.root.scale.setScalar(scale);
    this.root.add(this.rig.root);
    this.x = s.x; this.z = s.z;
    this.y = c0.world.groundAt(s.x, s.z);
    this.home = new THREE.Vector2(s.x, s.z);
    this.yaw = (s.side ?? 1) > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.fenced = !!s.fenced;
    this.area = s.area;
    this.state = rng.chance(0.6 - c0.day * 0.1) ? 'sleep' : 'sit';
    this.radius = this.breed.len * 0.45 * scale;
    this.height = this.rig.height * scale;
    this.hazard = true;
    this.alertMark.visible = false;
    this.alertMark.position.y = this.height + 6;
    this.root.add(this.alertMark);
    for (let i = 0; i < 3; i++) { const st = starsMesh(); st.visible = false; this.root.add(st); this.stars.push(st); }
    this.place();
  }
  private fenced: boolean;
  private area?: Spawn['area'];

  update(dt: number, c: Ctx) {
    this.t += dt;
    const r = c.rider;
    const dx = r.pos.x - this.x, dz = r.pos.z - this.z;
    const dist = Math.hypot(dx, dz);
    const approaching = dz > -40; // rider hasn't gone past yet
    let want = 0;
    let face = this.yaw;
    const sleepK = this.state === 'sleep' ? 1 : 0;

    switch (this.state) {
      case 'sleep':
        if (dist < 70 && approaching && r.mode !== 'crash') this.to('alert', c);
        break;
      case 'sit':
        face = yawTo(dx, dz);
        if (dist < 95 && approaching && r.mode !== 'crash') this.to('alert', c);
        break;
      case 'alert':
        face = yawTo(dx, dz);
        if (this.t > 0.75) this.to('chase', c);
        break;
      case 'chase': {
        // aim a little ahead of the bike on later days; early in the week they just run at you
        const lead = c.day * 0.06;
        const tx = r.pos.x + r.vel.x * lead, tz = r.pos.z + r.vel.z * lead;
        face = yawTo(tx - this.x, tz - this.z);
        want = this.breed.speed * (0.72 + c.day * 0.05);
        this.barkT -= dt;
        if (this.barkT < 0) { this.barkT = 0.5 + Math.random() * 0.6; c.sfx('bark', this.root.position); }
        if (this.t > 2.4 + c.day * 0.35 || dist > 150 || r.mode === 'crash') this.to('return', c);
        break;
      }
      case 'return': {
        const hx = this.home.x - this.x, hz = this.home.y - this.z;
        face = yawTo(hx, hz);
        want = 45;
        if (Math.hypot(hx, hz) < 4) { this.to('sit', c); }
        break;
      }
      case 'dizzy':
        if (this.t > 3.5) this.to('return', c);
        break;
    }

    this.yaw = turn(this.yaw, face, 9, dt);
    this.speed += (want - this.speed) * Math.min(1, dt * 6);
    this.x += -Math.sin(this.yaw) * this.speed * dt;
    this.z += -Math.cos(this.yaw) * this.speed * dt;
    if (this.fenced && this.area) {
      this.x = Math.max(this.area.x0 + 3, Math.min(this.area.x1 - 3, this.x));
      this.z = Math.max(this.area.z0 + 3, Math.min(this.area.z1 - 3, this.z));
    }
    this.y = c.world.groundAt(this.x, this.z);
    this.place();

    // ---- animation
    const k = Math.min(1, this.speed / 50);
    this.phase += dt * (4 + this.speed * 0.22);
    const rig = this.rig;
    const legsAmp = 0.85 * k;
    const gallop = [0, 0.3, Math.PI, Math.PI + 0.3];
    rig.legs.forEach((l, i) => {
      if (sleepK) l.rotation.x = i < 2 ? -1.4 : 1.4;
      else if (this.state === 'sit' || this.state === 'dizzy') l.rotation.x = i < 2 ? 0 : -1.1;
      else l.rotation.x = Math.sin(this.phase + gallop[i]) * legsAmp;
    });
    const baseY = rig.legLen + this.breed.h / 2;
    rig.body.position.y = sleepK ? this.breed.h / 2 + 0.2 : baseY + Math.abs(Math.sin(this.phase)) * 1.2 * k;
    rig.body.rotation.x = this.state === 'sit' || this.state === 'dizzy' ? -0.35 : Math.sin(this.phase * 2) * 0.06 * k;
    rig.body.scale.y = sleepK ? 1 + Math.sin(this.t * 2.5) * 0.04 : 1;
    rig.tail.rotation.y = Math.sin(this.t * (this.state === 'chase' ? 20 : 8)) * (sleepK ? 0.05 : 0.6);
    rig.head.rotation.x = sleepK ? 0.5 : this.state === 'alert' ? -0.3 + Math.sin(this.t * 30) * 0.2 : 0;
    rig.ears.forEach((e, i) => (e.rotation.z = (i ? -1 : 1) * (0.15 + Math.sin(this.phase * 2) * 0.3 * k)));
    this.alertMark.visible = this.state === 'alert' || (this.state === 'chase' && this.t < 1);
    this.alertMark.rotation.y = -this.yaw + Math.PI / 4;
    this.stars.forEach((s, i) => {
      s.visible = this.state === 'dizzy';
      const a = this.t * 5 + (i * TAU) / 3;
      s.position.set(Math.cos(a) * 4, this.height + 1, Math.sin(a) * 4);
    });
  }

  private to(s: Dog['state'], c: Ctx) {
    this.state = s;
    this.t = 0;
    if (s === 'alert') c.sfx('bark', this.root.position);
  }

  paperHit(_at: THREE.Vector3, c: Ctx) {
    if (this.state === 'dizzy') return false;
    this.to('dizzy', c);
    this.speed = 0;
    c.sfx('yelp', this.root.position);
    c.event('stun', this, 50);
    return true;
  }

  bumped(c: Ctx) {
    this.to('return', c);
  }

  get chasing() {
    return this.state === 'chase';
  }
}

// ================================================================ cat

export class Cat extends Entity {
  private rig: M.QuadRig;
  private state: 'sit' | 'groom' | 'loaf' | 'watch' | 'dash' | 'flee' | 'perched' = 'sit';
  private t = 0;
  private phase = 0;
  private speed = 0;
  private tx = 0;
  private tz = 0;
  private dasher: boolean;
  private perch: string;
  private baseY: number;
  private mark = bang(0xffcf3a);

  constructor(s: Spawn, c: Ctx) {
    super();
    const rng = new Rng(s.variant ?? 3);
    this.rig = M.catRig(M.CAT_COATS[rng.int(0, M.CAT_COATS.length - 1)]);
    this.root.add(this.rig.root);
    this.x = s.x; this.z = s.z;
    this.perch = s.perch ?? 'lawn';
    this.baseY = s.y ?? 2;
    this.y = this.perch === 'fence' ? this.baseY : c.world.groundAt(s.x, s.z);
    this.yaw = (s.side ?? 1) > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.dasher = (this.perch === 'sidewalk' || this.perch === 'lawn') && rng.chance(0.35 + c.day * 0.1);
    this.state = this.perch === 'fence' ? 'perched' : rng.pick(['sit', 'groom', 'loaf'] as const);
    this.radius = 4;
    this.height = 8;
    this.mark.visible = false;
    this.mark.scale.setScalar(0.7);
    this.mark.position.y = 13;
    this.root.add(this.mark);
    this.side = s.side ?? 1;
    this.place();
  }
  private side: number;

  update(dt: number, c: Ctx) {
    this.t += dt;
    const r = c.rider;
    const dx = r.pos.x - this.x, dz = r.pos.z - this.z;
    const dist = Math.hypot(dx, dz);
    let want = 0;
    let face = this.yaw;
    const ahead = this.z - r.pos.z; // >0 when the cat is still in front... (rider moves -z)
    this.hazard = this.y < 3 && (this.state === 'dash' || Math.abs(this.x) < 50);

    switch (this.state) {
      case 'sit': case 'groom': case 'loaf': case 'watch': case 'perched':
        if (dist < 90) face = yawTo(dx, dz);
        if (this.dasher && -ahead > 45 && -ahead < 95 && r.speed > 30) {
          this.state = 'dash';
          this.t = 0;
          this.tx = -this.side * (60 + Math.random() * 20);
          this.tz = this.z - 10;
          c.sfx('meow', this.root.position);
        }
        break;
      case 'dash':
        face = yawTo(this.tx - this.x, this.tz - this.z);
        want = 150;
        if (Math.hypot(this.tx - this.x, this.tz - this.z) < 6) { this.state = 'sit'; this.dasher = false; this.side = -this.side; }
        break;
      case 'flee':
        face = yawTo(this.tx - this.x, this.tz - this.z);
        want = 120;
        if (Math.hypot(this.tx - this.x, this.tz - this.z) < 6 || this.t > 2) { this.state = 'watch'; this.t = 0; }
        break;
    }
    this.yaw = turn(this.yaw, face, this.state === 'dash' ? 20 : 6, dt);
    this.speed += (want - this.speed) * Math.min(1, dt * 10);
    this.x += -Math.sin(this.yaw) * this.speed * dt;
    this.z += -Math.cos(this.yaw) * this.speed * dt;
    if (this.state !== 'perched') this.y = c.world.groundAt(this.x, this.z);
    this.place();

    // animation
    const rig = this.rig;
    const k = Math.min(1, this.speed / 40);
    this.phase += dt * (3 + this.speed * 0.25);
    const loaf = this.state === 'loaf';
    const sitting = this.state === 'sit' || this.state === 'groom' || this.state === 'watch' || this.state === 'perched';
    rig.legs.forEach((l, i) => {
      if (loaf) l.rotation.x = i < 2 ? -1.5 : 1.5;
      else if (sitting) l.rotation.x = i < 2 ? (this.state === 'groom' && i === 0 ? -1.2 + Math.sin(this.t * 6) * 0.3 : 0) : -1.3;
      else l.rotation.x = Math.sin(this.phase + (i === 0 || i === 3 ? 0 : Math.PI)) * 1.1 * k;
    });
    rig.body.position.y = loaf ? 2 : sitting ? 4 : 4.5 + Math.abs(Math.sin(this.phase)) * k;
    rig.body.rotation.x = sitting && !loaf ? -0.55 : 0;
    rig.head.rotation.x = this.state === 'groom' ? 0.5 + Math.sin(this.t * 6) * 0.25 : sitting && !loaf ? 0.45 : 0;
    rig.tail.rotation.x = this.state === 'flee' ? 1.4 : sitting ? -0.2 : 0.4;
    rig.tail.rotation.y = Math.sin(this.t * 2.2) * 0.8;
    rig.ears[0].rotation.x = Math.sin(this.t * 2.2 + 1) * 0.5;
    this.mark.visible = this.state === 'dash' && this.t < 0.8;
    this.mark.rotation.y = -this.yaw + Math.PI / 4;
  }

  paperHit(_at: THREE.Vector3, c: Ctx) {
    this.scare(c);
    return false;
  }

  scare(c: Ctx) {
    if (this.state === 'flee' || this.state === 'perched') return;
    this.state = 'flee';
    this.t = 0;
    this.tx = this.x + this.side * 50;
    this.tz = this.z + (Math.random() - 0.5) * 60;
    c.sfx('hiss', this.root.position);
  }

  bumped(c: Ctx) {
    c.sfx('yowl', this.root.position);
    this.state = 'flee';
    this.t = 0;
    this.tx = this.x + this.side * 60;
    this.tz = this.z - 40;
  }
}

// ================================================================ bot mower

export class Mower extends Entity {
  private m: ReturnType<typeof M.mowerModel>;
  private area: NonNullable<Spawn['area']>;
  private lane = 0;
  private dir = -1;
  private stunned = 0;
  private rogue: boolean;
  private t = 0;
  private wanderT = 0;
  private targetYaw = 0;
  private speed = 22;

  constructor(s: Spawn, c: Ctx) {
    super();
    const rng = new Rng((s.variant ?? 1) * 13 + c.day);
    this.m = M.mowerModel(M.MOWER_COLORS[rng.int(0, M.MOWER_COLORS.length - 1)]);
    this.root.add(this.m.root);
    this.area = s.area!;
    this.x = this.area.x0 + 8;
    this.z = rng.range(this.area.z0 + 8, this.area.z1 - 8);
    this.rogue = c.day >= 2 && rng.chance(0.25 + (c.day - 2) * 0.15);
    this.speed = this.rogue ? 34 : 22;
    this.y = c.world.groundAt(this.x, this.z);
    this.hazard = true;
    this.radius = 6;
    this.height = 6;
    this.targetYaw = this.yaw = 0;
    this.place();
  }

  update(dt: number, c: Ctx) {
    this.t += dt;
    if (this.stunned > 0) {
      this.stunned -= dt;
      this.yaw += dt * 14;
      if (Math.random() < 0.3) c.particles.emit(new THREE.Vector3(this.x, this.y + 5, this.z), 1, { color: [0xffe14a, 0xff8a2a], speed: 30, up: 30, size: 0.8, life: 0.4 });
      this.place();
      this.m.led.visible = Math.floor(this.t * 10) % 2 === 0;
      return;
    }
    const a = this.area;
    if (!this.rogue) {
      // boustrophedon: stripes along z, step outward at each end
      const laneX = Math.min(a.x1 - 6, a.x0 + 6 + this.lane * 9);
      const endZ = this.dir < 0 ? a.z0 + 6 : a.z1 - 6;
      const tx = laneX, tz = endZ;
      this.targetYaw = yawTo(tx - this.x, tz - this.z);
      if (Math.abs(this.z - endZ) < 3 && Math.abs(this.x - laneX) < 3) {
        this.dir = -this.dir;
        this.lane++;
        if (a.x0 + 6 + this.lane * 9 > a.x1 - 6) this.lane = 0;
      }
    } else {
      // rogue: wanders off the lawn and out into the street
      this.wanderT -= dt;
      if (this.wanderT < 0) {
        this.wanderT = 1 + Math.random() * 1.8;
        const toRoad = Math.random() < 0.6;
        const tx = toRoad ? (Math.random() - 0.5) * 60 : this.x + (Math.random() - 0.5) * 80;
        this.targetYaw = yawTo(tx - this.x, (Math.random() - 0.6) * 80);
        if (Math.random() < 0.5) c.sfx('beep', this.root.position);
      }
      this.z = Math.max(a.z0 - 40, Math.min(a.z1 + 40, this.z));
      if (Math.abs(this.x) > Math.max(Math.abs(a.x0), Math.abs(a.x1))) this.targetYaw = yawTo(-this.x, 0);
    }
    this.yaw = turn(this.yaw, this.targetYaw, this.rogue ? 3 : 2.2, dt);
    const nx = this.x - Math.sin(this.yaw) * this.speed * dt;
    const nz = this.z - Math.cos(this.yaw) * this.speed * dt;
    if (!c.world.blocked(nx, nz, this.y + 2, 3)) { this.x = nx; this.z = nz; }
    else this.targetYaw = this.yaw + Math.PI * 0.7;
    this.y = c.world.groundAt(this.x, this.z);
    this.place();
    this.m.wheels.forEach((w) => (w.rotation.x -= dt * this.speed * 0.6));
    this.m.led.visible = Math.floor(this.t * (this.rogue ? 6 : 1.5)) % 2 === 0;
    this.m.root.position.y = Math.abs(Math.sin(this.t * 18)) * 0.25;
    if (Math.abs(this.x) > 46 && Math.random() < dt * 14)
      c.particles.emit(new THREE.Vector3(this.x + Math.sin(this.yaw) * 6, this.y + 1, this.z + Math.cos(this.yaw) * 6), 1, { color: [0x6ac04a, 0x4a9a3a], speed: 8, up: 10, size: 0.6, life: 0.6 });
  }

  paperHit(_at: THREE.Vector3, c: Ctx) {
    if (this.stunned > 0) return false;
    this.stunned = 3;
    c.sfx('bonk', this.root.position);
    c.event('stun', this, 50);
    return true;
  }
}

// ================================================================ birds

interface Bird {
  rig: ReturnType<typeof M.birdRig>;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  flying: boolean;
  hopT: number;
  peck: number;
  phase: number;
}

export class Flock extends Entity {
  private birds: Bird[] = [];
  private scared = false;
  private t = 0;

  constructor(s: Spawn, c: Ctx) {
    super();
    const rng = new Rng(Math.floor(s.x * 7 + s.z * 13));
    const n = rng.int(4, 8);
    const kinds = s.variant === 2 ? [2, 4] : s.variant === 4 ? [5, 1] : [s.variant ?? 0];
    this.x = s.x; this.z = s.z;
    for (let i = 0; i < n; i++) {
      const rig = M.birdRig(M.BIRD_KINDS[rng.pick(kinds)]);
      const b: Bird = { rig, x: s.x + rng.range(-12, 12), z: s.z + rng.range(-14, 14), y: 0, vx: 0, vy: 0, vz: 0, flying: false, hopT: rng.range(0, 2), peck: 0, phase: rng.range(0, 6) };
      b.y = c.world.groundAt(b.x, b.z);
      rig.root.rotation.y = rng.range(0, TAU);
      this.birds.push(b);
      this.root.add(rig.root);
    }
  }

  scare(c: Ctx, from: THREE.Vector3) {
    if (this.scared) return;
    this.scared = true;
    c.sfx('flutter', new THREE.Vector3(this.x, 5, this.z));
    for (const b of this.birds) {
      const ax = b.x - from.x, az = b.z - from.z;
      const l = Math.hypot(ax, az) || 1;
      const sp = 40 + Math.random() * 30;
      b.vx = (ax / l) * sp + (Math.random() - 0.5) * 30;
      b.vz = (az / l) * sp - 30 - Math.random() * 30;
      b.vy = 45 + Math.random() * 35;
      b.flying = true;
      b.rig.root.rotation.y = yawTo(b.vx, b.vz);
    }
  }

  update(dt: number, c: Ctx) {
    this.t += dt;
    if (!this.scared && this.dist(c) < 60) this.scare(c, c.rider.pos);
    let alive = false;
    for (const b of this.birds) {
      if (b.flying) {
        b.vy += (12 - b.vy) * dt * 0.8;
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        b.phase += dt * 30;
        const flap = Math.sin(b.phase);
        b.rig.wings[0].rotation.z = flap * 1.1;
        b.rig.wings[1].rotation.z = -flap * 1.1;
        b.rig.body.rotation.x = -0.3;
        if (b.y < 240) alive = true;
      } else {
        alive = true;
        b.hopT -= dt;
        if (b.hopT < 0) {
          b.hopT = 0.4 + Math.random() * 1.6;
          if (Math.random() < 0.5) {
            b.peck = 0.35;
          } else {
            const a = Math.random() * TAU;
            b.x += Math.cos(a) * 2; b.z += Math.sin(a) * 2;
            b.rig.root.rotation.y = a;
            b.y = c.world.groundAt(b.x, b.z) + 1.2;
          }
        }
        b.peck = Math.max(0, b.peck - dt);
        b.rig.head.rotation.x = b.peck > 0 ? Math.sin((b.peck / 0.35) * Math.PI * 2) * 0.9 : 0;
        b.rig.wings.forEach((w, i) => (w.rotation.z = (i ? -1 : 1) * 0.1));
        b.y += (c.world.groundAt(b.x, b.z) - b.y) * Math.min(1, dt * 20);
      }
      b.rig.root.position.set(b.x, b.y, b.z);
    }
    if (!alive) this.dead = true;
  }
}

// ================================================================ ducks / geese / squirrel

export class Ducks extends Entity {
  private ducks: ReturnType<typeof M.duckRig>[] = [];
  private path: THREE.Vector3[] = [];
  private target = new THREE.Vector3();
  private area: NonNullable<Spawn['area']>;
  private t = 0;
  private quackT = 2;

  constructor(s: Spawn) {
    super();
    this.area = s.area!;
    for (let i = 0; i < 5; i++) {
      const d = M.duckRig(i === 0);
      this.ducks.push(d);
      this.root.add(d.root);
      this.path.push(new THREE.Vector3(s.x + i * 4, 1.2, s.z));
    }
    this.newTarget();
  }

  private newTarget() {
    const a = this.area;
    this.target.set(a.x0 + Math.random() * (a.x1 - a.x0), 1.2, a.z0 + Math.random() * (a.z1 - a.z0));
  }

  update(dt: number, c: Ctx) {
    this.t += dt;
    const lead = this.path[0];
    const d = this.target.clone().sub(lead);
    if (d.length() < 3) this.newTarget();
    d.setY(0).normalize().multiplyScalar(10 * dt);
    lead.add(d);
    for (let i = 1; i < this.path.length; i++) {
      const p = this.path[i], q = this.path[i - 1];
      const off = p.clone().sub(q);
      if (off.length() > 4) p.copy(q).add(off.setLength(4));
    }
    this.ducks.forEach((dk, i) => {
      const p = this.path[i];
      const q = i === 0 ? this.target : this.path[i - 1];
      dk.root.position.set(p.x, 1.2 + Math.sin(this.t * 3 + i) * 0.2, p.z);
      dk.root.rotation.y = yawTo(q.x - p.x, q.z - p.z);
      dk.head.rotation.x = Math.sin(this.t * 2 + i * 2) * 0.15;
    });
    this.quackT -= dt;
    if (this.quackT < 0) {
      this.quackT = 2 + Math.random() * 4;
      if (this.dist(c) < 200) c.sfx('quack', lead);
    }
  }
}

export class Geese extends Entity {
  private g: ReturnType<typeof M.gooseRig>[] = [];
  private t = 0;
  private v: THREE.Vector3;

  constructor(from: THREE.Vector3, dir: THREE.Vector3) {
    super();
    this.v = dir.clone().setLength(70);
    for (let i = 0; i < 7; i++) {
      const goose = M.gooseRig();
      const row = Math.ceil(i / 2), sd = i % 2 ? 1 : -1;
      goose.root.position.copy(from).add(new THREE.Vector3(sd * row * 10, Math.random() * 3, row * 12).applyAxisAngle(new THREE.Vector3(0, 1, 0), yawTo(dir.x, dir.z)));
      goose.root.rotation.y = yawTo(dir.x, dir.z);
      goose.root.userData.phase = i * 0.7;
      this.g.push(goose);
      this.root.add(goose.root);
    }
  }

  update(dt: number, c: Ctx) {
    this.t += dt;
    for (const goose of this.g) {
      goose.root.position.addScaledVector(this.v, dt);
      const f = Math.sin(this.t * 7 + goose.root.userData.phase);
      goose.wings[0].rotation.z = f * 0.7;
      goose.wings[1].rotation.z = -f * 0.7;
    }
    if (Math.floor(this.t * 1.3) !== Math.floor((this.t - dt) * 1.3) && Math.random() < 0.6) c.sfx('honkGoose', this.g[0].root.position);
    if (this.t > 14) this.dead = true;
  }
}

export class Squirrel extends Entity {
  private s = M.squirrelRig();
  private t = 0;
  private running = false;
  private vx = 0;

  constructor(sp: Spawn, c: Ctx) {
    super();
    this.root.add(this.s.root);
    this.x = sp.x; this.z = sp.z; this.y = c.world.groundAt(sp.x, sp.z);
    this.radius = 2; this.height = 4;
    this.place();
  }

  update(dt: number, c: Ctx) {
    this.t += dt;
    if (!this.running && this.dist(c) < 80) { this.running = true; this.vx = -Math.sign(this.x) * 110; c.sfx('chitter', this.root.position); }
    if (this.running) {
      this.x += this.vx * dt;
      this.z += Math.sin(this.t * 14) * 40 * dt;
      this.yaw = yawTo(this.vx, 0);
      this.s.root.position.y = Math.abs(Math.sin(this.t * 20)) * 2;
      if (Math.abs(this.x) > 200) this.dead = true;
    }
    this.s.tail.rotation.x = Math.sin(this.t * 9) * 0.4;
    this.y = c.world.groundAt(this.x, this.z);
    this.hazard = false;
    this.place();
  }
}

// ================================================================ cars

export class Car extends Entity {
  private m: ReturnType<typeof M.carModel>;
  private collider?: Collider;
  private honked = false;
  vx = 0;
  vz = 0;

  constructor(x: number, z: number, yaw: number, variant: number, c: Ctx, parked: boolean) {
    super();
    this.m = M.carModel(variant);
    this.root.add(this.m.mesh);
    this.x = x; this.z = z; this.yaw = yaw;
    this.y = parked ? c.world.groundAt(x, z) : 0;
    this.height = this.m.height;
    this.radius = this.m.len / 2;
    this.place();
    if (parked) {
      const along = Math.abs(Math.sin(yaw)) > 0.5; // facing along x
      const hl = this.m.len / 2, hw = this.m.width / 2;
      this.collider = { x0: x - (along ? hl : hw), x1: x + (along ? hl : hw), z0: z - (along ? hw : hl), z1: z + (along ? hw : hl), top: this.y + 18, kind: 'solid', tag: 'car' };
      c.world.addCollider(this.collider);
    } else this.hazard = true;
  }

  update(dt: number, c: Ctx) {
    if (!this.hazard) return;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.place();
    if (!this.honked && this.dist(c) < 90) { this.honked = true; c.sfx('horn', this.root.position); }
    if (Math.abs(this.x) > 700 || this.z > c.rider.pos.z + 400 || this.z < c.rider.pos.z - 1400) this.dead = true;
  }

  /** oriented rectangle test against a point on the ground */
  contains(px: number, pz: number, pad = 2) {
    const dx = px - this.x, dz = pz - this.z;
    const s = Math.sin(this.yaw), co = Math.cos(this.yaw);
    const along = -dx * s - dz * co;
    const across = dx * co - dz * s;
    return Math.abs(along) < this.m.len / 2 + pad && Math.abs(across) < this.m.width / 2 + pad;
  }

  dispose(c: Ctx) {
    if (this.collider) c.world.removeCollider(this.collider);
  }
}

// ================================================================ street objects

export class Mailbox extends Entity {
  private m: ReturnType<typeof M.mailboxModel>;
  private marker = M.markerModel();
  private collider: Collider;
  private flagT = 1;
  private t = Math.random() * 5;
  subscriber = false;
  delivered = false;
  readonly house: number;

  constructor(s: Spawn, c: Ctx) {
    super();
    this.house = s.house!;
    this.m = M.mailboxModel(M.MAILBOX_COLORS[this.house % M.MAILBOX_COLORS.length]);
    this.root.add(this.m.root);
    this.marker.castShadow = false;
    this.marker.scale.setScalar(1.6);
    this.marker.position.y = 30;
    this.root.add(this.marker);
    this.x = s.x; this.z = s.z;
    this.y = c.world.groundAt(s.x, s.z);
    this.yaw = (s.side ?? 1) > 0 ? -Math.PI / 2 : Math.PI / 2;
    this.place();
    this.collider = { x0: s.x - 1.5, x1: s.x + 1.5, z0: s.z - 1.5, z1: s.z + 1.5, top: this.y + 18, kind: 'solid', tag: 'mailbox' };
    c.world.addCollider(this.collider);
  }

  setState(subscriber: boolean, delivered: boolean) {
    this.subscriber = subscriber;
    this.delivered = delivered;
    this.flagT = subscriber && !delivered ? 1 : 0;
  }

  /** world-space box a paper has to enter */
  get slot() {
    return new THREE.Box3(new THREE.Vector3(this.x - 7, this.y + 6, this.z - 9), new THREE.Vector3(this.x + 7, this.y + 30, this.z + 9));
  }

  private wob = 0;
  deliver(c: Ctx) {
    this.delivered = true;
    this.wob = 1;
    c.particles.emit(new THREE.Vector3(this.x, this.y + 18, this.z), 18, { color: [0xffe14a, 0xffffff, 0xff8a2a], speed: 30, up: 30, size: 0.9, life: 0.7 });
  }

  update(dt: number) {
    this.t += dt;
    const flagTarget = this.subscriber && !this.delivered ? 0 : -Math.PI / 2;
    this.flagT += (flagTarget - this.flagT) * Math.min(1, dt * 8);
    this.m.flag.rotation.z = this.flagT;
    this.marker.visible = this.subscriber && !this.delivered;
    this.marker.position.y = 30 + Math.sin(this.t * 3) * 1.5;
    this.marker.rotation.y = this.t * 2;
    this.wob = Math.max(0, this.wob - dt * 2.5);
    this.m.box.rotation.z = Math.sin(this.t * 40) * 0.25 * this.wob;
    this.m.box.scale.setScalar(1 + this.wob * 0.25);
  }

  paperHit(_at: THREE.Vector3, c: Ctx) {
    c.sfx('thunk', this.root.position);
    return false;
  }

  dispose(c: Ctx) {
    c.world.removeCollider(this.collider);
  }
}

export class Trash extends Entity {
  private m: ReturnType<typeof M.trashModel>;
  private lidV = new THREE.Vector3();
  private lidOff = false;

  constructor(s: Spawn, c: Ctx) {
    super();
    this.m = M.trashModel(s.variant ?? 0);
    this.root.add(this.m.root);
    this.x = s.x; this.z = s.z; this.y = c.world.groundAt(s.x, s.z);
    this.hazard = true;
    this.radius = 4;
    this.height = 12;
    this.place();
  }

  update(dt: number) {
    if (this.lidOff) {
      this.lidV.y -= 200 * dt;
      this.m.lid.position.addScaledVector(this.lidV, dt);
      this.m.lid.rotation.x += dt * 12;
      if (this.m.lid.position.y < 0.5) { this.m.lid.position.y = 0.5; this.lidV.set(0, 0, 0); this.m.lid.rotation.x = Math.PI / 2; }
    }
  }

  paperHit(_at: THREE.Vector3, c: Ctx) {
    if (!this.lidOff) { this.lidOff = true; this.lidV.set((Math.random() - 0.5) * 30, 50, -20); c.sfx('clang', this.root.position); }
    return true;
  }
}

export class Cone extends Entity {
  private mesh = M.coneModel();
  private knocked = false;
  private v = new THREE.Vector3();
  private spin = new THREE.Vector3();

  constructor(s: Spawn, c: Ctx) {
    super();
    this.root.add(this.mesh);
    this.x = s.x; this.z = s.z; this.y = c.world.groundAt(s.x, s.z);
    this.radius = 3.5;
    this.height = 9;
    this.place();
  }

  update(dt: number, c: Ctx) {
    if (!this.knocked) {
      const r = c.rider;
      const fx = r.pos.x + Math.sin(r.heading.x) * 10, fz = r.pos.z - Math.cos(r.heading.x) * 10;
      if (r.mode !== 'crash' && r.pos.y - this.y < 8 && (Math.hypot(fx - this.x, fz - this.z) < 5 || this.dist(c) < 5)) {
        this.knocked = true;
        this.v.set(r.vel.x * 0.9 + (Math.random() - 0.5) * 40, 50 + Math.random() * 30, r.vel.z * 0.9);
        this.spin.set(Math.random() * 10, Math.random() * 6, Math.random() * 10);
        c.sfx('tock', this.root.position);
        c.event('cone', this);
      }
      return;
    }
    this.v.y -= 220 * dt;
    this.x += this.v.x * dt; this.z += this.v.z * dt; this.y += this.v.y * dt;
    const g = c.world.groundAt(this.x, this.z);
    if (this.y < g) { this.y = g; this.v.multiplyScalar(0.45); this.v.y = Math.abs(this.v.y) * 0.4; this.spin.multiplyScalar(0.6); }
    this.mesh.rotation.x += this.spin.x * dt;
    this.mesh.rotation.z += this.spin.z * dt;
    this.place();
  }
}

export class Bundle extends Entity {
  private mesh = M.bundleModel();
  private t = Math.random() * 3;

  constructor(s: Spawn, c: Ctx) {
    super();
    this.root.add(this.mesh);
    this.x = s.x; this.z = s.z; this.y = c.world.groundAt(s.x, s.z);
    this.place();
  }

  update(dt: number, c: Ctx) {
    this.t += dt;
    this.mesh.position.y = 2 + Math.sin(this.t * 3) * 1.2;
    this.mesh.rotation.y = this.t * 1.5;
    const r = c.rider;
    if (r.mode !== 'crash' && this.dist(c) < 13 && Math.abs(r.pos.y - this.y) < 14) {
      this.dead = true;
      c.particles.emit(new THREE.Vector3(this.x, this.y + 4, this.z), 14, { color: [0xf6f3e6, 0xd23a3a], speed: 25, up: 30, size: 0.9 });
      c.event('pickup', this);
    }
  }
}

export function spawnEntity(s: Spawn, c: Ctx): Entity | null {
  switch (s.type) {
    case 'dog': return new Dog(s, c);
    case 'cat': return new Cat(s, c);
    case 'mower': return new Mower(s, c);
    case 'birds': return new Flock(s, c);
    case 'ducks': return new Ducks(s);
    case 'squirrel': return new Squirrel(s, c);
    case 'parkedCar': return new Car(s.x, s.z, s.heading ?? 0, s.variant ?? 0, c, true);
    case 'mailbox': return new Mailbox(s, c);
    case 'trash': return new Trash(s, c);
    case 'cone': return new Cone(s, c);
    case 'bundle': return new Bundle(s, c);
    default: return null;
  }
}
