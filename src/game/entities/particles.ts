import * as THREE from 'three';

interface P {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  color: THREE.Color;
  gravity: number;
  spin: number;
}

/** One instanced mesh of little cubes for every bit of debris in the game. */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private ps: P[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();

  constructor(private cap = 700) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
  }

  emit(at: THREE.Vector3, n: number, o: { color: number | number[]; speed?: number; up?: number; size?: number; life?: number; gravity?: number; vel?: THREE.Vector3 }) {
    for (let i = 0; i < n; i++) {
      if (this.ps.length >= this.cap) this.ps.shift();
      const sp = o.speed ?? 20;
      const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2).multiplyScalar(sp);
      v.y += o.up ?? 10;
      if (o.vel) v.add(o.vel);
      const col = Array.isArray(o.color) ? o.color[Math.floor(Math.random() * o.color.length)] : o.color;
      const life = (o.life ?? 0.8) * (0.6 + Math.random() * 0.6);
      this.ps.push({
        pos: at.clone(), vel: v, life, max: life, size: (o.size ?? 1) * (0.6 + Math.random() * 0.7),
        color: new THREE.Color(col), gravity: o.gravity ?? 120, spin: (Math.random() - 0.5) * 20,
      });
    }
  }

  update(dt: number, groundAt: (x: number, z: number) => number) {
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.life -= dt;
      if (p.life <= 0) { this.ps.splice(i, 1); continue; }
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      const g = groundAt(p.pos.x, p.pos.z) + p.size * 0.5;
      if (p.pos.y < g) {
        p.pos.y = g;
        p.vel.multiplyScalar(0.4);
        p.vel.y = Math.abs(p.vel.y) * 0.3;
      }
    }
    this.ps.forEach((p, i) => {
      const k = p.size * Math.min(1, (p.life / p.max) * 2.5);
      this.e.set(p.spin * p.life, p.spin * p.life * 0.7, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(p.pos, this.q, this.s.set(k, k, k));
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, p.color);
    });
    this.mesh.count = this.ps.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.ps.length = 0;
    this.mesh.count = 0;
  }
}
