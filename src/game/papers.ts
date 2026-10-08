import * as THREE from 'three';
import { paperRoll } from '../rider/models';
import type { World } from './world/world';
import type { Target } from './world/types';
import { Entity, Mailbox, Flock, Ctx } from './entities/entities';

const GRAVITY = 245;

interface Paper {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  q: THREE.Quaternion;
  axis: THREE.Vector3;
  spin: number;
  landed: boolean;
  spent: boolean;
  age: number;
}

export interface PaperHooks {
  mailbox(m: Mailbox, at: THREE.Vector3): void;
  door(t: Target, at: THREE.Vector3): void;
  window(t: Target, at: THREE.Vector3): void;
  bullseye(t: Target, at: THREE.Vector3): void;
  thud(at: THREE.Vector3): void;
}

export class Papers {
  readonly group = new THREE.Group();
  private list: Paper[] = [];
  private tmpQ = new THREE.Quaternion();

  constructor(private world: World, private hooks: PaperHooks) {}

  throw(pos: THREE.Vector3, vel: THREE.Vector3) {
    const mesh = paperRoll();
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    this.list.push({
      mesh, pos: pos.clone(), vel: vel.clone(), q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6),
      axis: new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize(), spin: 16 + Math.random() * 6,
      landed: false, spent: false, age: 0,
    });
  }

  clear() {
    for (const p of this.list) this.group.remove(p.mesh);
    this.list.length = 0;
  }

  update(dt: number, entities: Entity[], ctx: Ctx) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      if (!p.landed) this.fly(p, dt, entities, ctx);
      else {
        p.vel.multiplyScalar(Math.exp(-7 * dt));
        p.pos.addScaledVector(p.vel, dt);
        p.pos.y = this.world.groundAt(p.pos.x, p.pos.z) + 1;
        const along = new THREE.Vector3(1, 0, 0).applyQuaternion(p.q).setY(0);
        if (along.lengthSq() > 1e-4) p.q.slerp(this.tmpQ.setFromUnitVectors(new THREE.Vector3(1, 0, 0), along.normalize()), Math.min(1, dt * 10));
      }
      p.mesh.matrix.compose(p.pos, p.q, new THREE.Vector3(1, 1, 1));
      p.mesh.matrixWorldNeedsUpdate = true;
      if (p.age > 9 || p.pos.z > ctx.rider.pos.z + 500) {
        this.group.remove(p.mesh);
        this.list.splice(i, 1);
      }
    }
  }

  private fly(p: Paper, dt: number, entities: Entity[], ctx: Ctx) {
    p.vel.y -= GRAVITY * dt;
    p.pos.addScaledVector(p.vel, dt);
    p.q.premultiply(this.tmpQ.setFromAxisAngle(p.axis, p.spin * dt));
    const pos = p.pos;

    if (!p.spent) {
      for (const e of entities) {
        if (e instanceof Mailbox && e.slot.containsPoint(pos)) {
          if (e.subscriber && !e.delivered) {
            this.hooks.mailbox(e, pos);
            this.remove(p);
            return;
          }
          e.paperHit(pos, ctx);
          this.bounce(p, 0.3);
          p.spent = true;
          return;
        }
      }
      for (const t of this.world.targets) {
        if ((t.kind === 'window' || t.kind === 'bullseye') && !t.hit && t.box.containsPoint(pos)) {
          t.hit = true;
          p.spent = true;
          if (t.kind === 'window') this.hooks.window(t, pos.clone());
          else this.hooks.bullseye(t, pos.clone());
          this.bounce(p, 0.25);
          return;
        }
      }
      for (const e of entities) {
        if (!e.paperHit || e instanceof Mailbox) continue;
        if (Math.hypot(e.x - pos.x, e.z - pos.z) < e.radius + 2.5 && pos.y < e.y + e.height + 2) {
          if (e.paperHit(pos, ctx)) {
            p.spent = true;
            this.bounce(p, 0.2);
            return;
          }
        }
      }
    }
    for (const e of entities) if (e instanceof Flock && Math.hypot(e.x - pos.x, e.z - pos.z) < 30) e.scare(ctx, pos);

    // walls and posts
    const hit = this.world.near(pos.x, pos.z, 0.5).find((c) => c.kind !== 'ramp' && this.world.colliderTop(c, pos.z) > pos.y && c.top > this.world.baseGround(pos.x, pos.z) + 1);
    if (hit) {
      // push back out the way we came and drop
      pos.addScaledVector(p.vel, -dt * 1.5);
      p.vel.x *= -0.25;
      p.vel.z *= 0.4;
      p.vel.y = Math.min(p.vel.y, 10);
      p.spin *= 0.5;
      this.hooks.thud(pos.clone());
    }

    const g = this.world.groundAt(pos.x, pos.z);
    if (pos.y <= g + 0.8) {
      pos.y = g + 0.8;
      if (!p.spent) {
        const door = this.world.targets.find((t) => t.kind === 'door' && pos.x >= t.box.min.x && pos.x <= t.box.max.x && pos.z >= t.box.min.z && pos.z <= t.box.max.z);
        if (door) this.hooks.door(door, pos.clone());
        else this.hooks.thud(pos.clone());
        p.spent = true;
      }
      if (-p.vel.y > 40) {
        p.vel.y *= -0.3;
        p.vel.x *= 0.5;
        p.vel.z *= 0.5;
        p.spin *= 0.5;
      } else {
        p.landed = true;
        p.vel.y = 0;
      }
    }
  }

  private bounce(p: Paper, k: number) {
    p.vel.x *= -k;
    p.vel.z *= k;
    p.vel.y = Math.min(p.vel.y, 20);
  }

  private remove(p: Paper) {
    this.group.remove(p.mesh);
    this.list.splice(this.list.indexOf(p), 1);
  }
}
