/**
 * Everything audible is synthesised here with WebAudio: no sample files.
 * sfx(name, pan, gain) plays one-shots; music(track) loops a chiptune pattern.
 */
export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  muted = false;
  private track: string | null = null;
  private seqTimer = 0;
  private step = 0;
  private nextTime = 0;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.32;
    this.musicBus.connect(this.master);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (this.track) { const t = this.track; this.track = null; this.music(t); }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  // ------------------------------------------------------------ primitives

  private out(pan: number, gain: number): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(this.sfxBus);
    return g;
  }

  private tone(dest: AudioNode, type: OscillatorType, f0: number, f1: number, t0: number, dur: number, vol: number, attack = 0.005) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noise(dest: AudioNode, t0: number, dur: number, vol: number, filter: BiquadFilterType, f0: number, f1 = f0, q = 1) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t0, Math.random() * 0.5);
    s.stop(t0 + dur + 0.02);
  }

  // ------------------------------------------------------------ effects

  sfx(name: string, pan = 0, gain = 1) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + 0.005;
    const o = this.out(pan, gain);
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    switch (name) {
      case 'throw': this.noise(o, t, 0.22, 0.35, 'bandpass', 900, 3200, 2); break;
      case 'mailbox':
        this.tone(o, 'sine', 1568, 1568, t, 0.6, 0.35);
        this.tone(o, 'sine', 2349, 2349, t + 0.08, 0.7, 0.25);
        this.tone(o, 'triangle', 3136, 3136, t + 0.16, 0.5, 0.12);
        this.noise(o, t, 0.06, 0.3, 'highpass', 3000);
        break;
      case 'door': this.noise(o, t, 0.12, 0.5, 'lowpass', 900, 300); this.tone(o, 'sine', 140, 70, t, 0.15, 0.4); break;
      case 'thud': this.noise(o, t, 0.08, 0.35, 'lowpass', 700, 200); this.tone(o, 'sine', 110, 60, t, 0.1, 0.25); break;
      case 'thunk': this.tone(o, 'square', 300, 180, t, 0.08, 0.15); this.noise(o, t, 0.05, 0.3, 'bandpass', 1500); break;
      case 'window':
        this.noise(o, t, 0.5, 0.6, 'highpass', 2500, 6000);
        for (let i = 0; i < 9; i++) this.tone(o, 'sine', r(2500, 6000), r(2000, 5000), t + r(0, 0.35), r(0.05, 0.2), 0.12);
        break;
      case 'crash':
        this.noise(o, t, 0.6, 0.8, 'lowpass', 2000, 150);
        this.tone(o, 'square', 220, 55, t, 0.5, 0.25);
        for (let i = 0; i < 5; i++) this.tone(o, 'triangle', r(400, 1200), r(200, 600), t + r(0, 0.3), 0.18, 0.1);
        break;
      case 'hop': this.tone(o, 'square', 280, 620, t, 0.12, 0.12); this.noise(o, t, 0.05, 0.12, 'highpass', 2000); break;
      case 'land': this.noise(o, t, 0.12, 0.45, 'lowpass', 600, 150); this.tone(o, 'sine', 90, 45, t, 0.14, 0.4); break;
      case 'launch': this.tone(o, 'sawtooth', 200, 900, t, 0.3, 0.08); break;
      case 'bump': this.tone(o, 'sine', 120, 60, t, 0.08, 0.25); break;
      case 'skid': this.noise(o, t, 0.4, 0.25, 'bandpass', 2400, 1200, 6); break;
      case 'bark': {
        const p = r(0.9, 1.1);
        for (const dt of [0, 0.13]) {
          this.tone(o, 'sawtooth', 520 * p, 260 * p, t + dt, 0.09, 0.22);
          this.noise(o, t + dt, 0.07, 0.3, 'bandpass', 1100 * p, 700, 3);
        }
        break;
      }
      case 'yelp': this.tone(o, 'sawtooth', 900, 1500, t, 0.08, 0.15); this.tone(o, 'sawtooth', 1400, 700, t + 0.09, 0.2, 0.15); break;
      case 'meow': this.tone(o, 'sawtooth', 600, 900, t, 0.12, 0.08); this.tone(o, 'sawtooth', 900, 500, t + 0.12, 0.25, 0.08); break;
      case 'hiss': this.noise(o, t, 0.4, 0.3, 'highpass', 4000); break;
      case 'yowl': this.tone(o, 'sawtooth', 500, 1300, t, 0.2, 0.12); this.tone(o, 'sawtooth', 1300, 400, t + 0.2, 0.35, 0.12); break;
      case 'flutter': for (let i = 0; i < 10; i++) this.noise(o, t + i * 0.04, 0.035, 0.25, 'bandpass', r(1500, 3000), 1500, 2); break;
      case 'quack': this.tone(o, 'sawtooth', 380, 300, t, 0.14, 0.12); this.noise(o, t, 0.14, 0.12, 'bandpass', 1200, 900, 4); break;
      case 'honkGoose': this.tone(o, 'sawtooth', 330, 290, t, 0.2, 0.08); break;
      case 'chitter': for (let i = 0; i < 4; i++) this.tone(o, 'square', 2200, 1800, t + i * 0.05, 0.03, 0.05); break;
      case 'horn': this.tone(o, 'square', 330, 330, t, 0.35, 0.12); this.tone(o, 'square', 415, 415, t, 0.35, 0.12); break;
      case 'beep': this.tone(o, 'square', 1200, 1200, t, 0.06, 0.06); this.tone(o, 'square', 1600, 1600, t + 0.08, 0.06, 0.06); break;
      case 'bonk': this.tone(o, 'square', 880, 220, t, 0.25, 0.15); this.noise(o, t, 0.1, 0.3, 'bandpass', 2000); break;
      case 'clang': for (const f of [620, 930, 1450]) this.tone(o, 'triangle', f, f * 0.98, t, 0.5, 0.1); break;
      case 'tock': this.tone(o, 'square', 500, 300, t, 0.06, 0.12); this.noise(o, t, 0.06, 0.2, 'bandpass', 900); break;
      case 'pickup': [523, 659, 784, 1047].forEach((f, i) => this.tone(o, 'square', f, f, t + i * 0.06, 0.12, 0.1)); break;
      case 'target': [784, 1047, 1319].forEach((f, i) => this.tone(o, 'triangle', f, f, t + i * 0.05, 0.25, 0.18)); break;
      case 'combo': [659, 880, 1175, 1568].forEach((f, i) => this.tone(o, 'square', f, f, t + i * 0.045, 0.1, 0.08)); break;
      case 'air': this.tone(o, 'triangle', 600, 1500, t, 0.3, 0.12); break;
      case 'miss': this.tone(o, 'square', 300, 200, t, 0.18, 0.1); this.tone(o, 'square', 200, 130, t + 0.18, 0.3, 0.1); break;
      case 'tick': this.tone(o, 'square', 1800, 1800, t, 0.025, 0.05); break;
      case 'select': this.tone(o, 'square', 880, 880, t, 0.06, 0.1); this.tone(o, 'square', 1320, 1320, t + 0.06, 0.1, 0.1); break;
      case 'move': this.tone(o, 'square', 660, 660, t, 0.04, 0.06); break;
      case 'whoosh': this.noise(o, t, 0.6, 0.4, 'bandpass', 300, 3000, 1.5); break;
      case 'slam': this.noise(o, t, 0.5, 0.8, 'lowpass', 1500, 80); this.tone(o, 'sine', 80, 35, t, 0.6, 0.6); break;
      case 'van': this.noise(o, t, 1.6, 0.25, 'lowpass', 300, 200); this.tone(o, 'sawtooth', 70, 90, t, 1.6, 0.05, 0.3); break;
      case 'grind': this.noise(o, t, 0.3, 0.25, 'bandpass', 3000, 2000, 4); break;
    }
  }

  // ------------------------------------------------------------ music

  music(track: string | null) {
    if (track === this.track) return;
    this.track = track;
    this.step = 0;
    if (!this.ctx) return;
    clearInterval(this.seqTimer);
    if (!track) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.seqTimer = window.setInterval(() => this.schedule(), 25);
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.track) return;
    const song = SONGS[this.track];
    const spb = 60 / song.bpm / 4; // sixteenth notes
    while (this.nextTime < ctx.currentTime + 0.12) {
      const s = this.step % song.len;
      if (!song.loop && this.step >= song.len) { this.track = null; clearInterval(this.seqTimer); return; }
      const t = this.nextTime;
      for (const v of song.voices) {
        const n = v.notes[s % v.notes.length];
        if (n === null || n === undefined) continue;
        if (v.type === 'kick') { this.tone(this.musicBus, 'sine', 150, 40, t, 0.18, 0.9); continue; }
        if (v.type === 'snare') { this.noise(this.musicBus, t, 0.12, 0.45, 'highpass', 1500); continue; }
        if (v.type === 'hat') { this.noise(this.musicBus, t, 0.03, 0.18, 'highpass', 7000); continue; }
        const f = 440 * Math.pow(2, (n - 69) / 12);
        this.tone(this.musicBus, v.type, f, f, t, spb * (v.dur ?? 1) * 0.95, v.vol ?? 0.2, 0.004);
      }
      this.nextTime += spb;
      this.step++;
    }
  }
}

type Voice = { type: OscillatorType | 'kick' | 'snare' | 'hat'; notes: (number | null)[]; vol?: number; dur?: number };
type Song = { bpm: number; len: number; loop: boolean; voices: Voice[] };

/** Expand "C4 . E4 G4" style strings (one token per 16th; '.' rest). */
function seq(s: string): (number | null)[] {
  const names: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  return s.trim().split(/\s+/).map((tok) => {
    if (tok === '.') return null;
    if (tok === 'x') return 1;
    const m = tok.match(/^([A-G])(#|b)?(\d)$/);
    if (!m) return null;
    return 12 * (Number(m[3]) + 1) + names[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  });
}

const rep = (s: string, n: number) => Array(n).fill(s).join(' ');

const SONGS: Record<string, Song> = {
  title: {
    bpm: 132, len: 128, loop: true,
    voices: [
      { type: 'square', vol: 0.11, dur: 2, notes: seq(
        'E5 . G5 . A5 . . . G5 . E5 . D5 . C5 . ' +
        'D5 . E5 . G5 . . . E5 . . . . . . . ' +
        'E5 . G5 . A5 . . . C6 . B5 . A5 . G5 . ' +
        'A5 . G5 . E5 . D5 . C5 . . . . . . . ' +
        'C5 . E5 . G5 . . . A5 . G5 . E5 . G5 . ' +
        'A5 . . . B5 . . . C6 . . . . . . . ' +
        'D6 . C6 . A5 . G5 . E5 . G5 . A5 . . . ' +
        'G5 . E5 . D5 . E5 . C5 . . . . . . .') },
      { type: 'triangle', vol: 0.32, dur: 1, notes: seq(rep('C3 . C4 . G3 . C4 . A2 . A3 . E3 . A3 .', 2) + ' ' + rep('F2 . F3 . C3 . F3 . G2 . G3 . D3 . G3 .', 2) + ' ' + rep('C3 . C4 . G3 . C4 . A2 . A3 . E3 . A3 .', 2) + ' ' + rep('F2 . F3 . C3 . F3 . G2 . G3 . B2 . G3 .', 2)) },
      { type: 'kick', notes: seq(rep('x . . . . . . . x . . . . . . .', 8)) },
      { type: 'snare', notes: seq(rep('. . . . x . . . . . . . x . . .', 8)) },
      { type: 'hat', notes: seq(rep('. . x . . . x . . . x . . . x x', 8)) },
    ],
  },
  ride: {
    bpm: 144, len: 128, loop: true,
    voices: [
      { type: 'square', vol: 0.08, dur: 1, notes: seq(
        'G4 . B4 . D5 . B4 . G4 . B4 . D5 . E5 . ' +
        'D5 . B4 . G4 . . . A4 . B4 . A4 . . . ' +
        'G4 . B4 . D5 . B4 . G4 . B4 . D5 . G5 . ' +
        'F#5 . E5 . D5 . . . B4 . . . . . . . ' +
        'C5 . E5 . G5 . E5 . C5 . E5 . G5 . A5 . ' +
        'G5 . E5 . C5 . . . D5 . E5 . D5 . . . ' +
        'B4 . D5 . G5 . D5 . A4 . C5 . F#5 . A5 . ' +
        'G5 . . . D5 . . . G4 . . . . . . .') },
      { type: 'triangle', vol: 0.3, dur: 1, notes: seq(rep('G2 . G3 G2 . G2 G3 . E2 . E3 E2 . E2 E3 .', 2) + ' ' + rep('C3 . C4 C3 . C3 C4 . D3 . D4 D3 . D3 D4 .', 2) + ' ' + rep('G2 . G3 G2 . G2 G3 . E2 . E3 E2 . E2 E3 .', 2) + ' ' + rep('C3 . C4 C3 . C3 C4 . D3 . D4 D3 . D3 D4 .', 2)) },
      { type: 'kick', notes: seq(rep('x . . . . . x . x . . . . . . .', 8)) },
      { type: 'snare', notes: seq(rep('. . . . x . . . . . . . x . . x', 8)) },
      { type: 'hat', notes: seq(rep('x . x . x . x . x . x . x . x .', 8)) },
    ],
  },
  fanfare: {
    bpm: 150, len: 48, loop: false,
    voices: [
      { type: 'square', vol: 0.14, dur: 2, notes: seq('C5 . C5 . C5 . G5 . . . . . E5 . G5 . C6 . . . . . . . . . . . . . . . G5 . A5 . B5 . C6 . . . . . . . . .') },
      { type: 'triangle', vol: 0.3, dur: 2, notes: seq('C3 . . . G3 . . . C3 . . . G3 . . . C4 . . . . . . . . . . . . . . . G3 . . . G3 . . . C3 . . . . . . .') },
    ],
  },
  gameover: {
    bpm: 110, len: 32, loop: false,
    voices: [
      { type: 'square', vol: 0.12, dur: 3, notes: seq('G4 . . . F#4 . . . F4 . . . E4 . . . . . . . . . . . . . . . . . . .') },
      { type: 'triangle', vol: 0.3, dur: 3, notes: seq('C3 . . . B2 . . . Bb2 . . . A2 . . . . . . . . . . . . . . . . . . .') },
    ],
  },
};
