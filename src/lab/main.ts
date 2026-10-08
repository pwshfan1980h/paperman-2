import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Rider, RideInput, FAST } from '../rider/rider';
import { makeRoad } from './road';

// ---------------------------------------------------------------- renderer

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc8e6);

scene.add(new THREE.HemisphereLight(0xdcecff, 0x5a5040, 1.25));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.position.set(-45, 90, 35);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 300 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

const road = makeRoad();
scene.add(road.mesh);

const rider = new Rider();
scene.add(rider.root);

// ---------------------------------------------------------------- camera

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 1000);
const HALF_H = 34;
const target = new THREE.Vector3(0, 13, 0);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(target);
controls.enableDamping = true;
controls.zoomSpeed = 1.2;

interface Cam { name: string; dir: [number, number, number]; zoom: number }
const CAMS: Cam[] = [
  { name: 'game', dir: [1, 1.15, 1], zoom: 0.5 },
  { name: 'iso', dir: [1, 1.0, 1], zoom: 1 },
  { name: 'side', dir: [1, 0.12, 0], zoom: 1.15 },
  { name: 'front', dir: [0.55, 0.35, -1], zoom: 1.1 },
  { name: 'chase', dir: [0.12, 0.55, 1], zoom: 1 },
];
const camBtns = document.getElementById('cams')!;
function setCam(i: number) {
  const c = CAMS[i];
  const d = new THREE.Vector3(...c.dir).normalize().multiplyScalar(200);
  controls.target.copy(target);
  camera.position.copy(target).add(d);
  camera.zoom = c.zoom;
  camera.updateProjectionMatrix();
  [...camBtns.children].forEach((b, j) => b.classList.toggle('on', i === j));
}
CAMS.forEach((c, i) => {
  const b = document.createElement('button');
  b.textContent = `${i + 1} ${c.name}`;
  b.onclick = () => setCam(i);
  camBtns.appendChild(b);
});

// ---------------------------------------------------------------- toggles

const flags = { demo: false, pause: false, skeleton: false, pixel: false, spin: false };
type Flag = keyof typeof flags;
function toggle(f: Flag, v = !flags[f]) {
  flags[f] = v;
  document.querySelector(`[data-toggle=${f}]`)?.classList.toggle('on', v);
  if (f === 'pixel') resize();
  if (f === 'skeleton') skeleton.visible = v;
  if (f === 'demo') { demoT = 0; demoStep = -1; ticker.style.display = v ? 'block' : 'none'; }
}
document.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach((b) => (b.onclick = () => toggle(b.dataset.toggle as Flag)));
document.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => (b.onclick = () => act(b.dataset.act!)));

function act(a: string) {
  if (a === 'throwL') rider.throwPaper(-1);
  if (a === 'throwR') rider.throwPaper(1);
  if (a === 'crash') rider.crash();
}

let timescale = 1;
const tsInput = document.getElementById('timescale') as HTMLInputElement;
const tsLabel = document.getElementById('ts')!;
function setTimescale(v: number) {
  timescale = Math.min(1.5, Math.max(0.05, v));
  tsInput.value = String(timescale);
  tsLabel.textContent = `${timescale.toFixed(2)}×`;
}
tsInput.oninput = () => setTimescale(Number(tsInput.value));

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(flags.pixel ? 1 / 3 : Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.domElement.classList.toggle('pixel', flags.pixel);
  const aspect = w / h;
  Object.assign(camera, { left: -HALF_H * aspect, right: HALF_H * aspect, top: HALF_H, bottom: -HALF_H });
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- input

const keys = new Set<string>();
let stepOnce = false;
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
  keys.add(k);
  if (flags.demo && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's', 'z', 'x', 'c'].includes(k)) toggle('demo', false);
  if (k === 'z' || k === ' ') rider.throwPaper(-1);
  if (k === 'x') rider.throwPaper(1);
  if (k === 'c') rider.crash();
  if (k === 'p') toggle('pause');
  if (k === '.') stepOnce = true;
  if (k === 'k') toggle('skeleton');
  if (k === 'v') toggle('pixel');
  if (k === 'o') toggle('spin');
  if (k === 'g') toggle('demo');
  if (k === '[') setTimescale(timescale - 0.1);
  if (k === ']') setTimescale(timescale + 0.1);
  if (k >= '1' && k <= '5') setCam(Number(k) - 1);
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

function keyInput(): RideInput {
  return {
    left: keys.has('arrowleft') || keys.has('a'),
    right: keys.has('arrowright') || keys.has('d'),
    up: keys.has('arrowup') || keys.has('w'),
    down: keys.has('arrowdown') || keys.has('s'),
  };
}

// ---------------------------------------------------------------- demo reel

interface Beat { dur: number; label: string; in?: Partial<RideInput>; act?: string }
const DEMO: Beat[] = [
  { dur: 2.2, label: 'cruise' },
  { dur: 1.6, label: 'veer left', in: { left: true } },
  { dur: 1.2, label: 'straighten' },
  { dur: 1.6, label: 'veer right', in: { right: true } },
  { dur: 1.2, label: 'straighten' },
  { dur: 0.9, label: 'throw left', act: 'throwL' },
  { dur: 1.1, label: 'throw right', act: 'throwR' },
  { dur: 2.4, label: 'sprint', in: { up: true } },
  { dur: 1.3, label: 'sprint + veer left', in: { up: true, left: true } },
  { dur: 1.3, label: 'sprint + veer right', in: { up: true, right: true } },
  { dur: 1.4, label: 'ease off' },
  { dur: 3.4, label: 'brake to a stop', in: { down: true } },
  { dur: 1.2, label: 'foot down', in: { down: true } },
  { dur: 2.4, label: 'push off' },
  { dur: 0.7, label: 'throw left', act: 'throwL' },
  { dur: 1.6, label: 'throw left + right', act: 'throwR' },
  { dur: 4.6, label: 'crash', act: 'crash' },
];
const ticker = document.getElementById('ticker')!;
let demoT = 0;
let demoStep = -1;

function demoInput(dt: number): RideInput {
  demoT -= dt;
  if (demoT <= 0) {
    demoStep = (demoStep + 1) % DEMO.length;
    const b = DEMO[demoStep];
    demoT = b.dur;
    if (b.act) act(b.act);
    ticker.textContent = `▶ ${b.label}`;
  }
  return { left: false, right: false, up: false, down: false, ...DEMO[demoStep].in };
}

// ---------------------------------------------------------------- debug skeleton

const skelGeom = new THREE.BufferGeometry();
skelGeom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(16 * 2 * 3), 3));
const skeleton = new THREE.LineSegments(skelGeom, new THREE.LineBasicMaterial({ color: 0xff2fd0, depthTest: false }));
skeleton.renderOrder = 999;
skeleton.frustumCulled = false;
skeleton.visible = false;
scene.add(skeleton);
const velArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0.5, 0), 20, 0xffcf4a, 4, 3);
skeleton.add(velArrow);

function updateSkeleton() {
  const J = rider.joints;
  const pairs: THREE.Vector3[] = [J.pelvis, J.neck];
  for (let i = 0; i < 2; i++) {
    pairs.push(J.hip[i], J.knee[i], J.knee[i], J.ankle[i], J.shoulder[i], J.elbow[i], J.elbow[i], J.hand[i], J.pelvis, J.hip[i], J.neck, J.shoulder[i]);
  }
  const arr = skelGeom.attributes.position.array as Float32Array;
  pairs.forEach((p, i) => p.toArray(arr, i * 3));
  skelGeom.attributes.position.needsUpdate = true;
  skelGeom.setDrawRange(0, pairs.length);
  const v = rider.groundVel.clone().negate();
  if (v.lengthSq() > 1) {
    velArrow.visible = true;
    velArrow.setDirection(v.normalize());
    velArrow.setLength(8 + (rider.speed / FAST) * 22, 4, 3);
  } else velArrow.visible = false;
}

// ---------------------------------------------------------------- hud

const $ = (id: string) => document.getElementById(id)!;
const deg = (r: number) => `${(r * 57.2958).toFixed(0)}°`;
function hud() {
  $('r-state').textContent = rider.mode === 'ride' && rider.footDown.x > 0.5 ? 'stopped' : rider.throwT >= 0 ? 'throw' : rider.mode;
  $('r-speed').textContent = `${((rider.speed * 0.04) * 3.6).toFixed(1)} km/h`;
  $('r-heading').textContent = deg(rider.heading.x);
  $('r-lean').textContent = deg(rider.lean.x);
  $('r-steer').textContent = deg(rider.steer.x);
  $('r-cad').textContent = `${Math.abs(rider.cadenceRpm).toFixed(0)} rpm`;
  const bar = (id: string, v: number) => (($(id) as HTMLElement).style.width = `${Math.max(0, Math.min(1, v)) * 100}%`);
  bar('b-effort', rider.effort.x);
  bar('b-stand', rider.stand.x);
  bar('b-brake', rider.brake.x);
  bar('b-foot', rider.footDown.x);
}

// ---------------------------------------------------------------- loop

resize();
setCam(1);
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const real = Math.min((now - last) / 1000, 0.05);
  last = now;
  let dt = real * timescale;
  if (flags.pause) dt = stepOnce ? 1 / 60 : 0;
  stepOnce = false;

  if (dt > 0) {
    rider.setInput(flags.demo ? demoInput(dt) : keyInput());
    rider.update(dt);
    road.scroll(rider.groundShift);
  }
  if (flags.spin) {
    const off = camera.position.clone().sub(controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), real * 0.4);
    camera.position.copy(controls.target).add(off);
  }
  controls.update();
  if (flags.skeleton) updateSkeleton();
  hud();
  renderer.render(scene, camera);
});

// expose for poking from the console
Object.assign(window, { rider, camera, setCam, toggle });
