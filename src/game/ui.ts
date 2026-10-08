import * as THREE from 'three';
import type { HouseInfo } from './world/types';
import type { Segment } from './world/world';

const $ = (id: string) => document.getElementById(id)!;

interface Popup {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  t: number;
  life: number;
}

export type HouseMark = 'none' | 'sub' | 'ok' | 'miss';

export class UI {
  private digits: HTMLSpanElement[] = [];
  private shown = 0;
  private target = 0;
  private popups: Popup[] = [];
  private pips = new Map<number, HTMLElement>();
  private me!: HTMLElement;
  private routeLen = 1;
  private lastPapers = -1;
  private lastLives = -1;

  constructor() {
    const s = $('score');
    for (let i = 0; i < 7; i++) {
      const d = document.createElement('span');
      d.textContent = '0';
      s.appendChild(d);
      this.digits.push(d);
    }
    this.renderScore(0);
  }

  show(id: string, on = true) {
    $(id).classList.toggle('hidden', !on);
  }

  // ------------------------------------------------------------ score

  setScore(n: number, instant = false) {
    this.target = n;
    if (instant) { this.shown = n; this.renderScore(n); }
  }

  private renderScore(n: number) {
    const str = String(Math.floor(n)).padStart(7, '0');
    let lead = true;
    this.digits.forEach((d, i) => {
      const ch = str[i];
      if (ch !== '0' || i === 6) lead = false;
      if (d.textContent !== ch) {
        d.textContent = ch;
        d.classList.remove('bump');
        void d.offsetWidth;
        d.classList.add('bump');
        setTimeout(() => d.classList.remove('bump'), 120);
      }
      d.classList.toggle('dim', lead);
    });
  }

  setPapers(n: number, max: number) {
    if (n === this.lastPapers) return;
    this.lastPapers = n;
    const box = $('papers');
    box.innerHTML = '';
    for (let i = 0; i < max; i++) {
      const r = document.createElement('div');
      r.className = 'roll' + (i < n ? '' : ' gone');
      box.appendChild(r);
    }
    $('paper-count').textContent = String(n);
  }

  setLives(n: number, max = 3) {
    if (n === this.lastLives) return;
    this.lastLives = n;
    const box = $('lives');
    box.innerHTML = '';
    for (let i = 0; i < Math.max(max, n); i++) {
      const l = document.createElement('div');
      l.className = 'life' + (i < n ? '' : ' gone');
      l.innerHTML = '<i></i>';
      box.appendChild(l);
    }
  }

  setSubs(n: number) {
    $('subs').innerHTML = `★ <b>${n}</b>`;
  }

  setDay(name: string) {
    $('day').textContent = name.toUpperCase();
  }

  setDistrict(name: string) {
    $('district').textContent = name;
  }

  setStreak(mult: number) {
    const el = $('streak');
    el.textContent = `×${mult}`;
    el.classList.toggle('on', mult > 1);
  }

  // ------------------------------------------------------------ route bar

  buildRoute(segments: Segment[], houses: HouseInfo[], length: number) {
    const route = $('route');
    route.querySelectorAll('.pip,.seg,.me').forEach((e) => e.remove());
    this.pips.clear();
    this.routeLen = length;
    for (const s of segments) {
      if (s.kind === 'lot' || s.kind === 'park' || s.kind === 'construction') {
        const l = document.createElement('div');
        l.className = 'seg';
        l.style.left = `${(-s.zNear / length) * 100}%`;
        l.textContent = s.label.split(' ')[0].toUpperCase();
        route.appendChild(l);
      }
    }
    for (const h of houses) {
      const p = document.createElement('div');
      p.className = 'pip' + (h.side < 0 ? ' l' : '');
      p.style.left = `${(-h.zMid / length) * 100}%`;
      route.appendChild(p);
      this.pips.set(h.id, p);
    }
    this.me = document.createElement('div');
    this.me.className = 'me';
    route.appendChild(this.me);
  }

  markHouse(id: number, m: HouseMark) {
    const p = this.pips.get(id);
    if (!p) return;
    p.classList.remove('sub', 'ok', 'miss');
    if (m !== 'none') p.classList.add(m);
  }

  setProgress(z: number) {
    if (this.me) this.me.style.left = `${Math.max(0, Math.min(1, -z / this.routeLen)) * 100}%`;
  }

  // ------------------------------------------------------------ popups & fx

  popup(pos: THREE.Vector3, text: string, o: { size?: 'big' | 'mid' | 'small'; color?: string; label?: string; life?: number } = {}) {
    const el = document.createElement('div');
    el.className = o.size ?? 'mid';
    el.style.color = o.color ?? '#ffcf3a';
    el.innerHTML = text + (o.label ? `<span class="label">${o.label}</span>` : '');
    $('popups').appendChild(el);
    this.popups.push({ el, pos: pos.clone(), t: 0, life: o.life ?? 1.3 });
  }

  banner(title: string, sub = '') {
    const b = $('banner');
    b.querySelector('.t')!.textContent = title;
    b.querySelector('.s')!.textContent = sub;
    b.classList.remove('show');
    void (b as HTMLElement).offsetWidth;
    b.classList.add('show');
  }

  flash() {
    const f = $('flash');
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  shake() {
    const g = $('game-ui');
    g.classList.remove('shake');
    void g.offsetWidth;
    g.classList.add('shake');
  }

  clearPopups() {
    for (const p of this.popups) p.el.remove();
    this.popups.length = 0;
  }

  update(dt: number, camera: THREE.Camera) {
    if (this.shown !== this.target) {
      const d = this.target - this.shown;
      this.shown += Math.sign(d) * Math.max(1, Math.ceil(Math.abs(d) * Math.min(1, dt * 9)));
      if ((d > 0 && this.shown > this.target) || (d < 0 && this.shown < this.target)) this.shown = this.target;
      this.renderScore(this.shown);
    }
    const v = new THREE.Vector3();
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t += dt;
      if (p.t > p.life) { p.el.remove(); this.popups.splice(i, 1); continue; }
      v.copy(p.pos).project(camera);
      const x = (v.x * 0.5 + 0.5) * innerWidth;
      const y = (-v.y * 0.5 + 0.5) * innerHeight - p.t * 46;
      const k = p.t / p.life;
      const pop = p.t < 0.12 ? 0.6 + (p.t / 0.12) * 0.7 : p.t < 0.22 ? 1.3 - ((p.t - 0.12) / 0.1) * 0.3 : 1;
      p.el.style.transform = `translate(${x}px, ${Math.max(70, Math.min(innerHeight - 60, y))}px) translate(-50%, -50%) scale(${pop})`;
      p.el.style.opacity = String(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
    }
  }
}
