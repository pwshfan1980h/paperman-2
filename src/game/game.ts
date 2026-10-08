import * as THREE from 'three';
import { Rider, CRUISE, RideInput } from '../rider/rider';
import { World } from './world/world';
import { Built, Piece, ROAD_HALF, Target } from './world/types';
import { Entity, Ctx, spawnEntity, Mailbox, Car, Geese, Dog, Bundle, Cone } from './entities/entities';
import { Particles } from './entities/particles';
import { Papers } from './papers';
import { Audio } from './audio';
import { UI } from './ui';
import { Rng } from './rng';

type State = 'intro' | 'title' | 'howto' | 'brief' | 'play' | 'dayEnd' | 'summary' | 'end' | 'paused';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const HEADLINES: [string, string][] = [
  ['NEW KID TAKES OVER MAPLE HOLLOW ROUTE', 'Neighbors hopeful. Local dogs unconvinced. Deliver to every house with a raised flag and a gold marker.'],
  ['CAT SEEN CROSSING ROAD, AGAIN', 'Residents urged to look both ways. Cats decline to comment. Hop over anything small that darts out.'],
  ['ROGUE BOT MOWER ESCAPES HILLTOP LAWN', '"It just kept mowing," says owner. Oncoming traffic up while the cross-town detour runs down Main.'],
  ['DOGS DEMAND MORE CHASING', 'Neighborhood pets louder, faster and more numerous than ever. Road works enter week two.'],
  ['FRIDAY: EVERY PORCH COUNTS', 'Keep your subscribers through today to win Paperboy of the Week. Good luck, kid.'],
];
const SUN = [
  { color: 0xffc89a, hemi: 0xd8d0ff, sky: 0xf6c8a8, int: 2.0, pos: [-120, 80, 60] },
  { color: 0xffe0b8, hemi: 0xdce8ff, sky: 0xc8dcf0, int: 2.3, pos: [-90, 110, 60] },
  { color: 0xfff0d8, hemi: 0xdcecff, sky: 0xb8d8f0, int: 2.5, pos: [-70, 140, 50] },
  { color: 0xffe8c8, hemi: 0xd8e4ff, sky: 0xb8d0e8, int: 2.4, pos: [-90, 130, 60] },
  { color: 0xfff4e0, hemi: 0xe0f0ff, sky: 0xa8d4f4, int: 2.6, pos: [-60, 150, 40] },
];

const MAX_PAPERS = 16;
const START_PAPERS = 12;
const START_LIVES = 3;

interface HouseState {
  subscriber: boolean;
  /** a missed day is a strike; two strikes and they cancel */
  strikes: number;
  delivered: boolean;
  missed: boolean;
  smashed: boolean;
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 2, 3000);
  private sun = new THREE.DirectionalLight(0xffffff, 2.4);
  private hemi = new THREE.HemisphereLight(0xdcecff, 0x5a5040, 1.15);
  readonly world = new World();
  readonly rider = new Rider();
  readonly particles = new Particles();
  readonly audio = new Audio();
  readonly ui = new UI();
  private papers: Papers;
  private entities: Entity[] = [];
  private byPiece = new Map<Piece, Entity[]>();
  private decals = new THREE.Group();

  state: State = 'intro';
  private prevState: State = 'play';
  private keys = new Set<string>();
  private time = 0;

  // run state
  day = 0;
  score = 0;
  dayScore = 0;
  lives = START_LIVES;
  paperCount = START_PAPERS;
  streak = 0;
  private houses = new Map<number, HouseState>();
  private initialSubs = 0;
  private hi = 0;
  private stats = { mailbox: 0, door: 0, windows: 0, air: 0, stuns: 0, targets: 0 };
  private segLabel = '';
  private dayEndT = 0;
  private gameOverPending = false;

  // camera rig
  private camPos = new THREE.Vector3(0, 150, 200);
  private camLook = new THREE.Vector3();
  private shakeT = 0;
  private attract = false;
  private orbit = 0;

  // traffic timers
  private crossTimers: number[] = [];
  private oncomingT = 6;
  private geeseT = 20;

  // menus
  private menuSel = 0;
  private summaryDone = false;
  private introT = 0;
  private van: Car | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: location.hash.includes('debug') });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -230, right: 230, top: 230, bottom: -230, near: 10, far: 900 });
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.6;
    this.scene.fog = new THREE.Fog(0xb8d8f0, 900, 1800);

    this.scene.add(this.world.group, this.rider.root, this.particles.mesh, this.decals);
    this.papers = new Papers(this.world, {
      mailbox: (m, at) => this.onMailbox(m, at),
      door: (t, at) => this.onDoor(t, at),
      window: (t, at) => this.onWindow(t, at),
      bullseye: (_t, at) => this.onBullseye(at),
      thud: (at) => this.sfx('thud', at, 0.5),
    });
    this.scene.add(this.papers.group);

    this.rider.groundAt = this.world.groundAt;
    this.rider.onRelease = (pos, vel) => this.papers.throw(pos, vel);
    this.rider.canThrow = () => this.attract || this.state === 'intro' || this.paperCount > 0;
    this.rider.onEvent = (n, v) => this.onRiderEvent(n, v);

    this.world.onBuilt = (p, b) => this.spawnFor(p, b);
    this.world.onDisposed = (p) => this.despawnFor(p);

    try { this.hi = Number(localStorage.getItem('paperman2.hi') || 0); } catch { /* storage blocked */ }
    document.getElementById('hi')!.textContent = String(this.hi).padStart(6, '0');

    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('resize', () => this.resize());
    document.querySelectorAll<HTMLButtonElement>('#title .menu button').forEach((b, i) =>
      b.addEventListener('click', () => { this.audio.unlock(); this.menuSel = i; this.menuGo(); }));
    addEventListener('pointerdown', () => this.audio.unlock());
    this.resize();
  }

  private resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // ================================================================ flow

  start() {
    this.setupRun(0);
    this.beginIntro();
    let last = performance.now();
    this.renderer.setAnimationLoop((now) => {
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      this.frame(dt);
    });
  }

  /** Advance n frames by hand (testing in a hidden tab, where rAF is paused). */
  debugStep(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i++) this.frame(dt);
  }

  /** Skip straight to riding a given day (testing). */
  debugPlay(day = 0) {
    this.ui.show('intro', false);
    this.toTitle();
    this.newRun();
    if (day) { this.setupRun(day); this.toBrief(); }
    this.toPlay();
  }

  /** Ride with a simple bot for up to n frames; returns a report (testing). */
  debugBot(n = 6000) {
    const r = this.rider;
    const crashes: string[] = [];
    let lives = this.lives;
    let i = 0;
    for (; i < n && (this.state === 'play' || this.state === 'dayEnd'); i++) {
      if (i % 6 === 0) for (const e of this.entities) {
        if (!(e instanceof Mailbox) || !e.subscriber || e.delivered) continue;
        const dz = r.pos.z - e.z;
        if (dz > 40 && dz < 55 && Math.abs(Math.abs(e.x - r.pos.x) - 40) < 10) r.throwPaper(e.x > r.pos.x ? 1 : -1);
      }
      const want = Math.sin(i / 200) * 14;
      const danger = this.entities.some((e) => e.hazard && Math.abs(e.x - r.pos.x) < e.radius + 5 && e.z < r.pos.z - 8 && e.z > r.pos.z - 30)
        || this.world.blocked(r.pos.x, r.pos.z - 24, r.pos.y);
      if (danger) r.hop();
      this.keys = new Set(r.pos.x < want - 4 ? ['arrowright'] : r.pos.x > want + 4 ? ['arrowleft'] : []);
      this.frame(1 / 60);
      if (this.lives !== lives) { crashes.push(this.lastCrash); lives = this.lives; }
    }
    this.keys.clear();
    return { state: this.state, frames: i, z: Math.round(r.pos.z), lives: this.lives, score: this.score, papers: this.paperCount, stats: this.stats, crashes };
  }

  /** Hold keys from the console while stepping. */
  debugKeys(...k: string[]) {
    this.keys = new Set(k);
  }

  private ctx(): Ctx {
    return {
      rider: this.rider, world: this.world, particles: this.particles, time: this.time, day: this.day,
      sfx: (n, at) => this.sfx(n, at),
      event: (n, e, v) => this.onEntityEvent(n, e, v),
    };
  }

  private setupRun(day: number) {
    this.day = day;
    if (day === 0) {
      this.score = 0;
      this.lives = START_LIVES;
      this.houses.clear();
      const rng = new Rng(1985);
      let subs = 0;
      for (const h of this.world.houses) {
        const s = rng.chance(0.42);
        if (s) subs++;
        this.houses.set(h.id, { subscriber: s, strikes: 0, delivered: false, missed: false, smashed: false });
      }
      this.initialSubs = subs;
      this.ui.setScore(0, true);
    }
    for (const hs of this.houses.values()) { hs.delivered = false; hs.missed = false; hs.smashed = false; }
    this.paperCount = START_PAPERS;
    this.streak = 0;
    this.dayScore = 0;
    this.stats = { mailbox: 0, door: 0, windows: 0, air: 0, stuns: 0, targets: 0 };
    this.loadWorld(day);
  }

  private loadWorld(day: number) {
    for (const e of this.entities) this.removeEntity(e);
    this.entities = [];
    this.byPiece.clear();
    this.papers.clear();
    this.particles.clear();
    this.decals.clear();
    this.world.reset(day);
    this.rider.reset(24, -30, 0);
    this.crossTimers = this.world.crossings.map(() => 1);
    this.oncomingT = 8;
    this.geeseT = 15 + Math.random() * 10;
    this.applySun(day);
    this.world.stream(this.rider.pos.z, 99);
    this.ui.buildRoute(this.world.segments, this.world.houses, this.world.length);
    for (const h of this.world.houses) this.ui.markHouse(h.id, this.houses.get(h.id)!.subscriber ? 'sub' : 'none');
    this.segLabel = '';
    this.snapCamera();
  }

  private applySun(day: number) {
    const s = SUN[day % SUN.length];
    this.sun.color.setHex(s.color);
    this.sun.intensity = s.int;
    this.hemi.color.setHex(s.hemi);
    this.scene.background = new THREE.Color(s.sky);
    (this.scene.fog as THREE.Fog).color.setHex(s.sky);
    this.sunOffset.set(s.pos[0], s.pos[1], s.pos[2]);
  }
  private sunOffset = new THREE.Vector3(-90, 120, 60);

  private beginIntro() {
    this.state = 'intro';
    this.introT = 0;
    this.introRider = false;
    this.ui.show('intro');
    this.ui.show('game-ui', false);
    this.rider.reset(24, 140, 0);
    this.van = new Car(30, -420, 0, 33, this.ctx(), false);
    this.van.hazard = false;
    this.addEntity(this.van);
    const bundle = new Bundle({ type: 'bundle', x: 52, z: -78 }, this.ctx());
    bundle.root.visible = false;
    this.introBundle = bundle;
    this.addEntity(bundle);
    this.audio.music(null);
  }
  private introBundle: Bundle | null = null;
  private introRider = false;

  private endIntro() {
    this.ui.show('intro', false);
    this.ui.flash();
    this.toTitle(true);
  }

  private toTitle(slam = false) {
    this.state = 'title';
    this.attract = true;
    this.setupRun(0);
    this.rider.reset(24, -30, CRUISE);
    this.ui.show('title');
    this.ui.show('game-ui', false);
    ['brief', 'summary', 'end', 'howto', 'pause'].forEach((s) => this.ui.show(s, false));
    this.menuSel = 0;
    this.renderMenu();
    const logo = document.querySelector('#title .logo')!;
    if (slam) { logo.classList.remove('slam'); void (logo as HTMLElement).offsetWidth; logo.classList.add('slam'); this.sfx('slam'); }
    this.audio.music('title');
  }

  private renderMenu() {
    document.querySelectorAll('#title .menu button').forEach((b, i) => b.classList.toggle('sel', i === this.menuSel));
  }

  private menuGo() {
    this.sfx('select');
    const act = ['start', 'howto', 'lab'][this.menuSel];
    if (act === 'start') this.newRun();
    else if (act === 'howto') { this.state = 'howto'; this.ui.show('howto'); }
    else location.href = './lab.html';
  }

  private newRun() {
    this.attract = false;
    this.ui.show('title', false);
    this.setupRun(0);
    this.toBrief();
  }

  private toBrief() {
    this.state = 'brief';
    this.ui.show('brief');
    this.ui.show('game-ui', true);
    const [h, s] = HEADLINES[this.day];
    document.getElementById('b-date')!.textContent = `${DAYS[this.day].toUpperCase()} · DAY ${this.day + 1} OF 5`;
    document.getElementById('b-head')!.textContent = h;
    document.getElementById('b-sub')!.textContent = s;
    document.getElementById('b-subs')!.textContent = String(this.subCount());
    document.getElementById('b-papers')!.textContent = String(this.paperCount);
    document.getElementById('b-lives')!.textContent = String(this.lives);
    this.ui.setDay(DAYS[this.day]);
    this.syncHud();
    this.audio.music(null);
    this.sfx('select');
  }

  private toPlay() {
    this.ui.show('brief', false);
    this.state = 'play';
    this.rider.reset(24, -30, 0);
    this.audio.music('ride');
    this.ui.banner(DAYS[this.day].toUpperCase(), `${this.subCount()} SUBSCRIBERS WAITING`);
  }

  private subCount() {
    let n = 0;
    for (const h of this.houses.values()) if (h.subscriber) n++;
    return n;
  }

  // ================================================================ input

  private onKey(e: KeyboardEvent, down: boolean) {
    const k = e.key.toLowerCase();
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    if (!down) { this.keys.delete(k); return; }
    if (e.repeat) return;
    this.keys.add(k);
    this.audio.unlock();
    if (k === 'm') {
      const m = this.audio.toggleMute();
      document.getElementById('mute')!.textContent = m ? 'M · SOUND OFF' : 'M · SOUND ON';
      return;
    }
    const enter = k === 'enter' || k === ' ';
    switch (this.state) {
      case 'intro': this.endIntro(); break;
      case 'title':
        if (k === 'arrowup' || k === 'w') { this.menuSel = (this.menuSel + 2) % 3; this.renderMenu(); this.sfx('move'); }
        if (k === 'arrowdown' || k === 's') { this.menuSel = (this.menuSel + 1) % 3; this.renderMenu(); this.sfx('move'); }
        if (enter) this.menuGo();
        break;
      case 'howto': if (enter || k === 'escape') { this.ui.show('howto', false); this.state = 'title'; this.sfx('select'); } break;
      case 'brief': if (enter) this.toPlay(); break;
      case 'play':
        if (k === 'escape' || k === 'p') { this.prevState = 'play'; this.state = 'paused'; this.ui.show('pause'); this.audio.music(null); break; }
        if (k === ' ') this.rider.hop();
        if (k === 'z') this.rider.throwPaper(-1);
        if (k === 'x') this.rider.throwPaper(1);
        break;
      case 'paused':
        if (k === 'escape' || k === 'p') { this.state = this.prevState; this.ui.show('pause', false); this.audio.music('ride'); }
        if (k === 'q') { this.ui.show('pause', false); this.toTitle(); }
        break;
      case 'summary': if (enter && this.summaryDone) this.afterSummary(); break;
      case 'end': if (enter) this.toTitle(); break;
    }
  }

  private input(): RideInput {
    const k = this.keys;
    return {
      left: k.has('arrowleft') || k.has('a'),
      right: k.has('arrowright') || k.has('d'),
      up: k.has('arrowup') || k.has('w'),
      down: k.has('arrowdown') || k.has('s'),
    };
  }

  // ================================================================ frame

  private frame(dt: number) {
    this.time += dt;
    const r = this.rider;
    const playing = this.state === 'play' || this.state === 'dayEnd';
    const live = playing || this.state === 'title' || this.state === 'howto' || this.state === 'intro';

    if (live) {
      if (this.state === 'play') r.setInput(this.input());
      else if (this.state === 'dayEnd') r.setInput({ left: r.pos.x < 18, right: r.pos.x > 30, up: false, down: true });
      else if (this.state === 'intro') r.setInput(this.introInput());
      else r.setInput(this.autopilot());
      r.update(dt);
      r.pos.x = Math.max(-200, Math.min(200, r.pos.x));
      if (this.state !== 'intro') this.collide();
      this.world.stream(r.pos.z, 2);
      const c = this.ctx();
      for (let i = this.entities.length - 1; i >= 0; i--) {
        const e = this.entities[i];
        e.update(dt, c);
        if (e.dead) this.removeEntity(e);
      }
      this.papers.update(dt, this.entities, c);
      this.particles.update(dt, this.world.groundAt);
      this.traffic(dt);
      if (playing) this.playTick(dt);
      if (this.attract && r.pos.z < this.world.finishZ + 200) { this.loadWorld(0); this.rider.reset(24, -30, CRUISE); }
    }
    if (this.state === 'intro') this.introTick(dt);
    else this.updateCamera(dt);
    this.ui.update(dt, this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  private playTick(dt: number) {
    const r = this.rider;
    // district banners
    const seg = this.world.segmentAt(r.pos.z);
    if (seg && seg.label !== this.segLabel) {
      this.segLabel = seg.label;
      this.ui.setDistrict(seg.label);
      if (seg.kind !== 'start' && seg.kind !== 'finish') this.ui.banner(seg.label.toUpperCase(), seg.kind === 'park' ? 'RAMPS · BULLSEYES · DUCKS' : seg.kind === 'construction' ? 'MIND THE BARRIERS' : seg.kind === 'cross' ? 'LOOK BOTH WAYS' : '');
    }
    // missed subscribers
    for (const h of this.world.houses) {
      const s = this.houses.get(h.id)!;
      if (!s.subscriber || s.delivered || s.missed || s.smashed) continue;
      if (r.pos.z < h.mailbox.z - 130) {
        s.missed = true;
        this.ui.markHouse(h.id, 'miss');
        const label = s.strikes >= 1 ? 'STRIKE 2 · CANCELS' : this.streak > 0 ? 'STRIKE 1 · STREAK LOST' : 'STRIKE 1';
        // the house is already behind the camera: report it beside the rider instead
        const at = r.pos.clone().add(new THREE.Vector3(h.side * 34, 30, 10));
        this.ui.popup(at, 'MISSED', { size: 'small', color: '#ff6a5a', label });
        this.streak = 0;
        this.sfx('miss', undefined, 0.6);
      }
    }
    this.ui.setProgress(r.pos.z);
    this.syncHud();

    if (this.state === 'play' && r.pos.z < this.world.finishZ) {
      this.state = 'dayEnd';
      this.dayEndT = 0;
      this.audio.music('fanfare');
      this.ui.banner(`${DAYS[this.day].toUpperCase()} DONE!`, 'ROUTE COMPLETE');
      this.particles.emit(r.pos.clone().setY(30), 60, { color: [0xffcf3a, 0xe0443c, 0x2f74e0, 0x3ab84a, 0xffffff], speed: 70, up: 60, size: 1.5, life: 1.6, gravity: 80 });
    }
    if (this.state === 'dayEnd') {
      this.dayEndT += dt;
      if (this.dayEndT > 3) this.toSummary();
    }
  }

  private syncHud() {
    this.ui.setScore(this.score);
    this.ui.setPapers(this.paperCount, MAX_PAPERS);
    this.ui.setLives(this.lives, START_LIVES);
    this.ui.setSubs(this.subCount());
    this.ui.setStreak(this.mult());
  }

  private mult() {
    return Math.min(4, 1 + Math.floor(this.streak / 3));
  }

  // ================================================================ collisions & traffic

  private collide() {
    const r = this.rider;
    if (r.mode !== 'ride') return;
    const h = r.heading.x;
    const fx = Math.sin(h), fz = -Math.cos(h);
    const pts = [[11, 0], [0, 0], [-9, 0], [4, 2], [4, -2]].map(([f, s]) => [r.pos.x + fx * f - fz * s, r.pos.z + fz * f + fx * s]);
    for (const [x, z] of pts) {
      const c = this.world.blocked(x, z, r.pos.y);
      if (c) return this.crash(c.tag ?? 'wall');
    }
    for (const e of this.entities) {
      if (!e.hazard) continue;
      if (e instanceof Car) {
        if (pts.some(([x, z]) => e.contains(x, z)) && r.pos.y < e.y + e.height - 1) return this.crash('car');
        continue;
      }
      const near = pts.some(([x, z]) => Math.hypot(x - e.x, z - e.z) < e.radius + 2.5);
      if (near && r.pos.y - e.y < e.height - 1.5) {
        e.bumped?.(this.ctx());
        return this.crash(e.constructor.name.toLowerCase());
      }
    }
  }

  lastCrash = '';
  private crash(what: string) {
    if (this.state === 'intro') return;
    this.lastCrash = `${what}@${this.rider.pos.x.toFixed(0)},${this.rider.pos.z.toFixed(0)}`;
    this.rider.crash();
    this.streak = 0;
    this.shakeT = 0.45;
    if (!this.attract && this.state === 'play') {
      this.lives--;
      this.ui.shake();
      const quip: Record<string, string> = { dog: 'RUFF DAY', cat: 'CAT-ASTROPHE', mower: 'MOWED DOWN', car: 'HONK!', tree: 'TIMBER', house: 'WRONG HOUSE', fence: 'DE-FENCED', barrier: 'ROAD CLOSED', trash: 'TRASHED', mailbox: 'POSTAL', squirrel: 'NUTS' };
      this.ui.popup(this.rider.pos.clone().setY(40), quip[what] ?? 'WIPEOUT', { size: 'big', color: '#ff6a5a', label: this.lives > 0 ? `${this.lives} BIKE${this.lives === 1 ? '' : 'S'} LEFT` : 'LAST BIKE', life: 1.8 });
      if (this.lives <= 0) this.gameOverPending = true;
    }
  }

  private traffic(dt: number) {
    const r = this.rider;
    this.world.crossings.forEach(([a, b], i) => {
      if (r.pos.z < b - 40 || r.pos.z > a + 900) return;
      this.crossTimers[i] -= dt;
      if (this.crossTimers[i] > 0) return;
      this.crossTimers[i] = Math.max(1.6, 4.2 - this.day * 0.5) + Math.random() * 2;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const lane = (a + b) / 2 + dir * 20;
      const car = new Car(-dir * 520, lane, dir > 0 ? -Math.PI / 2 : Math.PI / 2, Math.floor(Math.random() * 40), this.ctx(), false);
      car.vx = dir * (110 + Math.random() * 40 + this.day * 8);
      this.addEntity(car);
    });
    if (this.day >= 2 && !this.attract && this.state === 'play') {
      this.oncomingT -= dt;
      if (this.oncomingT < 0) {
        this.oncomingT = Math.max(4, 10 - this.day * 1.5) + Math.random() * 3;
        const z = r.pos.z - 1000;
        const seg = this.world.segmentAt(z);
        if (seg && seg.kind !== 'construction' && seg.kind !== 'park') {
          const car = new Car(-22, z, Math.PI, Math.floor(Math.random() * 40), this.ctx(), false);
          car.vz = 85 + this.day * 6;
          this.addEntity(car);
        }
      }
    }
    if (this.day >= 1 || this.attract) {
      this.geeseT -= dt;
      if (this.geeseT < 0) {
        this.geeseT = 25 + Math.random() * 20;
        const dir = new THREE.Vector3(Math.random() < 0.5 ? 1 : -1, 0, -0.3).normalize();
        this.addEntity(new Geese(new THREE.Vector3(-dir.x * 300, 110, r.pos.z - 250), dir));
      }
    }
  }

  // ================================================================ entities

  private spawnFor(p: Piece, b: Built) {
    const list: Entity[] = [];
    const c = this.ctx();
    for (const s of b.spawns) {
      const e = spawnEntity(s, c);
      if (!e) continue;
      if (e instanceof Mailbox) {
        const hs = this.houses.get(e.house);
        e.setState(!!hs?.subscriber && !hs.smashed, !!hs?.delivered);
      }
      list.push(e);
      this.addEntity(e);
    }
    // paper bundles on the sidewalk every few lots, alternating sides
    if (p.kind === 'lot') {
      const k = Math.round(-p.zNear / 128);
      const mb = b.spawns.find((s) => s.type === 'mailbox');
      if (mb && k % 3 === 1 && mb.side === (k % 2 ? 1 : -1)) {
        const e = new Bundle({ type: 'bundle', x: mb.side! * (ROAD_HALF + 9), z: p.zNear - 90 }, c);
        list.push(e);
        this.addEntity(e);
      }
    }
    if (p.kind === 'park' || p.kind === 'construction') {
      const e = new Bundle({ type: 'bundle', x: 0, z: p.zNear - 120 }, c);
      list.push(e);
      this.addEntity(e);
    }
    this.byPiece.set(p, list);
  }

  private despawnFor(p: Piece) {
    for (const e of this.byPiece.get(p) ?? []) this.removeEntity(e);
    this.byPiece.delete(p);
  }

  private addEntity(e: Entity) {
    this.entities.push(e);
    this.scene.add(e.root);
    e.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.castShadow !== false) o.castShadow = true; });
  }

  private removeEntity(e: Entity) {
    const i = this.entities.indexOf(e);
    if (i >= 0) this.entities.splice(i, 1);
    this.scene.remove(e.root);
    e.dispose(this.ctx());
  }

  // ================================================================ events & scoring

  private sfx(name: string, at?: THREE.Vector3, gain = 1) {
    let pan = 0;
    if (at) {
      const d = at.clone().sub(this.rider.pos);
      pan = Math.max(-1, Math.min(1, d.x / 120));
      gain *= Math.max(0.15, 1 - d.length() / 500);
    }
    this.audio.sfx(name, pan, gain);
  }

  private award(base: number, at: THREE.Vector3, label: string, opts: { color?: string; streak?: boolean; size?: 'big' | 'mid' | 'small' } = {}) {
    if (this.attract || this.state === 'intro') return;
    let pts = base;
    if (opts.streak) {
      this.streak++;
      pts = base * this.mult();
      if (this.streak % 3 === 0 && this.mult() > 1) { this.sfx('combo'); this.ui.banner(`STREAK ×${this.mult()}`, `${this.streak} IN A ROW`); }
    }
    this.score += pts;
    this.dayScore += pts;
    this.ui.popup(at, String(pts), { size: opts.size ?? (pts >= 250 ? 'big' : 'mid'), color: opts.color, label });
  }

  private houseOf(id: number | undefined) {
    return id === undefined ? undefined : this.houses.get(id);
  }

  private onMailbox(m: Mailbox, at: THREE.Vector3) {
    const hs = this.houseOf(m.house);
    m.deliver(this.ctx());
    this.sfx('mailbox', at);
    if (hs && !hs.delivered) {
      hs.delivered = true;
      this.ui.markHouse(m.house, 'ok');
      this.stats.mailbox++;
      this.award(250, at.clone().setY(at.y + 10), this.mult() > 1 ? `MAILBOX ×${this.mult()}` : 'MAILBOX!', { streak: true });
    }
  }

  private onDoor(t: Target, at: THREE.Vector3) {
    const hs = this.houseOf(t.house);
    this.sfx('door', at);
    if (!hs || !hs.subscriber || hs.delivered || hs.smashed) return;
    hs.delivered = true;
    this.ui.markHouse(t.house!, 'ok');
    const mb = this.entities.find((e) => e instanceof Mailbox && e.house === t.house) as Mailbox | undefined;
    mb?.setState(true, true);
    this.stats.door++;
    this.award(100, at.clone().setY(at.y + 12), this.mult() > 1 ? `PORCH ×${this.mult()}` : 'ON THE PORCH', { streak: true, color: '#fff3c0' });
  }

  private onWindow(t: Target, at: THREE.Vector3) {
    const hs = this.houseOf(t.house);
    this.sfx('window', at);
    this.shakeT = Math.max(this.shakeT, 0.15);
    this.particles.emit(at, 26, { color: [0xc8e6f6, 0x9ccde8, 0xffffff], speed: 40, up: 20, size: 0.8, life: 1 });
    if (t.face) this.crack(t.face);
    if (this.attract) return;
    if (hs?.subscriber && !hs.smashed) {
      hs.smashed = true;
      this.streak = 0;
      this.ui.markHouse(t.house!, 'miss');
      const mb = this.entities.find((e) => e instanceof Mailbox && e.house === t.house) as Mailbox | undefined;
      mb?.setState(false, false);
      this.ui.popup(at.clone().setY(at.y + 10), 'OOPS!', { size: 'big', color: '#ff6a5a', label: 'SUBSCRIBER CANCELS' });
      this.sfx('miss');
    } else {
      this.stats.windows++;
      this.award(100, at.clone().setY(at.y + 10), 'SMASH!', { color: '#c8a0ff' });
    }
  }

  private onBullseye(at: THREE.Vector3) {
    this.sfx('target', at);
    this.particles.emit(at, 20, { color: [0xd8322f, 0xffffff, 0xffcf3a], speed: 35, up: 30, size: 1, life: 0.9 });
    this.stats.targets++;
    this.award(200, at.clone().setY(at.y + 8), 'BULLSEYE!', { color: '#ff8a5a' });
  }

  private onEntityEvent(n: string, e: Entity, v?: number) {
    const at = new THREE.Vector3(e.x, e.y + e.height + 6, e.z);
    if (n === 'stun') { this.stats.stuns++; this.award(v ?? 50, at, e instanceof Dog ? 'GOOD BOY' : 'BONK', { size: 'small', color: '#a8f0ff' }); }
    if (n === 'pickup') {
      if (this.attract || this.state === 'intro') return;
      const before = this.paperCount;
      this.paperCount = Math.min(MAX_PAPERS, this.paperCount + 8);
      this.sfx('pickup');
      this.ui.popup(at, `+${this.paperCount - before}`, { size: 'mid', color: '#fff', label: 'PAPERS' });
    }
    if (n === 'riderHit') this.crash('dog');
    if (n === 'cone' && e instanceof Cone) this.award(10, at, 'CONE', { size: 'small', color: '#ffb070' });
  }

  private onRiderEvent(n: string, v?: number) {
    const r = this.rider;
    switch (n) {
      case 'throw':
        if (!this.attract && this.state !== 'intro') this.paperCount = Math.max(0, this.paperCount - 1);
        this.sfx('throw', undefined, 0.7);
        break;
      case 'hop': this.sfx('hop'); break;
      case 'launch': this.sfx('launch'); break;
      case 'bump': if ((v ?? 0) > 1.5) this.sfx('bump', undefined, 0.5); break;
      case 'land': {
        this.sfx('land', undefined, Math.min(1, (v ?? 0) / 120));
        const air = r.airTime;
        const on = this.world.near(r.pos.x, r.pos.z).find((c) => c.kind === 'walk');
        if (air > 0.5 && (v ?? 0) > 0) {
          const pts = Math.round((air * 400) / 10) * 10;
          this.stats.air += pts;
          this.sfx('air');
          this.award(pts, r.pos.clone().setY(r.pos.y + 45), air > 0.9 ? 'HUGE AIR' : 'BIG AIR', { color: '#7af0a0', size: air > 0.9 ? 'big' : 'mid' });
        }
        if (on && on.tag && ['bench', 'fountain', 'pipes', 'porch', 'deck', 'trampoline', 'fence'].includes(on.tag)) {
          this.sfx('grind');
          this.award(75, r.pos.clone().setY(r.pos.y + 38), `${on.tag.toUpperCase()} STALL`, { color: '#7ad8ff', size: 'small' });
        }
        break;
      }
      case 'crash':
        this.sfx('crash');
        this.particles.emit(r.pos.clone().setY(r.pos.y + 5), 16, { color: [0xb8ab94, 0x9a8f7a], speed: 30, up: 20, size: 1.4, life: 0.9 });
        break;
      case 'respawn':
        r.pos.x = Math.max(-30, Math.min(30, r.pos.x));
        if (Math.abs(r.pos.x) < 8) r.pos.x = 24;
        r.pos.y = this.world.groundAt(r.pos.x, r.pos.z);
        for (const e of this.entities) if (e instanceof Dog && Math.hypot(e.x - r.pos.x, e.z - r.pos.z) < 120) e.bumped(this.ctx());
        if (this.gameOverPending) { this.gameOverPending = false; this.toEnd(false); }
        break;
    }
  }

  private crack(face: NonNullable<Target['face']>) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2a3440';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#e8f4ff';
    g.lineWidth = 2;
    const cx = 20 + Math.random() * 24, cy = 20 + Math.random() * 24;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
      g.beginPath();
      g.moveTo(cx, cy);
      let x = cx, y = cy;
      for (let k = 0; k < 4; k++) { x += Math.cos(a + (Math.random() - 0.5)) * 10; y += Math.sin(a + (Math.random() - 0.5)) * 10; g.lineTo(x, y); }
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const w = face.z1 - face.z0, hgt = face.y1 - face.y0;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), new THREE.MeshBasicMaterial({ map: tex }));
    m.position.set(face.x - face.side * 0.6 + face.side * 2.2, (face.y0 + face.y1) / 2, (face.z0 + face.z1) / 2);
    m.rotation.y = face.side > 0 ? -Math.PI / 2 : Math.PI / 2;
    this.decals.add(m);
  }

  // ================================================================ end of day

  private summaryRows: { label: string; value: string; total?: boolean }[] = [];

  private toSummary() {
    this.state = 'summary';
    this.audio.music(null);
    const subs = [...this.houses.entries()].filter(([, h]) => h.subscriber);
    const delivered = subs.filter(([, h]) => h.delivered && !h.smashed).length;
    const perfect = delivered === subs.length && subs.length > 0;
    for (const [, h] of subs) if (!h.delivered && !h.smashed) h.strikes++;
    const cancelled = subs.filter(([, h]) => h.smashed || h.strikes >= 2);
    const warned = subs.filter(([, h]) => !h.delivered && !h.smashed && h.strikes === 1).length;
    const paperBonus = this.paperCount * 25;
    const perfectBonus = perfect ? 1000 + this.day * 500 : 0;
    this.score += paperBonus + perfectBonus;
    this.dayScore += paperBonus + perfectBonus;

    for (const [, h] of cancelled) h.subscriber = false;
    let regained = 0;
    if (perfect) {
      const lapsed = [...this.houses.values()].filter((h) => !h.subscriber);
      for (let i = 0; i < 2 && lapsed.length; i++) lapsed.splice(Math.floor(Math.random() * lapsed.length), 1)[0].subscriber = true, regained++;
      this.lives = Math.min(5, this.lives + 1);
    }

    document.getElementById('s-title')!.textContent = `${DAYS[this.day].toUpperCase()} ${perfect ? '· PERFECT!' : 'DONE'}`;
    const street = document.getElementById('s-street')!;
    street.innerHTML = '';
    for (const [, h] of subs) {
      const i = document.createElement('i');
      i.className = h.smashed ? 'smash' : h.delivered ? 'ok' : 'miss';
      street.appendChild(i);
    }
    this.summaryRows = [
      { label: 'Delivered', value: `${delivered} / ${subs.length}` },
      { label: 'Mailboxes · porches', value: `${this.stats.mailbox} · ${this.stats.door}` },
      { label: 'Air · bullseyes · bonks', value: `${this.stats.air} · ${this.stats.targets} · ${this.stats.stuns}` },
      { label: `Papers left × 25`, value: `+${paperBonus}` },
      { label: 'Perfect delivery', value: perfect ? `+${perfectBonus} & +1 BIKE` : '—' },
      { label: 'Warnings (1 strike)', value: warned ? String(warned) : 'none' },
      { label: 'Cancelled', value: cancelled.length ? `−${cancelled.length}` : 'none' },
      ...(regained ? [{ label: 'New subscribers', value: `+${regained}` }] : []),
      { label: 'Today', value: String(this.dayScore), total: true },
      { label: 'Total', value: String(this.score), total: true },
    ];
    const rows = document.getElementById('s-rows')!;
    rows.innerHTML = '';
    this.summaryDone = false;
    document.getElementById('s-press')!.classList.add('hidden');
    this.ui.show('summary');
    this.summaryRows.forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'r' + (r.total ? ' total' : '');
      d.innerHTML = `<span>${r.label}</span><b>${r.value}</b>`;
      rows.appendChild(d);
      setTimeout(() => { d.classList.add('on'); this.sfx('tick'); }, 250 + i * 260);
    });
    setTimeout(() => { this.summaryDone = true; document.getElementById('s-press')!.classList.remove('hidden'); }, 250 + this.summaryRows.length * 260);
    this.ui.setScore(this.score);
  }

  private afterSummary() {
    this.ui.show('summary', false);
    if (this.subCount() === 0) return this.toEnd(false, 'Every subscriber cancelled.');
    if (this.day >= DAYS.length - 1) return this.toEnd(true);
    this.setupRun(this.day + 1);
    this.toBrief();
  }

  private toEnd(won: boolean, why = 'Out of bikes.') {
    this.state = 'end';
    this.audio.music(won ? 'fanfare' : 'gameover');
    const kept = this.subCount();
    const ratio = kept / Math.max(1, this.initialSubs);
    const medal = document.getElementById('e-medal')!;
    let title: string, cls: string, mark: string, text: string;
    if (!won) { title = "YOU'RE FIRED!"; cls = 'fired'; mark = 'FIRED'; text = `${why} The Herald will be in touch.`; }
    else if (ratio >= 0.85) { title = 'PAPERBOY OF THE WEEK'; cls = 'gold'; mark = '1'; text = 'Maple Hollow has never been so well informed.'; }
    else if (ratio >= 0.6) { title = 'SOLID ROUTE'; cls = 'silver'; mark = '2'; text = 'A few porches went dry, but the route is yours.'; }
    else { title = 'YOU KEPT THE JOB'; cls = 'bronze'; mark = '3'; text = 'Barely. Practice those mailbox shots.'; }
    document.getElementById('e-title')!.textContent = title;
    medal.className = `medal ${cls}`;
    medal.textContent = mark;
    document.getElementById('e-text')!.textContent = text;
    const newHi = this.score > this.hi;
    if (newHi) { this.hi = this.score; try { localStorage.setItem('paperman2.hi', String(this.hi)); } catch { /* ignore */ } }
    document.getElementById('hi')!.textContent = String(this.hi).padStart(6, '0');
    document.getElementById('e-rows')!.innerHTML =
      `<div class="r on"><span>Final score</span><b>${this.score}${newHi ? ' · NEW HI!' : ''}</b></div>` +
      `<div class="r on"><span>Subscribers kept</span><b>${kept} / ${this.initialSubs}</b></div>` +
      `<div class="r on"><span>Days ridden</span><b>${won ? 5 : this.day + 1}</b></div>`;
    ['summary', 'brief', 'pause'].forEach((s) => this.ui.show(s, false));
    this.ui.show('end');
  }

  // ================================================================ camera

  private snapCamera() {
    const f = this.camFocus();
    this.camLook.copy(f);
    this.camPos.copy(f).add(new THREE.Vector3(0, 185, 225));
  }

  private camFocus() {
    const r = this.rider;
    return new THREE.Vector3(r.pos.x * 0.6, 0, r.pos.z - 62 - r.speed * 0.22);
  }

  private updateCamera(dt: number) {
    const r = this.rider;
    if (this.state === 'title' || this.state === 'howto') {
      this.orbit += dt * 0.12;
      const look = r.pos.clone().add(new THREE.Vector3(0, 14, -30));
      const off = new THREE.Vector3(Math.sin(this.orbit) * 150, 70 + Math.sin(this.orbit * 0.7) * 25, Math.cos(this.orbit) * 150 + 40);
      this.camPos.lerp(look.clone().add(off), Math.min(1, dt * 2));
      this.camLook.lerp(look, Math.min(1, dt * 4));
    } else {
      const focus = this.camFocus();
      const zoom = 1 + r.speed * 0.0011;
      const want = focus.clone().add(new THREE.Vector3(0, 185 * zoom, 225 * zoom));
      this.camPos.lerp(want, Math.min(1, dt * 4));
      this.camLook.lerp(focus, Math.min(1, dt * 5));
    }
    this.camera.position.copy(this.camPos);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = this.shakeT * 6;
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, 0));
    }
    this.camera.lookAt(this.camLook);
    this.placeSun(this.camLook);
  }

  private placeSun(focus: THREE.Vector3) {
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(this.sunOffset.clone().multiplyScalar(2.5));
  }

  // ================================================================ autopilot (title) & intro

  private autoT = 0;
  private autopilot(): RideInput {
    const r = this.rider;
    this.autoT -= 1 / 60;
    const ahead = (d: number) => this.world.blocked(r.pos.x, r.pos.z - d, r.pos.y) || this.entities.some((e) => e.hazard && Math.abs(e.x - r.pos.x) < e.radius + 4 && e.z < r.pos.z - d + 12 && e.z > r.pos.z - d - 12);
    if (!r.airborne && (ahead(30) || ahead(45))) r.hop();
    if (this.autoT < 0) {
      this.autoT = 0.5;
      for (const e of this.entities) {
        if (!(e instanceof Mailbox) || !e.subscriber || e.delivered) continue;
        const dz = r.pos.z - e.z;
        if (dz > 30 && dz < 80) r.throwPaper(e.x > r.pos.x ? 1 : -1);
      }
    }
    const lane = 16 + Math.sin(this.time * 0.3) * 10;
    return { left: r.pos.x > lane + 6, right: r.pos.x < lane - 6, up: Math.sin(this.time * 0.2) > 0.6, down: false };
  }

  private introInput(): RideInput {
    const t = this.introT;
    const r = this.rider;
    if (t > 8.2 && t < 8.3 && !r.airborne) r.hop();
    return { left: t > 12 && r.pos.x > 20, right: t > 8 && t < 9.4 && r.pos.x < 40, up: t > 7.6 && t < 8.6, down: t < 7 };
  }

  private introTick(dt: number) {
    const t = (this.introT += dt);
    const r = this.rider;
    const cap = document.querySelector('#intro .cap')!;
    const captions: [number, number, string][] = [
      [0.6, 3.8, 'MAPLE HOLLOW · 5:58 AM'],
      [4.4, 7.4, 'THE HERALD. HOT OFF THE PRESS.'],
      [8.2, 11.4, 'ONE KID. ONE BIKE. FIVE MORNINGS.'],
      [12, 15, "DON'T MISS A SINGLE PORCH."],
    ];
    const c = captions.find(([a, b]) => t > a && t < b);
    if (c) { if (cap.textContent !== c[2]) cap.textContent = c[2]; cap.classList.add('on'); }
    else cap.classList.remove('on');

    // the van rolls up to the depot and drops a bundle
    if (this.van) {
      const vz = t < 4 ? -420 : Math.min(-120, -420 + (t - 4) * 140 - Math.max(0, t - 5.5) ** 2 * 45);
      this.van.z = vz;
      this.van.yaw = Math.PI;
      if (t > 3.9 && t < 4) this.sfx('van');
      if (t > 6.3 && this.introBundle && !this.introBundle.root.visible) {
        this.introBundle.root.visible = true;
        this.sfx('door');
        this.particles.emit(new THREE.Vector3(52, 3, -78), 10, { color: 0xb8ab94, speed: 20, up: 10 });
      }
      if (t > 9.5) { this.removeEntity(this.van); this.van = null; }
    }
    // the kid rides in
    if (t > 7 && !this.introRider) { this.introRider = true; r.reset(24, 60, 60); }
    if (t > 12.4 && t < 12.5 && r.throwT < 0) r.throwPaper(-1);

    const shots: { t0: number; t1: number; from: number[]; to: number[]; look0: number[]; look1: number[] }[] = [
      { t0: 0, t1: 4, from: [-320, 220, 40], to: [-160, 140, -180], look0: [60, 20, -260], look1: [80, 10, -160] },
      { t0: 4, t1: 7.6, from: [-14, 14, 10], to: [-4, 22, -20], look0: [30, 12, -220], look1: [46, 8, -95] },
      { t0: 7.6, t1: 11.8, from: [66, 9, -70], to: [62, 14, -40], look0: [24, 14, 20], look1: [40, 16, -80] },
      { t0: 11.8, t1: 16, from: [40, 20, 20], to: [30, 160, 140], look0: [24, 14, -120], look1: [10, 0, -260] },
    ];
    const s = shots.find((sh) => t >= sh.t0 && t < sh.t1) ?? shots[shots.length - 1];
    const k = Math.min(1, (t - s.t0) / (s.t1 - s.t0));
    const e = k * k * (3 - 2 * k);
    const lerp3 = (a: number[], b: number[]) => new THREE.Vector3(a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e);
    let pos = lerp3(s.from, s.to), look = lerp3(s.look0, s.look1);
    if (s.t0 >= 7.6) {
      // shots that follow the rider
      const rel = r.pos.clone().setY(0);
      if (s.t0 === 7.6) { look = rel.clone().add(new THREE.Vector3(0, 14, 0)); pos.z = Math.min(pos.z, rel.z - 70); }
      else { pos = rel.clone().add(new THREE.Vector3(30 - 10 * e, 18 + 150 * e, 30 + 140 * e)); look = rel.clone().add(new THREE.Vector3(0, 10, -60 - 140 * e)); }
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    this.placeSun(look);
    if (t > 16) this.endIntro();
  }
}
